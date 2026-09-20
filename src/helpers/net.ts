import net from 'node:net';
import os from 'node:os';

/**
 * The address the UI ends up on, and everything derived from it.
 *
 * Nothing here is written down anywhere else: the port is chosen at start
 * time, the CORS origins follow from it, and the URL that gets printed and
 * opened is built from the same two values. The bundle knows none of it --
 * the UI talks to whatever origin served it -- so this module is the only
 * place that has to be right.
 */

/** Where the UI listens unless something says otherwise. */
export const DEFAULT_PORT = 3001;

/**
 * Loopback only. The API has no authentication of any kind and serves routes
 * that read the context's env files in the clear, so it is not something to
 * put on a network by accident -- only on purpose, with --host.
 */
export const DEFAULT_HOST = '127.0.0.1';

/** The Vite dev server's port. Fixed, and only ever used by `npm run dev`. */
export const DEV_PORT = 3000;

const MAX_PORT = 65535;

/** How far past the preferred port to look before giving up. */
const PORT_ATTEMPTS = 50;

/**
 * Whether an address is one only this machine can reach.
 *
 * `0.0.0.0` is not: it is every interface, which is the whole point of
 * --host and the reason it comes with a warning.
 *
 * @param {string} host - The address the server was told to listen on
 * @returns {boolean} True when nothing outside this machine can reach it
 */
export const isLoopback = (host: string): boolean => {
  const address = String(host || '').toLowerCase();

  return address === 'localhost'
    || address === '::1'
    || address === '[::1]'
    || address.startsWith('127.');
};

/**
 * Whether an address means "every interface" rather than a particular one.
 *
 * @param {string} host - The address the server was told to listen on
 * @returns {boolean} True for the wildcards, which name no reachable host
 */
export const isWildcard = (host: string): boolean => {
  const address = String(host || '').trim();
  return address === '' || address === '0.0.0.0' || address === '::' || address === '[::]';
};

/**
 * The port to start looking from: the flag, then PORT, then 3001.
 *
 * A value that is not a port is said out loud and stepped over -- the next
 * thing that names one decides instead. It is not worth refusing to start
 * for: where this ended up is printed either way.
 *
 * `0` is kept as it is: it means "any free port", which `freePort` resolves
 * into a real one before anything listens on it.
 *
 * @param {unknown} [flag] - What --port was given, if it was given
 * @param {NodeJS.ProcessEnv} [env] - Where PORT is read from
 * @returns {number} A port number, 0 included
 */
export const preferredPort = (flag?: unknown, env: NodeJS.ProcessEnv = process.env): number => {
  const candidates: Array<{ value: unknown; source: string }> = [
    { value: flag, source: '--port' },
    { value: env.PORT, source: 'PORT' }
  ];

  for (const { value, source } of candidates) {
    // A bare --port names no port, and neither does an empty PORT
    if (value === undefined || value === null || value === '' || value === true || value === false) { continue; }

    const port = Number(value);

    if (Number.isInteger(port) && port >= 0 && port <= MAX_PORT) { return port; }

    console.warn(`Ignoring ${source}=${value}: not a port number.`);
  }

  return DEFAULT_PORT;
};

/**
 * The address to listen on: the flag, then HOST, then loopback.
 *
 * `--host` on its own is the common case -- "let the others in" -- and yargs
 * reads it as `true`, which means every interface. `--host 192.168.1.20`
 * names one.
 *
 * @param {unknown} [flag] - What --host was given, if it was given
 * @param {NodeJS.ProcessEnv} [env] - Where HOST is read from
 * @returns {string} The address to bind
 */
export const resolveHost = (flag?: unknown, env: NodeJS.ProcessEnv = process.env): string => {
  if (flag === true) { return '0.0.0.0'; }
  if (typeof flag === 'string' && flag.trim()) { return flag.trim(); }
  if (env.HOST && env.HOST.trim()) { return env.HOST.trim(); }

  return DEFAULT_HOST;
};

/**
 * Whether a port can be bound on this host right now.
 *
 * Asked by binding it, because that is the only answer that is not a guess.
 * The port is handed back rather than a boolean so that port 0 -- "any free
 * port" -- resolves to the one the operating system picked.
 *
 * Only "taken" is answered with null. Anything else -- an address this
 * machine does not have, a port it is not allowed to bind -- is not something
 * the next port along would fix, so it is raised rather than walked past
 * fifty times and reported as a full range.
 *
 * @param {number} port - The port to try, or 0 for any
 * @param {string} host - The address to try it on
 * @returns {Promise<number|null>} The port that was free, or null when taken
 */
const probe = (port: number, host: string): Promise<number | null> => {
  return new Promise((resolve, reject) => {
    const probeServer = net.createServer();

    probeServer.unref();
    probeServer.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') { return resolve(null); }
      reject(error);
    });
    probeServer.listen({ port, host, exclusive: true }, () => {
      const address = probeServer.address();
      const bound = address && typeof address === 'object' ? address.port : port;
      probeServer.close(() => resolve(bound));
    });
  });
};

/**
 * The first free port at or after the preferred one.
 *
 * The preferred port is a starting point, never a requirement: a second
 * instance, or anything else already on 3001, moves this one along instead of
 * stopping it. Whatever it settles on is printed by the caller, so the port
 * is never chosen in silence.
 *
 * @param {number} [preferred] - Where to start looking
 * @param {string} [host] - The address the ports are tried on
 * @param {number} [attempts] - How many ports to try before giving up
 * @returns {Promise<number>} A port that was free a moment ago
 */
export const freePort = async (
  preferred: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
  attempts: number = PORT_ATTEMPTS
): Promise<number> => {
  const start = Number.isInteger(preferred) && preferred >= 0 ? preferred : DEFAULT_PORT;

  // Port 0 is already "whatever is free": one probe answers it
  const last = start === 0 ? 0 : Math.min(start + attempts - 1, MAX_PORT);

  for (let port = start; port <= last; port++) {
    const free = await probe(port, host);
    if (free !== null) { return free; }
  }

  throw new Error(`No free port between ${start} and ${last} on ${host}`);
};

/**
 * The addresses of this machine that something else on the network could use
 * to reach it.
 *
 * Only asked for when the server is exposed on purpose: the UI it serves is
 * then loaded from one of these, and the socket handshake that follows
 * carries it as its Origin.
 *
 * @returns {string[]} Non-internal IPv4 and IPv6 addresses, plus the hostname
 */
export const localAddresses = (): string[] => {
  const interfaces = Object.values(os.networkInterfaces())
    .flatMap(entries => entries || [])
    .filter(entry => !entry.internal)
    .map(entry => entry.address);

  return [...new Set([...interfaces, os.hostname()].filter(Boolean))];
};

/**
 * An origin, with IPv6 addresses bracketed as a URL needs them.
 *
 * @param {string} host - A hostname or address
 * @param {number} port - The port it is served on
 * @returns {string} `http://host:port`
 */
const origin = (host: string, port: number): string => {
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${bracketed}:${port}`;
};

/**
 * The origins allowed to call this API and open a socket to it.
 *
 * Computed from the address that was actually chosen, not written down: a
 * fixed list stops being true the moment the port moves. The 3000 entries
 * stay in it because `npm run dev` serves the UI from the Vite dev server,
 * which is a different origin from the API it proxies to.
 *
 * This is still a local tool, and the socket streams flow executions
 * (requests, responses, environment-derived data), so the list is only ever
 * this machine's own addresses -- never `*`, which would let any website
 * anybody has open read a run over localhost.
 *
 * @param {Object} [options] - { host, port, addresses }
 * @param {string} [options.host] - The address the server is bound to
 * @param {number} [options.port] - The port it settled on
 * @param {string[]} [options.addresses] - Extra names this machine answers to
 * @returns {string[]} The allowed origins, deduplicated
 */
export const allowedOrigins = (
  { host = DEFAULT_HOST, port = DEFAULT_PORT, addresses = [] }:
  { host?: string; port?: number; addresses?: string[] } = {}
): string[] => {
  const names = ['localhost', '127.0.0.1'];

  // A host named on purpose is also how a browser reaches it, so the UI it
  // serves has to be allowed to talk back. A wildcard names nothing: the
  // addresses it stands for are the ones the caller passes in
  if (!isWildcard(host) && !names.includes(host)) { names.push(host); }

  names.push(...addresses);

  const origins = [DEV_PORT, port]
    .flatMap(each => [...new Set(names)].map(name => origin(name, each)));

  return [...new Set(origins)];
};

/**
 * The URL to print and to open.
 *
 * A wildcard is not somewhere a browser can go, so what gets shown for it is
 * loopback -- which is where the person reading the line is.
 *
 * @param {Object} options - { host, port }
 * @param {string} [options.host] - The address the server is bound to
 * @param {number} [options.port] - The port it settled on
 * @returns {string} A URL that can be pasted into a browser
 */
export const url = (
  { host = DEFAULT_HOST, port = DEFAULT_PORT }: { host?: string; port?: number } = {}
): string => {
  return origin(isWildcard(host) ? 'localhost' : host, port);
};

/**
 * What to say when the server is not on loopback.
 *
 * There is no authentication anywhere in this API, and routes of it read the
 * context's env files, so "reachable from the network" is worth spelling out
 * rather than implying.
 *
 * @param {string} host - The address the server is bound to
 * @returns {string|null} The warning, or null when there is nothing to warn about
 */
export const exposureWarning = (host: string): string | null => {
  if (isLoopback(host)) { return null; }

  const where = isWildcard(host) ? 'every network interface' : host;

  return `Warning: listening on ${where}, not just this machine. This API has no `
    + 'authentication and serves the values of the context\'s env files, so anyone '
    + 'who can reach the port can read them.';
};
