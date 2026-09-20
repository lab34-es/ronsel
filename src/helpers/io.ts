import { Server } from 'socket.io';

import * as net from './net';

/**
 * Build the socket.io server, restricted to the tool's own origins.
 *
 * This is a local-only tool, but the socket streams flow executions
 * (requests, responses, environment-derived data), so only the tool's own
 * origins may connect -- not arbitrary websites doing drive-by requests
 * against localhost.
 *
 * Which origins those are is not knowable until the port has been chosen, so
 * they are passed in: see helpers/net.allowedOrigins, which the API calls
 * once it knows where it listens.
 *
 * @param {import('node:http').Server} server - The HTTP server to attach to
 * @param {string[]} [origins] - The allowed origins; the defaults when omitted
 * @returns {Server} The socket.io server
 */
const io = (server, origins: string[] = net.allowedOrigins()) => new Server(server, {
  cors: {
    origin: origins,
    methods: ['GET', 'POST']
  }
});

export { io };
