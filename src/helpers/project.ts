import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

/**
 * Turning a folder into a project that runs itself.
 *
 * A context is just a directory of flows and applications, and `ronsel` run in
 * it does the rest -- but only if the tool is on the machine, and only if
 * whoever comes next knows the incantation. `ronsel start` removes both
 * conditions: it writes a package.json that depends on this exact tool and
 * carries the command as a script, so the folder can be cloned and run with
 * `npm install && npm run ronsel` by somebody who has never heard of us.
 */

/** The name this package is installed under. */
const PACKAGE = 'ronsel';

/**
 * What the generated script runs.
 *
 * `--context .` is not redundant: without it the CLI asks which directory to
 * work in, and the answer is never in doubt here -- the package.json holding
 * the script *is* the context. npm runs scripts from that directory, so the
 * dot always names it, wherever in the tree the command was typed.
 */
const RUN_SCRIPT = `${PACKAGE} --context .`;

/** The script's name in package.json, i.e. what `npm run <this>` takes. */
const SCRIPT_NAME = 'ronsel';

/** What a context has no business committing. */
const IGNORED = [
  'node_modules/',
  // Every run leaves a copy of itself here: results, not sources
  'test-runs/'
];

/** Whether the folder's own name can be an npm package name, and what it is. */
const packageNameFor = (directory: string): string => {
  const slug = path.basename(path.resolve(directory))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .replace(/-+$/, '');

  return slug || 'ronsel-context';
};

/**
 * The indentation a JSON file already uses, so rewriting it does not reformat
 * every line of somebody's package.json into a diff nobody asked for.
 * @param {string} source - The file as it is on disk
 * @returns {string} The indent of its first indented key, or two spaces
 */
const indentOf = (source: string): string => {
  const match = source.match(/\n([ \t]+)"/);
  return match ? match[1] : '  ';
};

export interface PackageResult {
  /** Absolute path of the package.json */
  path: string;
  /** true when there was none and this wrote it */
  created: boolean;
  /** What was written, in words, for the terminal */
  changes: string[];
  /** true when a script called `ronsel` was already there and is not ours */
  scriptTaken: boolean;
}

/**
 * Write, or complete, the package.json that makes the folder runnable.
 *
 * An existing one is edited rather than replaced: the script and the
 * dependency are added if they are missing and everything else is left exactly
 * as it was, indentation included. A `ronsel` script that is already there is
 * never overwritten -- it is somebody's, and they meant it.
 *
 * @param {Object} options - { directory, version }
 * @returns {PackageResult}
 */
const ensurePackageJson = ({ directory, version }: { directory: string, version: string }): PackageResult => {
  const file = path.join(directory, 'package.json');
  const dependency = `^${version}`;

  if (!fs.existsSync(file)) {
    const manifest = {
      name: packageNameFor(directory),
      version: '0.0.0',
      private: true,
      description: 'End-to-end flows, run with ronsel',
      scripts: { [SCRIPT_NAME]: RUN_SCRIPT },
      devDependencies: { [PACKAGE]: dependency }
    };

    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    return {
      path: file,
      created: true,
      changes: [`created package.json, with the "${SCRIPT_NAME}" script and ${PACKAGE} ${dependency}`],
      scriptTaken: false
    };
  }

  const source = fs.readFileSync(file, 'utf8');

  let manifest;
  try {
    manifest = JSON.parse(source);
  }
  catch (error) {
    throw new Error(
      `${file} is not valid JSON (${error.message}), so the "${SCRIPT_NAME}" script cannot be added to it`,
      { cause: error }
    );
  }

  const changes: string[] = [];
  const scripts = manifest.scripts || {};
  const existing = scripts[SCRIPT_NAME];
  const scriptTaken = Boolean(existing) && existing !== RUN_SCRIPT;

  if (!existing) {
    manifest.scripts = { ...scripts, [SCRIPT_NAME]: RUN_SCRIPT };
    changes.push(`added the "${SCRIPT_NAME}" script to package.json`);
  }

  // Wherever the tool is already declared is where it stays: moving it between
  // dependencies and devDependencies would be a decision that is not ours
  const declaredIn = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .find(section => manifest[section] && manifest[section][PACKAGE]);

  if (!declaredIn) {
    manifest.devDependencies = { ...(manifest.devDependencies || {}), [PACKAGE]: dependency };
    changes.push(`added ${PACKAGE} ${dependency} to the devDependencies`);
  }

  if (changes.length) {
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, indentOf(source))}\n`, 'utf8');
  }

  return { path: file, created: false, changes, scriptTaken };
};

/**
 * Keep the folder's own noise out of git.
 *
 * Only the lines that are missing are appended, and a folder that is not a
 * repository still gets the file: it may become one, and the entries cost
 * nothing until it does.
 *
 * @param {string} directory - The context directory
 * @returns {string[]} What was written, in words
 */
const ensureGitignore = (directory: string): string[] => {
  const file = path.join(directory, '.gitignore');

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${IGNORED.join('\n')}\n`, 'utf8');
    return ['created .gitignore'];
  }

  const source = fs.readFileSync(file, 'utf8');
  const present = source.split('\n').map(line => line.trim());
  const missing = IGNORED.filter(entry => !present.includes(entry));

  if (!missing.length) { return []; }

  const separator = source.endsWith('\n') || source === '' ? '' : '\n';
  fs.appendFileSync(file, `${separator}${missing.join('\n')}\n`, 'utf8');

  return [`added ${missing.join(', ')} to .gitignore`];
};

/**
 * Whether the tool is already installed in the folder, i.e. whether
 * `npm run ronsel` would find a binary to run.
 * @param {string} directory - The context directory
 * @returns {boolean}
 */
const isInstalled = (directory: string): boolean =>
  fs.existsSync(path.join(directory, 'node_modules', PACKAGE, 'package.json'));

/**
 * Run `npm install` in the folder, showing its output as it goes.
 *
 * This is the step that makes the promise true: until the dependency is on
 * disk, `npm run ronsel` finds nothing on the PATH and the script is a note
 * rather than a command.
 *
 * @param {string} directory - The context directory
 * @returns {Promise<void>} Rejects when npm exits non-zero
 */
const install = (directory: string): Promise<void> => new Promise((resolve, reject) => {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(command, ['install'], { cwd: directory, stdio: 'inherit' });

  child.on('error', (error: Error) => reject(new Error(`could not run npm install: ${error.message}`)));
  child.on('close', (code: number) => {
    if (code === 0) { return resolve(); }
    reject(new Error(`npm install exited with code ${code}`));
  });
});

export {
  PACKAGE,
  SCRIPT_NAME,
  RUN_SCRIPT,
  packageNameFor,
  ensurePackageJson,
  ensureGitignore,
  isInstalled,
  install
};
