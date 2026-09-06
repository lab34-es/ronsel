/**
 * A playground against httpbin.org: it echoes back query parameters, bodies
 * and headers, and can answer with any status code or delay. Great for
 * exploring HTTP testing without setting up a server.
 */
import { applications, httpClient } from 'ronsel';
import type { Context, Parameters } from 'ronsel';

/**
 * GET /get — httpbin echoes the query parameters and headers of the request.
 *
 * @param {object} [query.*] - Any key/value pairs, sent as query string
 *   parameters. Echoed back under body.args.
 * @param {object} [headers.*] - Extra request headers. Echoed back under
 *   body.headers.
 * @returns {200} The echoed request: args (query), headers and url.
 * ```json
 * { "args": { "q": "flows" }, "headers": {}, "url": "https://httpbin.org/get?q=flows" }
 * ```
 * @example
 * application: httpbin
 * method: get
 * parameters:
 *   query:
 *     q: flows
 * test:
 *   status: 200
 *   body:
 *     args:
 *       q: flows
 */
export const get = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { query, headers } = parameters || {};
    return httpClient.get(ctx, '/get', {
      params: query || {},
      headers: headers || {}
    });
  }
], 'get');

/**
 * POST /post — httpbin echoes the JSON body back under "json".
 *
 * @param {object} [body.*] - Any JSON payload. Replacers such as
 *   {{ randomEmail }} are handy here.
 * @param {object} [headers.*] - Extra request headers.
 * @returns {200} The echoed request; the parsed JSON payload is available
 *   under body.json.
 * ```json
 * { "json": { "email": "user@example.com" } }
 * ```
 * @example
 * application: httpbin
 * method: post
 * parameters:
 *   body:
 *     email: "{{ randomEmail }}"
 * test:
 *   status: 200
 *   body:
 *     json:
 *       email: "$expr: typeof value === 'string' && value.includes('@')"
 */
export const post = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { body, headers } = parameters || {};
    return httpClient.post(ctx, '/post', {
      body: body || {},
      headers: headers || {}
    });
  }
], 'post');

/**
 * GET /status/{code} — httpbin answers with exactly that HTTP status code.
 * Useful to test error scenarios.
 *
 * @param {number} [params.code=200] - The HTTP status code to receive (e.g. 200, 404, 503).
 * @returns {code} Exactly the status code you asked for, with an empty body.
 * @example
 * application: httpbin
 * method: status
 * parameters:
 *   params:
 *     code: 404
 * test:
 *   status: 404
 */
export const status = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const params = (parameters || {}).params || {};
    const code = params.code || 200;
    return httpClient.get(ctx, `/status/${code}`);
  }
], 'status');

/**
 * GET /delay/{seconds} — httpbin waits before responding (max 10 seconds).
 * Useful to test timeouts and retries.
 *
 * @param {number} [params.seconds=1] - Seconds to wait before the response (0-10).
 * @returns {200} Same echo format as /get, after the delay.
 * ```json
 * { "url": "https://httpbin.org/delay/2" }
 * ```
 * @example
 * application: httpbin
 * method: delay
 * parameters:
 *   params:
 *     seconds: 2
 * test:
 *   status: 200
 */
export const delay = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const params = (parameters || {}).params || {};
    const seconds = params.seconds || 1;
    return httpClient.get(ctx, `/delay/${seconds}`);
  }
], 'delay');
