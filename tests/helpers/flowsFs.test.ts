jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';

// Every helper resolves through paths.contextDir: point it at a throwaway
// directory so the tests never touch the real ~/ronsel.
const CONTEXT = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-fs-'));
jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (parts) => require('path').join(CONTEXT, ...(parts || []))
}));

jest.mock('../../src/helpers/applications');
jest.mock('../../src/helpers/aiFlows');

import * as flows from '../../src/helpers/flows';
import * as apps from '../../src/helpers/applications';
import * as aiFlows from '../../src/helpers/aiFlows';

const flowsDir = path.join(CONTEXT, 'flows');

const write = (relative: string, content = '') => {
  const file = path.join(flowsDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
};

const MARKDOWN = [
  '---', 'title: Pay with card', 'description: Happy path', '---', '',
  'Intro', '', '```step', 'application: calculator', 'method: add', '```', ''
].join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  fs.rmSync(flowsDir, { recursive: true, force: true });
  fs.mkdirSync(flowsDir, { recursive: true });
});

afterAll(() => fs.rmSync(CONTEXT, { recursive: true, force: true }));

describe('flows.list', () => {
  test('is empty when the flows directory does not exist', async () => {
    fs.rmSync(flowsDir, { recursive: true, force: true });
    expect(await flows.list()).toEqual([]);
  });

  test('finds flows at the root and in subfolders', async () => {
    write('a.md', MARKDOWN);
    write('team/b.markdown', MARKDOWN);

    const list = await flows.list();

    expect(list).toHaveLength(2);
    expect(list.map(f => f.relativePath).sort()).toEqual(['a.md', path.join('team', 'b.markdown')]);
  });

  test('reports the category from the containing folder', async () => {
    write('a.md', MARKDOWN);
    write('team/b.md', MARKDOWN);

    const list = await flows.list();

    expect(list.find(f => f.relativePath === 'a.md')!.category).toBe('root');
    expect(list.find(f => f.relativePath.includes('team'))!.category).toBe('team');
  });

  test('uses the frontmatter title, falling back to the file name', async () => {
    write('titled.md', MARKDOWN);
    write('no-title_here.md', 'just some prose\n');

    const list = await flows.list();

    expect(list.find(f => f.relativePath === 'titled.md')!.title).toBe('Pay with card');
    expect(list.find(f => f.relativePath === 'no-title_here.md')!.title).toBe('No Title Here');
  });

  test('counts the steps', async () => {
    write('a.md', MARKDOWN);
    expect((await flows.list())[0].stepsCount).toBe(1);
  });

  test('ignores files with an unsupported extension', async () => {
    write('notes.txt', 'hello');
    write('a.md', MARKDOWN);
    expect(await flows.list()).toHaveLength(1);
  });
});

describe('flows.tree', () => {
  test('is empty when the flows directory does not exist', async () => {
    fs.rmSync(flowsDir, { recursive: true, force: true });
    expect(await flows.tree()).toEqual([]);
  });

  test('nests folders and puts them before flows', async () => {
    write('z-root.md', MARKDOWN);
    write('alpha/inner.md', MARKDOWN);

    const tree = await flows.tree();

    expect(tree[0].type).toBe('folder');
    expect(tree[0].name).toBe('alpha');
    expect(tree[0].children![0].name).toBe('inner.md');
    expect(tree[1].type).toBe('flow');
  });

  test('sorts alphabetically within each group', async () => {
    write('b.md', MARKDOWN);
    write('a.md', MARKDOWN);
    const tree = await flows.tree();
    expect(tree.map(n => n.name)).toEqual(['a.md', 'b.md']);
  });

  test('skips dot files and unsupported extensions', async () => {
    write('.hidden.md', MARKDOWN);
    write('notes.txt', 'x');
    write('a.md', MARKDOWN);

    const tree = await flows.tree();

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('a.md');
  });

  test('flags a flow whose steps do not parse', async () => {
    write('broken.md', '```step\n: : :\n```\n');
    const tree = await flows.tree();
    expect(tree[0].hasErrors).toBe(true);
  });
});

describe('flows.getUserFlow', () => {
  test('rejects a path that was not given', async () => {
    await expect(flows.getUserFlow(undefined)).rejects.toThrow('Flow not found');
  });

  test('rejects a file that does not exist', async () => {
    await expect(flows.getUserFlow(path.join(flowsDir, 'nope.md'))).rejects.toThrow('Flow not found');
  });

  test('refuses to read outside the flows directory', async () => {
    const outside = path.join(CONTEXT, 'outside.md');
    fs.writeFileSync(outside, MARKDOWN);
    await expect(flows.getUserFlow(outside)).rejects.toThrow('Flow not found');
  });

  test('refuses an unsupported extension inside the flows directory', async () => {
    const file = write('notes.txt', 'hello');
    await expect(flows.getUserFlow(file)).rejects.toThrow('Flow not found');
  });

  test('returns the parsed flow plus its raw text', async () => {
    const file = write('team/a.md', MARKDOWN);

    const flow = await flows.getUserFlow(file);

    expect(flow.title).toBe('Pay with card');
    expect(flow.relativePath).toBe('team/a.md');
    expect(flow.plainText).toBe(MARKDOWN);
    expect(flow.steps).toHaveLength(1);
  });

  test('falls back to the file name when there is no title', async () => {
    const file = write('my_flow.md', 'body only, no heading\n');
    expect((await flows.getUserFlow(file)).title).toBe('My Flow');
  });
});

describe('flows.createFolder', () => {
  test('creates it and reports the relative path', async () => {
    const result = await flows.createFolder('team/sub');
    expect(result.relativePath).toBe('team/sub');
    expect(fs.existsSync(path.join(flowsDir, 'team', 'sub'))).toBe(true);
  });

  test('requires a path', async () => {
    await expect(flows.createFolder('')).rejects.toThrow('Folder path is required');
    await expect(flows.createFolder('   ')).rejects.toThrow('Folder path is required');
  });

  test('refuses the flows directory itself', async () => {
    await expect(flows.createFolder('.')).rejects.toThrow('Folder path is required');
  });

  test('refuses to escape the flows directory', async () => {
    await expect(flows.createFolder('../escaped')).rejects.toThrow(/outside of the flows directory/);
  });
});

describe('flows.saveFile', () => {
  test('writes the file and reports where it went', async () => {
    const result = await flows.saveFile({ relativePath: 'new.md', content: '# hi' });
    expect(result.relativePath).toBe('new.md');
    expect(fs.readFileSync(path.join(flowsDir, 'new.md'), 'utf8')).toBe('# hi');
  });

  test('creates missing parent folders', async () => {
    await flows.saveFile({ relativePath: 'a/b/c.md', content: 'x' });
    expect(fs.existsSync(path.join(flowsDir, 'a', 'b', 'c.md'))).toBe(true);
  });

  test('writes an empty file when given no content', async () => {
    await flows.saveFile({ relativePath: 'empty.md', content: undefined });
    expect(fs.readFileSync(path.join(flowsDir, 'empty.md'), 'utf8')).toBe('');
  });

  test('requires a path', async () => {
    await expect(flows.saveFile({ relativePath: '  ', content: 'x' }))
      .rejects.toThrow('File path is required');
  });

  test('rejects an unsupported extension', async () => {
    await expect(flows.saveFile({ relativePath: 'a.txt', content: 'x' }))
      .rejects.toThrow(/Unsupported file format ".txt"/);
  });

  test('refuses to overwrite unless asked, and reports EEXISTS', async () => {
    write('a.md', 'original');
    await expect(flows.saveFile({ relativePath: 'a.md', content: 'new' }))
      .rejects.toMatchObject({ message: 'File already exists', code: 'EEXISTS' });
    expect(fs.readFileSync(path.join(flowsDir, 'a.md'), 'utf8')).toBe('original');
  });

  test('overwrites when explicitly allowed', async () => {
    write('a.md', 'original');
    await flows.saveFile({ relativePath: 'a.md', content: 'new', overwrite: true });
    expect(fs.readFileSync(path.join(flowsDir, 'a.md'), 'utf8')).toBe('new');
  });

  test('refuses when a folder already owns the name', async () => {
    fs.mkdirSync(path.join(flowsDir, 'a.md'), { recursive: true });
    await expect(flows.saveFile({ relativePath: 'a.md', content: 'x', overwrite: true }))
      .rejects.toThrow('A folder with that name already exists');
  });
});

describe('flows.remove', () => {
  test('deletes a file', async () => {
    write('a.md', MARKDOWN);
    expect(await flows.remove('a.md')).toEqual({ relativePath: 'a.md' });
    expect(fs.existsSync(path.join(flowsDir, 'a.md'))).toBe(false);
  });

  test('deletes a folder and everything inside it', async () => {
    write('team/a.md', MARKDOWN);
    await flows.remove('team');
    expect(fs.existsSync(path.join(flowsDir, 'team'))).toBe(false);
  });

  test('requires a path', async () => {
    await expect(flows.remove('')).rejects.toThrow('Path is required');
  });

  test('refuses to delete the flows directory itself', async () => {
    await expect(flows.remove('.')).rejects.toThrow('Refusing to delete the flows directory itself');
  });

  test('reports a path that is not there', async () => {
    await expect(flows.remove('ghost.md')).rejects.toThrow('Path not found');
  });

  test('deletes a broken symlink', async () => {
    const link = path.join(flowsDir, 'broken.md');
    fs.symlinkSync(path.join(flowsDir, 'missing-target.md'), link);
    await flows.remove('broken.md');
    expect(fs.existsSync(path.dirname(link))).toBe(true);
  });
});

describe('flows.start', () => {
  const runner = require('../../src/helpers/runner/v1');

  test('requires a value and an environment', async () => {
    await expect(flows.start({ value: 'x' }, {}))
      .rejects.toThrow(/"value" and "environment" are required/);
    await expect(flows.start({ environment: 'local' }, {}))
      .rejects.toThrow(/"value" and "environment" are required/);
  });

  test('rejects a step block that does not parse', async () => {
    await expect(flows.start({ value: '```step\n[broken\n```\n', environment: 'local' }, {}))
      .rejects.toThrow(/Invalid markdown flow/);
  });

  test('rejects a document with no steps', async () => {
    await expect(flows.start({ value: '# Just prose\n', environment: 'local' }, {}))
      .rejects.toThrow(/no ```step blocks found/);
  });

  test('runs a markdown flow through the runner', async () => {
    const run = jest.spyOn(runner, 'run').mockResolvedValue({ execution: { id: 'e1' } });
    (apps.loadAll as jest.Mock).mockResolvedValue(undefined);

    const result = await flows.start({ value: MARKDOWN, environment: 'local' }, { io: 'socket' });

    expect(apps.loadAll).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Pay with card' }),
      expect.objectContaining({
        environment: 'local',
        reporter: { cli: false, server: 'socket' },
        // What records the run's test-run copy once the flow is over
        onFinished: expect.any(Function)
      })
    );
    expect(result).toEqual({ execution: { id: 'e1' } });
    run.mockRestore();
  });

  test('explains that another flow is already running', async () => {
    const run = jest.spyOn(runner, 'run').mockResolvedValue(undefined);
    (apps.loadAll as jest.Mock).mockResolvedValue(undefined);

    await expect(flows.start({ value: MARKDOWN, environment: 'local' }, {}))
      .rejects.toThrow('Another flow is already running. Wait for it to finish.');
    run.mockRestore();
  });

  test('records a test run holding the flow copy with its results', async () => {
    const runsDir = path.join(CONTEXT, 'test-runs');
    fs.rmSync(runsDir, { recursive: true, force: true });

    const run = jest.spyOn(runner, 'run').mockResolvedValue({ execution: { id: 'e1' } });
    (apps.loadAll as jest.Mock).mockResolvedValue(undefined);

    await flows.start({ value: MARKDOWN, environment: 'local', path: 'card/pay.md' }, {});

    // The run exists from the moment the flow was started
    const [runId] = fs.readdirSync(runsDir);
    let summary = JSON.parse(fs.readFileSync(path.join(runsDir, runId, 'run.json'), 'utf8'));
    expect(summary.status).toBe('running');
    expect(summary.trigger).toBe('flow');
    expect(summary.environment).toBe('local');
    expect(summary.flows[0]).toMatchObject({ file: 'card/pay.md', status: 'running' });

    // What the runner calls when the flow is over writes the copy
    const opts = run.mock.calls[0][1] as any;
    await opts.onFinished({
      execution: { status: 'passed', times: { start: 1000, end: 2000 } },
      steps: [{
        stepIndex: 0,
        execution: { status: 'passed', times: { start: 1000, end: 1500, duration: 0.5 } },
        request: { body: { a: 1 } },
        response: { status: 200, headers: {}, body: { sum: 3 } }
      }]
    });

    summary = JSON.parse(fs.readFileSync(path.join(runsDir, runId, 'run.json'), 'utf8'));
    expect(summary.status).toBe('passed');
    expect(summary.flows[0]).toMatchObject({
      status: 'passed',
      steps: { total: 1, passed: 1, failed: 0 }
    });

    const copy = fs.readFileSync(path.join(runsDir, runId, 'card', 'pay.md'), 'utf8');
    expect(copy).toContain('testRun:');
    expect(copy).toContain('```step-result');
    expect(copy).toContain('status: passed');

    run.mockRestore();
  });
});

describe('flows AI and capability passthroughs', () => {
  test('createAI delegates, defaulting the body', async () => {
    (aiFlows.create as jest.Mock).mockResolvedValue({ flow: '# x' });
    await flows.createAI(undefined);
    expect(aiFlows.create).toHaveBeenCalledWith({});
  });

  test('editAI delegates, defaulting the body', async () => {
    (aiFlows.edit as jest.Mock).mockResolvedValue({ flow: '# x' });
    await flows.editAI({ prompt: 'p' });
    expect(aiFlows.edit).toHaveBeenCalledWith({ prompt: 'p' });
  });

  test('listCapabilities delegates to the applications summary', async () => {
    (apps.summary as jest.Mock).mockResolvedValue(['calculator']);
    expect(await flows.listCapabilities()).toEqual(['calculator']);
  });
});
