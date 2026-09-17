import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import createDebug from 'debug';

import * as paths from './paths';
import * as configHelper from './config';
import * as cli from './cli';

const debug = createDebug('ronsel:helpers:browsers');

/**
 * The browsers playwright drives, and how they get onto the machine.
 *
 * `npm install` brings in playwright itself, but not the browsers: those are a
 * download of their own, a few hundred megabytes of them, and until it has
 * happened every browser flow fails on its first step. Nothing about the tool
 * needs them -- the UI, the HTTP flows and everything else run perfectly well
 * without -- which is why this is a question asked at start rather than a
 * condition for starting.
 *
 * So: look for the executable on disk (cheap), ask once (only when there is
 * somebody to ask), download in the background (the UI is not kept waiting),
 * and say one line when it is over. A no is remembered, because being asked
 * the same question at every start is how a prompt becomes noise.
 */

/** Every browser playwright can drive. */
const BROWSERS = ['chromium', 'firefox', 'webkit'];

/** What the bundled examples need, and therefore what a plain yes means. */
const DEFAULT_BROWSERS = ['chromium'];

/** The config file in the context that remembers the answer. */
const CONFIG_NAME = 'browsers';

/** Where the download's output goes, inside the context. */
const LOG_FILE = ['logs', 'playwright-install.log'];

interface Stored {
  /** false when somebody was asked and said no. Absent until they are asked */
  install?: boolean;
  /** When they said it */
  decidedAt?: string;
}

/** `a, b and c`, for a sentence rather than a list. */
const list = (names: string[]): string => names.length > 1
  ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  : (names[0] || '');

/**
 * The arguments that download `browsers`, which is also what the command we
 * print says. Asking for all three is spelled the short way, the way
 * playwright's own documentation spells it.
 */
const commandParts = (browsers: string[]): string[] => {
  const all = BROWSERS.every(name => browsers.includes(name));
  return ['playwright', 'install', ...(all ? [] : browsers)];
};

/** The command to download `browsers`, as somebody would type it. */
const command = (browsers: string[]): string => `npx ${commandParts(browsers).join(' ')}`;

/**
 * The one way this tool says "the browsers are missing".
 *
 * Said by the error a flow fails with when it launches one, and by the question
 * `ronsel start` asks before anything has failed -- the same fact, in the same
 * words, wherever somebody meets it.
 *
 * @param {string[]} browsers - The ones that are not there
 * @returns {string} A sentence, with no full stop: the caller adds its own advice
 */
const notInstalled = (browsers: string[]): string =>
  `The ${list(browsers)} browser${browsers.length > 1 ? 's are' : ' is'} not installed. `
  + 'Playwright drives real browsers, and they are downloaded separately';

/**
 * Where playwright expects a browser's executable to be.
 *
 * `executablePath()` answers without launching anything and without touching
 * the disk: it is the path a launch would use, which is exactly what makes the
 * check cheap enough to put in front of the UI starting. It throws for a
 * browser playwright does not bundle, and requiring playwright at all fails if
 * the package is somehow not installed -- neither is worth more than a null.
 *
 * @param {string} browser - chromium, firefox or webkit
 * @returns {string|null}
 */
const executablePath = (browser: string): string | null => {
  try {
    // Required here rather than at the top: this module is on the start path,
    // and loading playwright to ask one question would cost more than the
    // question saves
    const types = require('playwright');
    const type = types[browser];

    if (!type || typeof type.executablePath !== 'function') { return null; }

    return type.executablePath() || null;
  }
  catch (ex) {
    debug('No executable path for %s: %s', browser, ex.message);
    return null;
  }
};

/**
 * Whether a browser is on the machine. No launch: the file is either where
 * playwright would look for it or it is not.
 *
 * @param {string} [browser] - chromium, firefox or webkit
 * @returns {boolean}
 */
const isInstalled = (browser: string = 'chromium'): boolean => {
  const file = executablePath(browser);

  if (!file) { return false; }

  try {
    return fs.existsSync(file);
  }
  catch (ex) {
    debug('Could not look for %s: %s', file, ex.message);
    return false;
  }
};

/**
 * Which of the browsers asked for are not on the machine.
 *
 * @param {string[]} [wanted] - Defaults to the one the examples use
 * @returns {string[]}
 */
const missing = (wanted: string[] = DEFAULT_BROWSERS): string[] =>
  wanted.filter(browser => !isInstalled(browser));

/**
 * What `--install-browsers` said.
 *
 * The flag answers the question before it is asked, which is what a pipeline
 * needs and what somebody who already knows the answer wants. Its value says
 * which browsers: nothing for the one the examples use, `all` for the three, or
 * a comma separated list of names.
 *
 * @param {*} flag - The flag as yargs-parser read it: undefined when it was not
 *                   given, false for --no-install-browsers, true, or a value
 * @returns {Object} { answer, browsers } -- `answer` is null when nothing was said
 */
const asked = (flag?: unknown): { answer: boolean | null, browsers: string[] } => {
  if (flag === undefined || flag === null) { return { answer: null, browsers: DEFAULT_BROWSERS }; }
  if (flag === false) { return { answer: false, browsers: [] }; }
  if (flag === true) { return { answer: true, browsers: DEFAULT_BROWSERS }; }

  const names = String(flag).split(',').map(name => name.trim().toLowerCase()).filter(Boolean);

  if (names.includes('all')) { return { answer: true, browsers: [...BROWSERS] }; }

  const known = names.filter(name => BROWSERS.includes(name));
  const unknown = names.filter(name => !BROWSERS.includes(name));

  if (unknown.length) {
    console.warn(
      `Not a playwright browser, and ignored: ${list(unknown)}. `
      + `The three are ${list(BROWSERS)}.`
    );
  }

  return { answer: true, browsers: known.length ? known : DEFAULT_BROWSERS };
};

/** What the context remembers about the question. */
const stored = async (): Promise<Stored> => (await configHelper.load(CONFIG_NAME)) || {};

/**
 * Remember the answer, so the next start does not ask it again.
 * @param {boolean} install - What they said
 */
const remember = async (install: boolean): Promise<void> => {
  await configHelper.save(CONFIG_NAME, {
    ...(await stored()),
    install,
    decidedAt: new Date().toISOString()
  });
};

/**
 * Forget it, so the question comes back. This is what changing your mind
 * amounts to: `--install-browsers` once, and the stored no is gone whether or
 * not that download works.
 */
const forget = async (): Promise<void> => {
  const current = await stored();

  if (current.install === undefined) { return; }

  const { install, decidedAt, ...rest } = current;
  debug('Forgetting the stored answer (was %o, from %s)', install, decidedAt);

  await configHelper.save(CONFIG_NAME, rest);
};

/** The log file's path, inside the context. */
const logFile = async (): Promise<string> => paths.contextDir(LOG_FILE);

/**
 * The log file, open for appending -- or null when it cannot be, which is not
 * a reason to skip the download: the output is a convenience.
 */
const openLog = (file: string): number | null => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return fs.openSync(file, 'a');
  }
  catch (ex) {
    debug('Could not open %s: %s', file, ex.message);
    return null;
  }
};

interface Download {
  /** Where the output is being written, for whoever wants to read along */
  log: string;
  /** Resolves when it is over, whichever way it went. Never rejects */
  finished: Promise<{ ok: boolean, code: number | null }>;
}

/**
 * Start the download and leave it running.
 *
 * `npx playwright install` is what playwright documents, what our own error
 * message tells people to run, and therefore what runs here: one way of doing
 * it, so there is no second way to keep in step. It runs in the context, where
 * the tool -- and so playwright -- is installed.
 *
 * Nobody is watching it, which is the whole point, so the output goes to a file
 * rather than over the top of a UI that is starting at the same time. What the
 * terminal gets is one line when it ends.
 *
 * @param {string[]} browsers - What to download
 * @returns {Promise<Download>}
 */
const download = async (browsers: string[]): Promise<Download> => {
  const log = await logFile();
  const output = openLog(log);
  const cwd = await paths.contextRoot();

  // The log is appended to rather than replaced -- a second attempt should not
  // erase what the first one said about why it failed -- so each attempt says
  // where it starts and what it ran
  if (output !== null) {
    try { fs.writeSync(output, `\n=== ${new Date().toISOString()} -- ${command(browsers)} ===\n`); }
    catch (ex) { debug('Could not write the log header: %s', ex.message); }
  }

  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const stdio = ['ignore', output ?? 'ignore', output ?? 'ignore'];

  debug('Running %s %o in %s', executable, commandParts(browsers), cwd);
  const child = spawn(executable, commandParts(browsers), { cwd, stdio } as any);

  const finished = new Promise<{ ok: boolean, code: number | null }>(resolve => {
    const done = (ok: boolean, code: number | null, line: string) => {
      if (output !== null) {
        try { fs.closeSync(output); }
        catch (ex) { debug('Could not close the log: %s', ex.message); }
      }

      console.log(line);
      resolve({ ok, code });
    };

    const names = `${list(browsers)} browser${browsers.length > 1 ? 's' : ''}`;

    child.on('error', (ex: Error) => done(
      false, null,
      `Could not download the ${names}: ${ex.message}. Run "${command(browsers)}" when you get the chance.`
    ));

    child.on('close', (code: number) => code === 0
      ? done(true, code, `The ${names} finished downloading: browser flows can run now.`)
      : done(false, code, `Downloading the ${names} failed (${command(browsers)} exited with ${code}) -- see ${log}.`)
    );
  });

  return { log, finished };
};

interface Decision {
  /**
   * What became of it:
   * - `ready`       everything asked for is already on the machine
   * - `installing`  the download has started, in the background
   * - `declined`    somebody was asked and said no, and it is remembered
   * - `remembered`  they said no at some earlier start, so nothing was asked
   * - `refused`     --no-install-browsers, which is this run's answer only
   * - `skipped`     nobody there to ask, so the start carried on
   * - `unknown`     the check itself went wrong, and the start carried on
   */
  status: 'ready' | 'installing' | 'declined' | 'remembered' | 'refused' | 'skipped' | 'unknown';
  /** The browsers that are missing, when any are */
  browsers: string[];
  /** The download, when one was started */
  download?: Download;
}

/**
 * Make sure the browsers are there, without ever standing in the way of the
 * tool starting.
 *
 * Every path through this ends with the start carrying on: a browser that is
 * not there is a flow's problem when it runs -- and one it already reports
 * properly -- never a reason to refuse to open the UI. Which is why nothing
 * here throws, and the download is not waited for.
 *
 * @param {Object} [options]
 * @param {*} [options.install] - What --install-browsers said
 * @returns {Promise<Decision>}
 */
const ensure = async ({ install: flag }: { install?: unknown } = {}): Promise<Decision> => {
  try {
    const { answer, browsers: wanted } = asked(flag);

    // --no-install-browsers: not even the look on disk. It is this run's
    // answer, and nothing about it is remembered
    if (answer === false) {
      debug('--no-install-browsers: nothing to do');
      return { status: 'refused', browsers: [] };
    }

    const absent = missing(wanted);

    if (!absent.length) {
      debug('Already installed: %s', list(wanted));
      return { status: 'ready', browsers: [] };
    }

    if (answer === null) {
      // Nothing was said on the command line, so: what they said last time,
      // what they say now, or -- with nobody there -- one line and on we go
      const current = await stored();

      if (current.install === false) {
        debug('Not asking again: config/%s.json says no', CONFIG_NAME);
        return { status: 'remembered', browsers: absent };
      }

      if (!cli.isInteractive) {
        console.log(`${notInstalled(absent)}: run "${command(absent)}" to run browser flows here.`);
        return { status: 'skipped', browsers: absent };
      }

      const yes = await cli.confirm(
        `${notInstalled(absent)}. Download ${absent.length > 1 ? 'them' : 'it'} now, in the background?`
      );

      if (!yes) {
        await remember(false);
        console.log(
          'Not downloading, and not asking again. Start with --install-browsers, '
          + `or run "${command(absent)}", to change your mind.`
        );
        return { status: 'declined', browsers: absent };
      }
    }
    else {
      // The flag is how somebody changes their mind: whatever was stored is
      // not what they want any more
      await forget();
    }

    const started = await download(absent);

    console.log(
      `Downloading the ${list(absent)} browser${absent.length > 1 ? 's' : ''} in the background. `
      + `The UI starts now; the output goes to ${started.log}.`
    );

    return { status: 'installing', browsers: absent, download: started };
  }
  catch (ex) {
    // The check is a convenience. A flow that needs a browser says so, with
    // the command to fix it, when it runs
    console.warn(`Could not check the playwright browsers: ${ex.message}`);
    return { status: 'unknown', browsers: [] };
  }
};

export type { Stored, Download, Decision };
export {
  BROWSERS,
  DEFAULT_BROWSERS,
  CONFIG_NAME,
  LOG_FILE,
  list,
  command,
  notInstalled,
  executablePath,
  isInstalled,
  missing,
  asked,
  remember,
  forget,
  download,
  ensure
};
