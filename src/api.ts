// The entry point that starts the API on its own: `npm run dev` runs this
// file, and `require('./api')` from the CLI resolves to it rather than to
// api/index -- Node prefers the file to the folder of the same name.

import * as api from './api/index';
import yargsParser from 'yargs-parser';

const argv = yargsParser(process.argv.slice(2));

/**
 * Start the API, from a command line or from the CLI.
 *
 * What the caller passes wins; what it leaves out is read off this process'
 * own arguments, which is how `tsx src/api.ts --context .dev-context --port
 * 4000` works. The URL comes back untouched: the port is chosen down in
 * api/index, and nobody above here should be guessing it.
 *
 * @param {Object} [options] - { context, port, host }
 * @returns {Promise<string>} The URL the UI is served on
 */
const start = async (
  options: { context?: string | null; port?: unknown; host?: unknown } = {}
): Promise<string> => {
  return api.start({
    context: options.context || argv.context || null,
    port: options.port === undefined ? argv.port : options.port,
    host: options.host === undefined ? argv.host : options.host
  });
};

export { start };

export const stop = async () => {
  await api.stop();
};

// Check if we'r running in the main process or just the script from cli

if (require.main === module) {
  start();
}
