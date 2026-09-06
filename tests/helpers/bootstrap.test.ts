jest.mock('yargs-parser', () => () => ({}));
jest.mock('../../src/helpers/paths');

import fs from 'fs';
import os from 'os';
import path from 'path';

import * as paths from '../../src/helpers/paths';
import * as bootstrap from '../../src/helpers/bootstrap';

let ctx: string;

beforeEach(() => {
  jest.clearAllMocks();
  ctx = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'));
  (paths.contextDir as jest.Mock).mockImplementation(
    async (parts: string[]) => path.join(ctx, ...(parts || []))
  );
});

afterEach(() => fs.rmSync(ctx, { recursive: true, force: true }));

describe('bootstrap.ensureDefaults', () => {
  test('creates the applications and flows folders', async () => {
    await bootstrap.ensureDefaults();
    expect(fs.existsSync(path.join(ctx, 'applications'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'flows'))).toBe(true);
  });

  test('seeds the bundled example applications and flows', async () => {
    await bootstrap.ensureDefaults();

    expect(fs.existsSync(path.join(ctx, 'applications', 'calculator', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'applications', 'httpbin'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'applications', 'jsonplaceholder'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'flows', 'examples', '01-welcome.md'))).toBe(true);
  });

  test('writes a marker so seeding only ever happens once', async () => {
    await bootstrap.ensureDefaults();
    const marker = path.join(ctx, '.examples-seeded');
    expect(fs.existsSync(marker)).toBe(true);
    expect(JSON.parse(fs.readFileSync(marker, 'utf8')).seededAt).toBeDefined();
  });

  test('a deleted example does not come back on the next start', async () => {
    await bootstrap.ensureDefaults();
    fs.rmSync(path.join(ctx, 'applications', 'calculator'), { recursive: true, force: true });

    await bootstrap.ensureDefaults();

    expect(fs.existsSync(path.join(ctx, 'applications', 'calculator'))).toBe(false);
  });

  test('an existing application folder is left untouched', async () => {
    const dest = path.join(ctx, 'applications', 'calculator');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'index.js'), '// mine');

    await bootstrap.ensureDefaults();

    expect(fs.readFileSync(path.join(dest, 'index.js'), 'utf8')).toBe('// mine');
  });

  test('an existing example flow is left untouched', async () => {
    const dest = path.join(ctx, 'flows', 'examples');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, '01-welcome.md'), '# mine');

    await bootstrap.ensureDefaults();

    expect(fs.readFileSync(path.join(dest, '01-welcome.md'), 'utf8')).toBe('# mine');
  });

  test('seeding never prevents the tool from starting', async () => {
    (paths.contextDir as jest.Mock).mockRejectedValue(new Error('no context'));

    await expect(bootstrap.ensureDefaults()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      'Could not seed default examples:', 'no context'
    );
  });
});

describe('bootstrap.ensureTypeScriptConfig', () => {
  const read = () => fs.readFileSync(path.join(ctx, 'tsconfig.json'), 'utf8');

  test('writes a tsconfig pointing at the types of this installation', async () => {
    await bootstrap.ensureTypeScriptConfig();

    const written = read();
    const config = JSON.parse(written.slice(written.indexOf('{')));

    // Resolved from the package root rather than matched against a folder
    // name: a checkout is not always named after the package, so asserting on
    // the name only ever tested what the clone directory happened to be called.
    const packageRoot = path.resolve(__dirname, '..', '..');
    const built = path.join(packageRoot, 'dist', 'index.d.ts');
    const expected = fs.existsSync(built) ? built : path.join(packageRoot, 'src', 'index.ts');

    expect(config.include).toEqual(['applications/**/*.ts']);
    expect(config.compilerOptions.paths['ronsel'][0]).toBe(expected);
    expect(config.compilerOptions.paths['@lab34/flows']).toEqual(
      config.compilerOptions.paths['ronsel']
    );
    expect(config.compilerOptions.paths['lab34-flows']).toEqual(
      config.compilerOptions.paths['ronsel']
    );
  });

  test('is created by ensureDefaults too', async () => {
    await bootstrap.ensureDefaults();
    expect(fs.existsSync(path.join(ctx, 'tsconfig.json'))).toBe(true);
  });

  test('refreshes a stale generated file, so the paths follow the install', async () => {
    await bootstrap.ensureTypeScriptConfig();
    const generated = read();

    fs.writeFileSync(path.join(ctx, 'tsconfig.json'), generated.replace(/"paths".*/, '"paths": {},'));
    await bootstrap.ensureTypeScriptConfig();

    expect(read()).toBe(generated);
  });

  test('a file the user took over is never rewritten', async () => {
    fs.writeFileSync(path.join(ctx, 'tsconfig.json'), '{ "mine": true }');
    await bootstrap.ensureTypeScriptConfig();
    expect(read()).toBe('{ "mine": true }');
  });

  test('a file generated before the rename is still rewritten', async () => {
    fs.writeFileSync(
      path.join(ctx, 'tsconfig.json'),
      '/* Generated by @lab34/flows. */\n{ "compilerOptions": {} }'
    );
    await bootstrap.ensureTypeScriptConfig();
    expect(read()).toContain('Generated by ronsel');
    expect(JSON.parse(read().replace(/^\/\*[\s\S]*?\*\/\n/, '')).compilerOptions.paths['ronsel']).toBeDefined();
  });

  test('leaves an up-to-date file alone', async () => {
    await bootstrap.ensureTypeScriptConfig();
    const before = fs.statSync(path.join(ctx, 'tsconfig.json')).mtimeMs;

    await bootstrap.ensureTypeScriptConfig();

    expect(fs.statSync(path.join(ctx, 'tsconfig.json')).mtimeMs).toBe(before);
  });

  test('a failure is reported, never thrown', async () => {
    (paths.contextDir as jest.Mock).mockRejectedValue(new Error('no context'));

    await expect(bootstrap.ensureTypeScriptConfig()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      'Could not write tsconfig.json for the applications:', 'no context'
    );
  });
});
