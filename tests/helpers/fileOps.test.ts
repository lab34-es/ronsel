// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';

// Every helper resolves its files through paths.contextDir: point it at a
// throwaway directory so the tests never touch the real ~/ronsel
const mockContext = fs.mkdtempSync(path.join(os.tmpdir(), 'ronsel-test-'));
const CONTEXT = mockContext;

jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (pathParts) =>
    require('path').join(mockContext, ...(pathParts || []))
}));

import * as apps from '../../src/helpers/applications';
import * as flows from '../../src/helpers/flows';

const appsDir = path.join(CONTEXT, 'applications');
const flowsDir = path.join(CONTEXT, 'flows');

const write = (file, content = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
};

beforeEach(() => {
  fs.rmSync(appsDir, { recursive: true, force: true });
  fs.rmSync(flowsDir, { recursive: true, force: true });
  write(path.join(appsDir, 'calculator', 'index.js'), '// calculator\n');
  write(path.join(appsDir, 'calculator', 'env', 'local.env'), 'A=1\n');
  write(path.join(flowsDir, 'team', 'login.md'), '# Login\n');
});

afterAll(() => {
  fs.rmSync(CONTEXT, { recursive: true, force: true });
});

describe('application files', () => {
  it('lists every file on disk plus the missing canonical ones', async () => {
    write(path.join(appsDir, 'calculator', 'lib', 'http.js'), '');

    const files = await apps.listAppFiles('calculator');
    const byPath = Object.fromEntries(files.map(file => [file.path, file.exists]));

    expect(byPath).toEqual({
      'README.md': false,
      'index.js': true,
      'env/local.env': true,
      'lib/http.js': true
    });
  });

  it('ignores node_modules', async () => {
    write(path.join(appsDir, 'calculator', 'node_modules', 'dep', 'index.js'), '');

    const files = await apps.listAppFiles('calculator');
    expect(files.some(file => file.path.includes('node_modules'))).toBe(false);
    await expect(apps.readAppFile('calculator', 'node_modules/dep/index.js')).rejects.toThrow();
  });

  it('creates a file, making its folders on the way', async () => {
    await apps.createAppFile('calculator', 'lib/http.js', 'module.exports = {};');

    expect(fs.readFileSync(path.join(appsDir, 'calculator', 'lib', 'http.js'), 'utf8'))
      .toBe('module.exports = {};');
  });

  it('refuses to create a file that already exists', async () => {
    await expect(apps.createAppFile('calculator', 'index.js', '')).rejects.toMatchObject({
      code: 'EEXISTS'
    });
    // The existing file is untouched
    expect(fs.readFileSync(path.join(appsDir, 'calculator', 'index.js'), 'utf8'))
      .toBe('// calculator\n');
  });

  it('renames a file and moves it to another folder', async () => {
    const result = await apps.renameAppFile('calculator', 'index.js', 'lib/index.js');

    expect(result).toEqual({ path: 'lib/index.js', previousPath: 'index.js' });
    expect(fs.existsSync(path.join(appsDir, 'calculator', 'index.js'))).toBe(false);
    expect(fs.existsSync(path.join(appsDir, 'calculator', 'lib', 'index.js'))).toBe(true);
  });

  it('renames a folder with everything inside it', async () => {
    await apps.renameAppFile('calculator', 'env', 'environments');

    expect(fs.existsSync(path.join(appsDir, 'calculator', 'environments', 'local.env'))).toBe(true);
  });

  it('refuses to rename onto an existing path', async () => {
    write(path.join(appsDir, 'calculator', 'README.md'), '# Calculator\n');

    await expect(apps.renameAppFile('calculator', 'index.js', 'README.md'))
      .rejects.toMatchObject({ code: 'EEXISTS' });
  });

  it('deletes a file and a folder', async () => {
    await apps.deleteAppFile('calculator', 'index.js');
    expect(fs.existsSync(path.join(appsDir, 'calculator', 'index.js'))).toBe(false);

    await apps.deleteAppFile('calculator', 'env');
    expect(fs.existsSync(path.join(appsDir, 'calculator', 'env'))).toBe(false);
  });

  it('rejects paths outside of the application folder', async () => {
    await expect(apps.createAppFile('calculator', '../escaped.js', '')).rejects
      .toThrow(/outside of the application directory/);
    await expect(apps.deleteAppFile('calculator', '../../etc/hosts')).rejects
      .toThrow(/outside of the application directory/);
    await expect(apps.renameAppFile('calculator', 'index.js', '../../index.js')).rejects
      .toThrow(/outside of the application directory/);
    expect(fs.existsSync(path.join(appsDir, 'calculator', 'index.js'))).toBe(true);
  });
});

describe('createApplication', () => {
  it('writes the template, named after the application', async () => {
    const result = await apps.createApplication('  my-api  ');

    expect(result).toMatchObject({ name: 'my-api', slug: 'my-api' });

    const index = fs.readFileSync(path.join(appsDir, 'my-api', 'index.ts'), 'utf8');
    expect(index).toContain('helloWorld');
    // The placeholder is replaced everywhere, example steps included
    expect(index).not.toContain('__APPLICATION_NAME__');
    expect(index).toContain('application: my-api');

    const readme = fs.readFileSync(path.join(appsDir, 'my-api', 'README.md'), 'utf8');
    expect(readme).toContain('# my-api');
    expect(readme).not.toContain('__APPLICATION_NAME__');

    // Nested folders of the template are copied too
    expect(fs.readFileSync(path.join(appsDir, 'my-api', 'env', 'local.env'), 'utf8'))
      .toContain('BASE_URL=');
  });

  it('creates the applications directory when it is not there yet', async () => {
    fs.rmSync(appsDir, { recursive: true, force: true });

    await apps.createApplication('my-api');

    expect(fs.existsSync(path.join(appsDir, 'my-api', 'index.ts'))).toBe(true);
  });

  it('the application it writes is parsed, with its methods', async () => {
    await apps.createApplication('my-api');

    const [parsed] = (await apps.parseApplications()).filter(app => app.slug === 'my-api');

    expect(parsed.errors).toEqual([]);
    expect(parsed.methods.map(method => method.name).sort())
      .toEqual(['helloWorld', 'ping', 'repeatGreeting']);
    expect(parsed.description).toContain('my-api');
    expect(parsed.readme).toContain('# my-api');
  });

  it('refuses a name that is taken, a path, or empty', async () => {
    await expect(apps.createApplication('calculator')).rejects
      .toMatchObject({ code: 'EEXISTS' });
    await expect(apps.createApplication('nested/app')).rejects
      .toThrow(/Invalid application name/);
    await expect(apps.createApplication('.hidden')).rejects
      .toThrow(/Invalid application name/);
    await expect(apps.createApplication('   ')).rejects
      .toThrow(/Application name is required/);
  });
});

describe('renameApplication', () => {
  it('renames the application folder', async () => {
    const result = await apps.renameApplication('calculator', 'maths');

    expect(result).toMatchObject({ slug: 'maths', previousName: 'calculator' });
    expect(fs.existsSync(path.join(appsDir, 'maths', 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(appsDir, 'calculator'))).toBe(false);
  });

  it('refuses a name that is taken, a path, or an unknown application', async () => {
    fs.mkdirSync(path.join(appsDir, 'maths'), { recursive: true });

    await expect(apps.renameApplication('calculator', 'maths')).rejects
      .toMatchObject({ code: 'EEXISTS' });
    await expect(apps.renameApplication('calculator', '../maths')).rejects
      .toThrow(/Invalid application name/);
    await expect(apps.renameApplication('calculator', '')).rejects
      .toThrow(/Application name is required/);
    await expect(apps.renameApplication('unknown', 'maths')).rejects
      .toThrow(/Application not found/);
  });
});

describe('flows.rename', () => {
  it('renames a flow file', async () => {
    const result = await flows.rename('team/login.md', 'team/sign-in.md');

    expect(result.relativePath).toBe(path.join('team', 'sign-in.md'));
    expect(fs.existsSync(path.join(flowsDir, 'team', 'sign-in.md'))).toBe(true);
    expect(fs.existsSync(path.join(flowsDir, 'team', 'login.md'))).toBe(false);
  });

  it('renames a folder with everything inside it', async () => {
    await flows.rename('team', 'squad');

    expect(fs.existsSync(path.join(flowsDir, 'squad', 'login.md'))).toBe(true);
  });

  it('rejects unsupported formats, taken names and paths outside the flows dir', async () => {
    await expect(flows.rename('team/login.md', 'team/login.txt')).rejects
      .toThrow(/Unsupported file format/);

    write(path.join(flowsDir, 'team', 'other.md'), '# Other\n');
    await expect(flows.rename('team/login.md', 'team/other.md')).rejects
      .toMatchObject({ code: 'EEXISTS' });

    await expect(flows.rename('team/login.md', '../escaped.md')).rejects
      .toThrow(/outside of the flows directory/);
    await expect(flows.rename('team/missing.md', 'team/found.md')).rejects
      .toThrow(/Path not found/);
    expect(fs.existsSync(path.join(flowsDir, 'team', 'login.md'))).toBe(true);
  });

  it('refuses to move a folder inside itself', async () => {
    await expect(flows.rename('team', 'team/nested')).rejects
      .toThrow(/inside itself/);
  });
});

describe('flows.saveProperties', () => {
  const flowPath = path.join(flowsDir, 'team', 'checkout.md');

  const BODY = [
    '# Checkout',
    '',
    'Some prose.',
    '',
    '```step',
    'application: calculator',
    'method: add',
    '```',
    ''
  ].join('\n');

  beforeEach(() => {
    write(flowPath, `---\ntitle: Checkout\nowner: ana\n---\n\n${BODY}`);
  });

  it('rewrites the frontmatter and leaves the body untouched', async () => {
    await flows.saveProperties({
      relativePath: 'team/checkout.md',
      properties: { title: 'Checkout', owner: 'bruno', priority: 5 }
    });

    const parsed = flows.parseValue(fs.readFileSync(flowPath, 'utf8'));
    expect(parsed.properties).toEqual({ title: 'Checkout', owner: 'bruno', priority: 5 });
    expect(parsed.steps).toHaveLength(1);
    expect(fs.readFileSync(flowPath, 'utf8')).toContain(BODY);
  });

  it('writes title and description first, whatever order they arrive in', async () => {
    await flows.saveProperties({
      relativePath: 'team/checkout.md',
      properties: { owner: 'ana', description: 'What it does', title: 'Checkout' }
    });

    const lines = fs.readFileSync(flowPath, 'utf8').split('\n');
    expect(lines.slice(1, 4)).toEqual(['title: Checkout', 'description: What it does', 'owner: ana']);
  });

  it('writes an empty value as a bare key rather than an empty string', async () => {
    await flows.saveProperties({
      relativePath: 'team/checkout.md',
      properties: { title: 'Checkout', epic: '' }
    });

    expect(fs.readFileSync(flowPath, 'utf8')).toContain('\nepic: null\n');
    expect(flows.parseValue(fs.readFileSync(flowPath, 'utf8')).properties.epic).toBeNull();
  });

  it('removes a property that is no longer sent', async () => {
    await flows.saveProperties({
      relativePath: 'team/checkout.md',
      properties: { title: 'Checkout' }
    });

    expect(flows.parseValue(fs.readFileSync(flowPath, 'utf8')).properties)
      .toEqual({ title: 'Checkout' });
  });

  it('refuses to escape the flows directory', async () => {
    await expect(flows.saveProperties({
      relativePath: '../../escape.md',
      properties: {}
    })).rejects.toThrow(/outside of the flows directory/);
  });

  it('refuses a missing flow, and a non-object payload', async () => {
    await expect(flows.saveProperties({
      relativePath: 'team/nope.md',
      properties: {}
    })).rejects.toThrow(/Flow not found/);

    await expect(flows.saveProperties({
      relativePath: 'team/checkout.md',
      properties: 'nope'
    })).rejects.toThrow(/must be an object/);
  });
});
