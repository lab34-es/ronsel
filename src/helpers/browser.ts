import { spawn as spawnProcess } from 'node:child_process';

/**
 * Opening the default browser on the URL the UI ended up on.
 *
 * Every platform already ships the thing that does this -- `open`, `start`,
 * `xdg-open` -- so there is no dependency here, and none is worth adding to a
 * tree that pins every version it has.
 *
 * Nothing in here is allowed to matter: a machine with no browser, no
 * desktop session or no `xdg-open` still has a running server and a printed
 * URL, which is the whole of what was asked for. So the child is detached,
 * its output is thrown away, and every way it can fail ends in `false`
 * rather than in an exception.
 */

/** Just enough of child_process.spawn to launch and forget. */
type Spawner = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: 'ignore' }
) => { on?: (event: string, listener: () => void) => unknown; unref?: () => unknown };

interface OpenOptions {
  /** Defaults to this machine's platform; named by the tests instead */
  platform?: string;
  /** Defaults to child_process.spawn; the tests pass their own */
  spawn?: Spawner;
}

interface WantedOptions {
  /** False when --no-open was passed */
  open?: boolean;
  /** Where CI is read from */
  env?: NodeJS.ProcessEnv;
  /** Whether anybody is watching this terminal */
  isTTY?: boolean;
}

/**
 * The command that opens a URL on a given platform.
 *
 * The Windows form goes through `cmd /c start`, whose first quoted argument
 * is the window title -- hence the empty one, without which a URL would be
 * read as the title and nothing would open.
 *
 * @param {string} url - The URL to open
 * @param {string} [platform] - A process.platform value
 * @returns {Object} { command, args } ready for spawn
 */
export const command = (
  url: string,
  platform: string = process.platform
): { command: string; args: string[] } => {
  if (platform === 'darwin') { return { command: 'open', args: [url] }; }
  if (platform === 'win32') { return { command: 'cmd', args: ['/c', 'start', '', url] }; }

  return { command: 'xdg-open', args: [url] };
};

/**
 * Whether a browser should be opened at all.
 *
 * Three ways of saying no, and they are all somebody telling us this is not a
 * person sitting in front of a desktop: the flag, a pipeline that sets CI,
 * and a terminal nobody is attached to.
 *
 * @param {Object} [options] - { open, env, isTTY }
 * @returns {boolean} True when opening a browser is wanted
 */
export const wanted = ({
  open = true,
  env = process.env,
  isTTY = Boolean(process.stdout.isTTY)
}: WantedOptions = {}): boolean => {
  if (open === false) { return false; }
  if (env.CI) { return false; }

  return Boolean(isTTY);
};

/**
 * Open the default browser on a URL, or fail quietly.
 *
 * @param {string} url - The URL to open
 * @param {Object} [options] - { platform, spawn }
 * @returns {boolean} True when the command was launched, false when it could not be
 */
export const open = (url: string, options: OpenOptions = {}): boolean => {
  const { platform = process.platform, spawn = spawnProcess as unknown as Spawner } = options;
  const launch = command(url, platform);

  try {
    const child = spawn(launch.command, launch.args, { detached: true, stdio: 'ignore' });

    // A missing `xdg-open` reports itself asynchronously, and an unhandled
    // 'error' event would take the server down with it
    child?.on?.('error', () => {});
    // Nothing waits for the browser: this process must be able to exit
    child?.unref?.();

    return true;
  }
  catch {
    return false;
  }
};
