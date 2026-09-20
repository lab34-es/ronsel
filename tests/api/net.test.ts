// The address the API ends up on: the port it picks, the origins that follow
// from it, and what gets printed. Nothing here is a fixed list any more, so
// what is tested is the deriving.

import net from 'node:net';
import os from 'node:os';

import * as address from '../../src/helpers/net';

/** Servers held open by a test, closed again after it. */
const held: net.Server[] = [];

/**
 * Take a port so the selector has to walk past it.
 *
 * @param {number} [port] - The port to take, or 0 for any free one
 * @returns {Promise<number>} The port that ended up taken
 */
const hold = (port = 0): Promise<number> => new Promise(resolve => {
  const server = net.createServer();
  held.push(server);
  server.listen(port, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
});

afterEach(async () => {
  await Promise.all(held.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

describe('helpers/net — choosing a port', () => {
  test('0 means "any free port", and resolves to a real one', async () => {
    const port = await address.freePort(0);

    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  test('a free port is taken as it is', async () => {
    // Held and released: a port that was free a moment ago, and still is
    const free = await hold();
    await Promise.all(held.splice(0).map(server => new Promise(resolve => server.close(resolve))));

    await expect(address.freePort(free)).resolves.toBe(free);
  });

  test('a busy port moves the search along instead of stopping it', async () => {
    const busy = await hold();

    const port = await address.freePort(busy);

    expect(port).not.toBe(busy);
    expect(port).toBeGreaterThan(busy);
  });

  test('it gives up saying which range it looked in', async () => {
    const busy = await hold();

    // One attempt, on the one port that is taken
    await expect(address.freePort(busy, '127.0.0.1', 1))
      .rejects.toThrow(`No free port between ${busy} and ${busy} on 127.0.0.1`);
  });

  test('an address this machine does not have is said plainly, not walked past', async () => {
    // TEST-NET-1: never assigned to anything, so binding it cannot be
    // mistaken for a busy port
    await expect(address.freePort(3001, '192.0.2.1')).rejects.toThrow(/EADDRNOTAVAIL|EINVAL/);
  });

  test('nonsense for a preferred port starts the search at the default', async () => {
    await expect(address.freePort(-1)).resolves.toBeGreaterThanOrEqual(3001);
  });

  test('told nothing, it starts at 3001', async () => {
    await expect(address.freePort()).resolves.toBeGreaterThanOrEqual(3001);
  });
});

describe('helpers/net — where the port comes from', () => {
  test('the default, with nothing said', () => {
    expect(address.preferredPort(undefined, {})).toBe(3001);
  });

  test('PORT, set by hand', () => {
    expect(address.preferredPort(undefined, { PORT: '4321' })).toBe(4321);
  });

  test('--port wins over PORT', () => {
    expect(address.preferredPort('5000', { PORT: '4321' })).toBe(5000);
  });

  test('PORT=0 is kept: it means any free port', () => {
    expect(address.preferredPort(undefined, { PORT: '0' })).toBe(0);
  });

  test('a bare --port says nothing, so PORT still decides', () => {
    expect(address.preferredPort(true, { PORT: '4321' })).toBe(4321);
  });

  test('a value that is not a port is said out loud and not used', () => {
    expect(address.preferredPort('http://nope', {})).toBe(3001);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('--port=http://nope'));
  });

  test('and stepped over: PORT decides when --port made no sense', () => {
    expect(address.preferredPort('nope', { PORT: '4321' })).toBe(4321);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('--port=nope'));
  });

  test('a port outside the range is refused the same way', () => {
    expect(address.preferredPort(undefined, { PORT: '70000' })).toBe(3001);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('PORT=70000'));
  });

  test('PORT set to nothing at all is not a value', () => {
    expect(address.preferredPort(undefined, { PORT: '' })).toBe(3001);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('helpers/net — where it listens', () => {
  test('loopback, with nothing said', () => {
    expect(address.resolveHost(undefined, {})).toBe('127.0.0.1');
  });

  test('a bare --host means every interface', () => {
    expect(address.resolveHost(true, {})).toBe('0.0.0.0');
  });

  test('--host names one', () => {
    expect(address.resolveHost(' 192.168.1.20 ', {})).toBe('192.168.1.20');
  });

  test('HOST is respected', () => {
    expect(address.resolveHost(undefined, { HOST: '192.168.1.21' })).toBe('192.168.1.21');
  });

  test('--host wins over HOST', () => {
    expect(address.resolveHost('0.0.0.0', { HOST: '192.168.1.21' })).toBe('0.0.0.0');
  });

  test('loopback is recognised however it is written', () => {
    ['127.0.0.1', '127.0.1.1', 'localhost', 'LocalHost', '::1'].forEach(host => {
      expect(address.isLoopback(host)).toBe(true);
    });

    ['0.0.0.0', '::', '192.168.1.20', 'my-box.local', ''].forEach(host => {
      expect(address.isLoopback(host)).toBe(false);
    });
  });

  test('the wildcards name no host', () => {
    ['0.0.0.0', '::', '[::]', ''].forEach(host => expect(address.isWildcard(host)).toBe(true));
    ['127.0.0.1', 'localhost', '192.168.1.20'].forEach(host => expect(address.isWildcard(host)).toBe(false));
  });
});

describe('helpers/net — the origins', () => {
  test('the defaults are the tool\'s own two ports on both loopback names', () => {
    expect(address.allowedOrigins()).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001'
    ]);
  });

  test('they follow the port that was actually chosen', () => {
    const origins = address.allowedOrigins({ host: '127.0.0.1', port: 3457 });

    expect(origins).toContain('http://localhost:3457');
    expect(origins).toContain('http://127.0.0.1:3457');
    expect(origins).not.toContain('http://localhost:3001');
  });

  test('the development entries on 3000 stay, whatever the port is', () => {
    const origins = address.allowedOrigins({ port: 9999 });

    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://127.0.0.1:3000');
  });

  test('landing on 3000 does not produce the same origin twice', () => {
    const origins = address.allowedOrigins({ port: 3000 });

    expect(origins).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
  });

  test('a host named on purpose is allowed on both ports', () => {
    const origins = address.allowedOrigins({ host: 'my-box.local', port: 8080 });

    expect(origins).toContain('http://my-box.local:8080');
    expect(origins).toContain('http://my-box.local:3000');
    expect(origins).toContain('http://localhost:8080');
  });

  test('a wildcard is not an origin, so the machine\'s own addresses are', () => {
    const origins = address.allowedOrigins({
      host: '0.0.0.0',
      port: 8080,
      addresses: ['192.168.1.20', 'my-box']
    });

    expect(origins).not.toContain('http://0.0.0.0:8080');
    expect(origins).toContain('http://192.168.1.20:8080');
    expect(origins).toContain('http://my-box:8080');
    expect(origins).toContain('http://127.0.0.1:8080');
  });

  test('an IPv6 address is bracketed, as a URL needs it', () => {
    expect(address.allowedOrigins({ host: '::1', port: 3001 }))
      .toContain('http://[::1]:3001');
  });

  test('nothing is ever allowed twice', () => {
    const origins = address.allowedOrigins({
      host: '192.168.1.20',
      port: 3000,
      addresses: ['192.168.1.20', '127.0.0.1']
    });

    expect(origins).toEqual([...new Set(origins)]);
  });

  test('this machine answers to at least its own name', () => {
    const addresses = address.localAddresses();

    expect(addresses).toContain(os.hostname());
    addresses.forEach(entry => expect(typeof entry).toBe('string'));
  });
});

describe('helpers/net — what gets printed', () => {
  test('the URL is the address it listens on', () => {
    expect(address.url({ host: '127.0.0.1', port: 3457 })).toBe('http://127.0.0.1:3457');
    expect(address.url({ host: '192.168.1.20', port: 8080 })).toBe('http://192.168.1.20:8080');
  });

  test('a wildcard is shown as somewhere a browser can go', () => {
    expect(address.url({ host: '0.0.0.0', port: 8080 })).toBe('http://localhost:8080');
  });

  test('the defaults, for a run that said nothing', () => {
    expect(address.url()).toBe('http://127.0.0.1:3001');
  });

  test('loopback is not worth a warning', () => {
    expect(address.exposureWarning('127.0.0.1')).toBeNull();
    expect(address.exposureWarning('localhost')).toBeNull();
  });

  test('every interface is, and it says why', () => {
    const warning = address.exposureWarning('0.0.0.0');

    expect(warning).toContain('every network interface');
    expect(warning).toContain('no authentication');
    expect(warning).toContain('env files');
  });

  test('a named host is warned about by name', () => {
    expect(address.exposureWarning('192.168.1.20')).toContain('192.168.1.20');
  });
});
