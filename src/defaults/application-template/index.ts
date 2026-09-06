/**
 * __APPLICATION_NAME__ — a brand new application. Replace this text with what
 * the application under test actually is: this block is what the UI (and the
 * AI writing flows for you) reads as the application description.
 *
 * An application is plain TypeScript. Every exported method is wrapped in
 * `applications.handler([...], 'name')`, whose array holds the optional
 * validators and, as its last item, the function that does the work.
 *
 * A method returns `[headers, status, body, memory]`:
 *
 * - `headers` — response headers, `{}` when there are none.
 * - `status`  — the status a flow asserts with `test.status`.
 * - `body`    — what a flow asserts with `test.body`.
 * - `memory`  — values merged into the flow memory, so later steps can read
 *               them as `{{ memory.<key> }}`.
 *
 * The methods below are examples: keep them as a reference, or delete them
 * once your own are in place.
 */
import { applications, httpClient, validate } from 'ronsel';
import type { Context, Flow, Parameters } from 'ronsel';

/**
 * Says hello. Runs entirely offline, so it works before the application
 * points at anything real.
 *
 * @param {string} [body.name] - Who to greet. Falls back to whoever was
 *   greeted last (`memory.greetedName`), and to "world" the first time.
 * @returns {200} The greeting, plus the base URL of the environment the flow
 *   runs against — handy to check the right `env/<environment>.env` was picked.
 * ```json
 * { "greeting": "Hello, world!", "name": "world", "baseUrl": "https://httpbin.org" }
 * ```
 * @memory {write} greetedName - Who was greeted.
 * @memory {write} lastGreeting - The greeting sentence, for the next step to reuse.
 * @example
 * application: __APPLICATION_NAME__
 * method: helloWorld
 * parameters:
 *   body:
 *     name: "{{ randomName }}"
 * test:
 *   status: 200
 *   body:
 *     greeting: "$expr: value.startsWith('Hello, ')"
 */
export const helloWorld = applications.handler([
  // Validators run before the method. `fallbacks` fill a missing value from
  // the flow memory, a replacer, or a constant — in that order.
  validate.body({
    type: 'object',
    properties: {
      name: { type: 'string' }
    },
    fallbacks: {
      name: [
        { type: 'memory', key: 'greetedName' },
        { type: 'static', value: 'world' }
      ]
    }
  }),
  async (ctx: Context, parameters: Parameters) => {
    const body = (parameters || {}).body || {};
    const name = body.name;
    const greeting = `Hello, ${name}!`;

    return [
      {},
      200,
      { greeting, name, baseUrl: ctx.env.BASE_URL },
      // Fourth element: what this step leaves in the flow memory
      { greetedName: name, lastGreeting: greeting }
    ];
  }
], 'helloWorld');

/**
 * Reads what an earlier step wrote to the flow memory, and answers 400 when
 * nothing greeted yet — an example of testing the unhappy path.
 *
 * A step can also read memory itself, with `{{ memory.lastGreeting }}` in its
 * parameters. This method shows the other side of it: reaching the memory
 * from the code, through the third argument every method receives.
 *
 * @returns {200 | 400} On success, the greeting recorded by `helloWorld`. When
 *   no earlier step greeted anyone, status 400 and an error object.
 * ```json
 * { "repeated": "Hello, world!", "times": 2 }
 * ```
 * @memory {read} lastGreeting - Written by `helloWorld`.
 * @memory {write} repeatCount - How many times the greeting was repeated.
 * @example
 * application: __APPLICATION_NAME__
 * method: repeatGreeting
 * description: Reuse what the previous step greeted
 * test:
 *   status: 200
 */
export const repeatGreeting = applications.handler([
  async (ctx: Context, parameters: Parameters, flow: Flow) => {
    const memory = (flow && flow.memory) || {};

    if (!memory.lastGreeting) {
      return [{}, 400, {
        error: {
          code: 'NOTHING_GREETED_YET',
          message: 'Run helloWorld first: it writes memory.lastGreeting'
        }
      }, {}];
    }

    const times = (memory.repeatCount || 1) + 1;

    return [
      {},
      200,
      { repeated: memory.lastGreeting, times },
      { repeatCount: times }
    ];
  }
], 'repeatGreeting');

/**
 * An HTTP call, to show how a real application talks to its API.
 * `httpClient` prefixes `BASE_URL` from the environment file, and already
 * returns the `[headers, status, body]` shape a method answers with.
 *
 * @param {string} [query.q] - Anything: httpbin echoes it back.
 * @returns {200} The echo of the request, as httpbin sends it.
 * ```json
 * { "args": { "q": "hello" }, "url": "https://httpbin.org/get?q=hello" }
 * ```
 * @example
 * application: __APPLICATION_NAME__
 * method: ping
 * parameters:
 *   query:
 *     q: "{{ randomString }}"
 * test:
 *   status: 200
 */
export const ping = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { query } = parameters || {};
    return httpClient.get(ctx, '/get', { params: query || {} });
  }
], 'ping');
