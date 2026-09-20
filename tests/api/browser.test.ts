// Opening the browser on the UI. The spawner is injected throughout: a test
// run that launched real browsers would be a test run nobody could watch.

import * as browser from '../../src/helpers/browser';

/** A spawn that records what it was asked to launch and launches nothing. */
const spawner = () => {
  const calls: Array<{ command: string; args: string[]; options: any }> = [];
  const child = { on: jest.fn(), unref: jest.fn() };

  const spawn = jest.fn((command: string, args: string[], options: any) => {
    calls.push({ command, args, options });
    return child;
  });

  return { spawn: spawn as any, calls, child };
};

describe('helpers/browser — the command per platform', () => {
  test('darwin opens with open', () => {
    expect(browser.command('http://127.0.0.1:3001', 'darwin'))
      .toEqual({ command: 'open', args: ['http://127.0.0.1:3001'] });
  });

  test('win32 goes through cmd, leaving the window title empty', () => {
    expect(browser.command('http://127.0.0.1:3001', 'win32'))
      .toEqual({ command: 'cmd', args: ['/c', 'start', '', 'http://127.0.0.1:3001'] });
  });

  test('anything else is xdg-open', () => {
    expect(browser.command('http://127.0.0.1:3001', 'linux'))
      .toEqual({ command: 'xdg-open', args: ['http://127.0.0.1:3001'] });
    expect(browser.command('http://127.0.0.1:3001', 'freebsd').command).toBe('xdg-open');
  });

  test('this machine\'s platform is the default', () => {
    expect(browser.command('http://127.0.0.1:3001').args).toContain('http://127.0.0.1:3001');
  });
});

describe('helpers/browser — whether to open at all', () => {
  test('a terminal somebody is watching, and no CI: yes', () => {
    expect(browser.wanted({ env: {}, isTTY: true })).toBe(true);
  });

  test('--no-open: no', () => {
    expect(browser.wanted({ open: false, env: {}, isTTY: true })).toBe(false);
  });

  test('CI: no', () => {
    expect(browser.wanted({ env: { CI: 'true' }, isTTY: true })).toBe(false);
    expect(browser.wanted({ env: { CI: '1' }, isTTY: true })).toBe(false);
  });

  test('no TTY: no', () => {
    expect(browser.wanted({ env: {}, isTTY: false })).toBe(false);
  });

  test('asked nothing, it reads this process', () => {
    expect(typeof browser.wanted()).toBe('boolean');
  });
});

describe('helpers/browser — launching it', () => {
  test('detached, with its output thrown away, and never waited on', () => {
    const { spawn, calls, child } = spawner();

    expect(browser.open('http://127.0.0.1:3457', { platform: 'darwin', spawn })).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('open');
    expect(calls[0].args).toEqual(['http://127.0.0.1:3457']);
    expect(calls[0].options).toEqual({ detached: true, stdio: 'ignore' });
    expect(child.unref).toHaveBeenCalled();
  });

  test('a browser that fails to start is not allowed to matter', () => {
    const { spawn, child } = spawner();

    browser.open('http://127.0.0.1:3457', { platform: 'linux', spawn });

    // The listener is what keeps a missing xdg-open from becoming an
    // unhandled 'error' event on the way out
    expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
    const listener = child.on.mock.calls[0][1] as () => void;
    expect(() => listener()).not.toThrow();
  });

  test('a spawn that throws outright is false, not an exception', () => {
    const spawn = jest.fn(() => { throw new Error('no such tool'); }) as any;

    expect(browser.open('http://127.0.0.1:3457', { platform: 'linux', spawn })).toBe(false);
  });

  test('a child with nothing on it is fine too', () => {
    const spawn = jest.fn(() => ({})) as any;

    expect(browser.open('http://127.0.0.1:3457', { platform: 'linux', spawn })).toBe(true);
  });
});
