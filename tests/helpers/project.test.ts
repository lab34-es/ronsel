// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

const spawn = jest.fn();
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: (...args: any[]) => spawn(...args)
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';

import * as project from '../../src/helpers/project';

let directory: string;

beforeEach(() => {
  jest.clearAllMocks();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ronsel-project-'));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

const manifest = () => JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));

describe('packageNameFor', () => {
  test('the folder name, made into something npm accepts', () => {
    expect(project.packageNameFor('/tmp/My Flows!')).toBe('my-flows');
  });

  test('a folder whose name survives nothing still gets a name', () => {
    expect(project.packageNameFor('/tmp/...')).toBe('ronsel-context');
  });
});

describe('ensurePackageJson', () => {
  test('writes one that runs the tool, when there is none', () => {
    const result = project.ensurePackageJson({ directory, version: '2.3.4' });

    expect(result.created).toBe(true);
    expect(result.scriptTaken).toBe(false);
    expect(manifest()).toMatchObject({
      private: true,
      scripts: { ronsel: 'ronsel --context .' },
      devDependencies: { ronsel: '^2.3.4' }
    });
  });

  test('an existing one keeps its keys, its indentation and its scripts', () => {
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      '{\n    "name": "theirs",\n    "scripts": {\n        "test": "jest"\n    }\n}\n'
    );

    const result = project.ensurePackageJson({ directory, version: '2.3.4' });

    expect(result.created).toBe(false);
    expect(result.changes).toHaveLength(2);
    expect(manifest()).toMatchObject({
      name: 'theirs',
      scripts: { test: 'jest', ronsel: 'ronsel --context .' },
      devDependencies: { ronsel: '^2.3.4' }
    });

    // Their four spaces, not ours
    expect(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).toContain('\n    "name"');
  });

  test('a "ronsel" script somebody else wrote is reported, never replaced', () => {
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ scripts: { ronsel: 'ronsel --view smoke --env uat' } }, null, 2)
    );

    const result = project.ensurePackageJson({ directory, version: '2.3.4' });

    expect(result.scriptTaken).toBe(true);
    expect(manifest().scripts.ronsel).toBe('ronsel --view smoke --env uat');
  });

  test('the tool declared as a dependency is left where it is', () => {
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ dependencies: { ronsel: '1.0.0' }, scripts: { ronsel: 'ronsel --context .' } }, null, 2)
    );

    const result = project.ensurePackageJson({ directory, version: '2.3.4' });

    expect(result.changes).toEqual([]);
    expect(manifest().devDependencies).toBeUndefined();
    expect(manifest().dependencies.ronsel).toBe('1.0.0');
  });

  test('a package.json that is not JSON stops the setup, saying which file', () => {
    fs.writeFileSync(path.join(directory, 'package.json'), '{ nope');

    expect(() => project.ensurePackageJson({ directory, version: '2.3.4' }))
      .toThrow(/package\.json is not valid JSON/);
  });
});

describe('ensureGitignore', () => {
  test('writes one when there is none', () => {
    expect(project.ensureGitignore(directory)).toEqual(['created .gitignore']);
    expect(fs.readFileSync(path.join(directory, '.gitignore'), 'utf8'))
      .toBe('node_modules/\ntest-runs/\n');
  });

  test('only the missing lines are appended, and a file with no newline survives it', () => {
    fs.writeFileSync(path.join(directory, '.gitignore'), 'node_modules/');

    expect(project.ensureGitignore(directory)).toEqual(['added test-runs/ to .gitignore']);
    expect(fs.readFileSync(path.join(directory, '.gitignore'), 'utf8'))
      .toBe('node_modules/\ntest-runs/\n');
  });

  test('nothing is written when everything is already ignored', () => {
    fs.writeFileSync(path.join(directory, '.gitignore'), 'test-runs/\nnode_modules/\n');

    expect(project.ensureGitignore(directory)).toEqual([]);
  });
});

describe('isInstalled', () => {
  test('true once the package is on disk', () => {
    expect(project.isInstalled(directory)).toBe(false);

    fs.mkdirSync(path.join(directory, 'node_modules', 'ronsel'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'node_modules', 'ronsel', 'package.json'), '{}');

    expect(project.isInstalled(directory)).toBe(true);
  });
});

describe('install', () => {
  /** A spawned npm, whose exit this test decides. */
  const npm = () => {
    const child = new EventEmitter();
    spawn.mockReturnValue(child);
    return child;
  };

  test('runs npm install in the folder, showing its output', async () => {
    const child = npm();
    const running = project.install(directory);

    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm/), ['install'], { cwd: directory, stdio: 'inherit' }
    );

    child.emit('close', 0);
    await expect(running).resolves.toBeUndefined();
  });

  test('a non-zero exit is an error, with the code in it', async () => {
    const child = npm();
    const running = project.install(directory);

    child.emit('close', 1);
    await expect(running).rejects.toThrow('npm install exited with code 1');
  });

  test('npm not being there at all is said plainly', async () => {
    const child = npm();
    const running = project.install(directory);

    child.emit('error', new Error('spawn npm ENOENT'));
    await expect(running).rejects.toThrow('could not run npm install: spawn npm ENOENT');
  });
});
