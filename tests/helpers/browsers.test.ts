// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

/**
 * Where playwright would look for each browser. A name that is not a key
 * throws, which is what playwright itself does for a browser it does not
 * bundle -- and the check has to survive it.
 */
let EXECUTABLE: Record<string, string> = {};

const executablePath = jest.fn((browser: string) => {
  if (EXECUTABLE[browser] === undefined) { throw new Error(`Unsupported browser: ${browser}`); }
  return EXECUTABLE[browser];
});

jest.mock('playwright', () => ({
  chromium: { executablePath: () => executablePath('chromium') },
  firefox: { executablePath: () => executablePath('firefox') },
  webkit: { executablePath: () => executablePath('webkit') }
}));

// Whether anybody is there to answer, and what they answer
let INTERACTIVE = false;
const confirm = jest.fn();
jest.mock('../../src/helpers/cli', () => ({
  confirm: (...args: any[]) => confirm(...args),
  get isInteractive() { return INTERACTIVE; }
}));

// Nothing is downloaded in a test run: the spawn is the assertion
const spawn = jest.fn();
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: (...args: any[]) => spawn(...args)
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';

import * as paths from '../../src/helpers/paths';
import * as browsers from '../../src/helpers/browsers';

/** The context this run works in: the config and the log land in it. */
let directory: string;

const logged = () => (console.log as jest.Mock).mock.calls.map(c => c.join(' ')).join('\n');
const warned = () => (console.warn as jest.Mock).mock.calls.map(c => c.join(' ')).join('\n');

/** A browser playwright names and that is really on disk. */
const onDisk = (browser: string) => {
  const file = path.join(directory, 'browsers', browser, 'executable');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  EXECUTABLE[browser] = file;
  return file;
};

/** A browser playwright names and that was never downloaded. */
const absent = (browser: string) => {
  EXECUTABLE[browser] = path.join(directory, 'browsers', browser, 'executable');
};

/** The download this test decides the outcome of. */
const child = () => {
  const process = new EventEmitter();
  spawn.mockReturnValue(process);
  return process;
};

/** What ended up in config/browsers.json, if anything. */
const stored = () => {
  const file = path.join(directory, 'config', 'browsers.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

/** The arguments the spawn was given. */
const ran = () => spawn.mock.calls[0];

beforeEach(() => {
  jest.clearAllMocks();
  EXECUTABLE = {};
  INTERACTIVE = false;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ronsel-browsers-'));
  paths.useContext(directory);
  child();
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('looking for a browser', () => {
  test('it is installed when the file playwright names is there', () => {
    onDisk('chromium');

    expect(browsers.isInstalled('chromium')).toBe(true);
    // The whole point of the check: nothing was launched to find out
    expect(executablePath).toHaveBeenCalledWith('chromium');
  });

  test('and it is not when the file is not', () => {
    absent('chromium');

    expect(browsers.isInstalled('chromium')).toBe(false);
  });

  test('a browser playwright cannot even name is not installed either', () => {
    expect(browsers.isInstalled('chromium')).toBe(false);
    expect(browsers.executablePath('chromium')).toBeNull();
  });

  test('missing() answers for chromium unless it is told otherwise', () => {
    onDisk('chromium');
    absent('firefox');
    absent('webkit');

    expect(browsers.missing()).toEqual([]);
    expect(browsers.missing(browsers.BROWSERS)).toEqual(['firefox', 'webkit']);
  });
});

describe('the words it uses', () => {
  test('the command names the browser, and the three are the short form', () => {
    expect(browsers.command(['chromium'])).toBe('npx playwright install chromium');
    expect(browsers.command(['firefox', 'webkit'])).toBe('npx playwright install firefox webkit');
    expect(browsers.command(browsers.BROWSERS)).toBe('npx playwright install');
  });

  test('one browser is missing, or several are', () => {
    expect(browsers.notInstalled(['chromium'])).toContain('The chromium browser is not installed');
    expect(browsers.notInstalled(['firefox', 'webkit']))
      .toContain('The firefox and webkit browsers are not installed');
  });
});

describe('ensure, with nothing to do', () => {
  test('a browser that is already there is not mentioned at all', async () => {
    onDisk('chromium');

    const decision = await browsers.ensure();

    expect(decision).toEqual({ status: 'ready', browsers: [] });
    expect(confirm).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('ensure, with nobody to ask', () => {
  test('says it once and gets on with the start', async () => {
    absent('chromium');

    const decision = await browsers.ensure();

    expect(decision.status).toBe('skipped');
    expect(confirm).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(logged()).toContain('The chromium browser is not installed');
    expect(logged()).toContain('npx playwright install chromium');
    // A pipeline is never asked, and never remembers an answer it did not give
    expect(stored()).toBeNull();
  });
});

describe('ensure, with the flags', () => {
  test('--install-browsers downloads without asking, terminal or not', async () => {
    absent('chromium');
    INTERACTIVE = true;

    const decision = await browsers.ensure({ install: true });

    expect(confirm).not.toHaveBeenCalled();
    expect(decision.status).toBe('installing');
    expect(ran()[1]).toEqual(['playwright', 'install', 'chromium']);
  });

  test('--no-install-browsers asks nothing, downloads nothing, remembers nothing', async () => {
    absent('chromium');
    INTERACTIVE = true;

    const decision = await browsers.ensure({ install: false });

    expect(decision).toEqual({ status: 'refused', browsers: [] });
    expect(confirm).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    // The flag is this run's answer; only a person's "no" is remembered
    expect(stored()).toBeNull();
  });

  test('--install-browsers all takes the three, the way playwright spells it', async () => {
    absent('chromium');
    absent('firefox');
    absent('webkit');

    await browsers.ensure({ install: 'all' });

    expect(ran()[1]).toEqual(['playwright', 'install']);
  });

  test('a list names them, and only the ones that are missing are downloaded', async () => {
    onDisk('firefox');
    absent('webkit');

    await browsers.ensure({ install: 'firefox,webkit' });

    expect(ran()[1]).toEqual(['playwright', 'install', 'webkit']);
  });

  test('something that is not a browser is ignored, out loud', async () => {
    absent('chromium');

    await browsers.ensure({ install: 'edge' });

    expect(warned()).toContain('Not a playwright browser, and ignored: edge');
    expect(ran()[1]).toEqual(['playwright', 'install', 'chromium']);
  });
});

describe('ensure, with somebody to ask', () => {
  beforeEach(() => {
    INTERACTIVE = true;
    absent('chromium');
  });

  test('a yes starts the download and says where to watch it', async () => {
    confirm.mockResolvedValue(true);

    const decision = await browsers.ensure();

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('The chromium browser is not installed'));
    expect(decision.status).toBe('installing');
    expect(logged()).toContain('The UI starts now');
    expect(logged()).toContain(path.join('logs', 'playwright-install.log'));
  });

  test('a no is remembered, and the next start does not ask again', async () => {
    confirm.mockResolvedValue(false);

    const first = await browsers.ensure();

    expect(first.status).toBe('declined');
    expect(spawn).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ install: false, decidedAt: expect.any(String) });
    // And how to take it back
    expect(logged()).toContain('--install-browsers');

    confirm.mockClear();
    const second = await browsers.ensure();

    expect(second.status).toBe('remembered');
    expect(confirm).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test('--install-browsers is how somebody changes their mind', async () => {
    confirm.mockResolvedValue(false);
    await browsers.ensure();
    expect(stored()).toMatchObject({ install: false });

    await browsers.ensure({ install: true });

    // The stored no is gone: the question comes back if this download fails
    expect(stored().install).toBeUndefined();
    expect(spawn).toHaveBeenCalled();
  });
});

describe('the download itself', () => {
  beforeEach(() => absent('chromium'));

  test('runs npx in the context, writing to the log rather than over the UI', async () => {
    const running = child();

    const decision = await browsers.ensure({ install: true });

    const [executable, args, options] = ran();
    expect(executable).toMatch(/^npx/);
    expect(args).toEqual(['playwright', 'install', 'chromium']);
    expect(options.cwd).toBe(directory);
    expect(options.stdio[0]).toBe('ignore');
    // Somewhere to read along, and it is inside the context
    expect(decision.download!.log).toBe(path.join(directory, 'logs', 'playwright-install.log'));
    expect(fs.existsSync(decision.download!.log)).toBe(true);

    // The start did not wait for any of this
    running.emit('close', 0);
    await expect(decision.download!.finished).resolves.toEqual({ ok: true, code: 0 });
    expect(logged()).toContain('finished downloading');
  });

  test('a download that fails is one line, and the start already happened', async () => {
    const running = child();

    const decision = await browsers.ensure({ install: true });
    running.emit('close', 1);

    await expect(decision.download!.finished).resolves.toEqual({ ok: false, code: 1 });
    expect(logged()).toContain('failed');
    expect(logged()).toContain(decision.download!.log);
  });

  test('an npx that is not there at all is one line too', async () => {
    const running = child();

    const decision = await browsers.ensure({ install: true });
    running.emit('error', new Error('spawn npx ENOENT'));

    await expect(decision.download!.finished).resolves.toEqual({ ok: false, code: null });
    expect(logged()).toContain('Could not download the chromium browser: spawn npx ENOENT');
  });

  test('a log that cannot be written is not a reason to skip the download', async () => {
    // Something else owns the name: opening it for appending cannot work
    fs.mkdirSync(path.join(directory, 'logs', 'playwright-install.log'), { recursive: true });

    await browsers.ensure({ install: true });

    expect(ran()[2].stdio).toEqual(['ignore', 'ignore', 'ignore']);
  });
});

describe('ensure, when the check itself goes wrong', () => {
  test('it is a warning, and the start carries on', async () => {
    absent('chromium');
    // A config file somebody edited into something that is not JSON
    fs.mkdirSync(path.join(directory, 'config'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'config', 'browsers.json'), '{ nope');

    const decision = await browsers.ensure();

    expect(decision).toEqual({ status: 'unknown', browsers: [] });
    expect(warned()).toContain('Could not check the playwright browsers');
    expect(spawn).not.toHaveBeenCalled();
  });
});
