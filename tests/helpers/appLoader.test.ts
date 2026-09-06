jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';

import * as appLoader from '../../src/helpers/appLoader';
import * as flows from '../../src/index';

let dir: string;

const write = (relative: string, content: string) => {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-'));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('appLoader.resolveSourceFile', () => {
  test('finds the TypeScript file', () => {
    const file = write('mimic.ts', 'export const start = () => {};');
    expect(appLoader.resolveSourceFile(dir, 'mimic')).toBe(file);
  });

  test('falls back to JavaScript', () => {
    const file = write('mimic.js', 'module.exports.start = () => {};');
    expect(appLoader.resolveSourceFile(dir, 'mimic')).toBe(file);
  });

  test('prefers TypeScript over a JavaScript file left behind', () => {
    const file = write('mimic.ts', 'export const start = () => {};');
    write('mimic.js', 'module.exports.start = () => {};');
    expect(appLoader.resolveSourceFile(dir, 'mimic')).toBe(file);
  });

  test('is null when neither is there', () => {
    expect(appLoader.resolveSourceFile(dir, 'mimic')).toBeNull();
  });
});

describe('appLoader.resolveEntry', () => {
  test('is the index file of the application', () => {
    const file = write('index.ts', 'export const x = 1;');
    expect(appLoader.resolveEntry(dir)).toBe(file);
  });

  test('is null for a folder with no code', () => {
    write('README.md', '# nothing to run');
    expect(appLoader.resolveEntry(dir)).toBeNull();
  });
});

describe('appLoader.transpile', () => {
  test('strips the types and emits CommonJS', () => {
    const output = appLoader.transpile('export const n: number = 1;', 'index.ts');

    expect(output).toContain('exports.n');
    expect(output).not.toContain(': number');
  });

  test('a type error is not its business', () => {
    expect(() => appLoader.transpile('const n: number = "text";', 'index.ts')).not.toThrow();
  });

  test('a syntax error names the file', () => {
    expect(() => appLoader.transpile('export const broken = (', 'index.ts'))
      .toThrow(/index\.ts/);
  });
});

describe('appLoader.load', () => {
  test('runs TypeScript and returns what it exports', () => {
    const file = write('index.ts', 'export const answer: number = 42;');
    expect(appLoader.load(file).answer).toBe(42);
  });

  test('runs JavaScript just the same', () => {
    const file = write('index.js', 'module.exports.answer = 42;');
    expect(appLoader.load(file).answer).toBe(42);
  });

  test('answers an import of the package with this process\'s own exports', () => {
    const file = write('index.ts', [
      "import { applications, httpClient } from 'ronsel';",
      'export const same = applications.handler === undefined ? null : { applications, httpClient };'
    ].join('\n'));

    expect(appLoader.load(file).same.applications).toBe(flows.applications);
    expect(appLoader.load(file).same.httpClient).toBe(flows.httpClient);
  });

  test.each(['@lab34/flows', 'lab34-flows'])('answers the names from before the rename too: %s', (name) => {
    const file = write('index.ts', `import { applications } from '${name}';\nexport const it = applications;`);
    expect(appLoader.load(file).it).toBe(flows.applications);
  });

  test('a subpath import reaches into the installation', () => {
    const file = write('index.ts', [
      "import * as replacer from 'ronsel/src/helpers/replacer';",
      'export const it = replacer;'
    ].join('\n'));

    expect(typeof appLoader.load(file).it.barcode).toBe('function');
  });

  test('re-reads the file, so an edit is picked up', () => {
    const file = write('index.ts', 'export const answer = 1;');
    expect(appLoader.load(file).answer).toBe(1);

    fs.writeFileSync(file, 'export const answer = 2;', 'utf8');
    expect(appLoader.load(file).answer).toBe(2);
  });

  test('a file that throws leaves nothing half-loaded behind', () => {
    const file = write('index.ts', 'throw new Error("boom");');

    expect(() => appLoader.load(file)).toThrow('boom');
    fs.writeFileSync(file, 'export const answer = 3;', 'utf8');
    expect(appLoader.load(file).answer).toBe(3);
  });
});

describe('appLoader.purge', () => {
  test('forgets what was loaded under a folder', () => {
    const file = write('index.ts', 'export const answer = 1;');
    appLoader.load(file);

    appLoader.purge(dir);

    expect(require('module')._cache[file]).toBeUndefined();
  });

  test('leaves everything else alone', () => {
    const file = write('index.ts', 'export const answer = 1;');
    appLoader.load(file);

    appLoader.purge(path.join(dir, 'other'));

    expect(require('module')._cache[file]).toBeDefined();
  });
});
