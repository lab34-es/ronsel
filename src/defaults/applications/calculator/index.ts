/**
 * A fully offline calculator. Perfect to explore flows without network
 * access, and to learn how flow memory works: every operation writes its
 * result to `memory.lastResult`, so later steps can reuse it.
 */
import { applications } from 'ronsel';
import type { Context, Parameters } from 'ronsel';

const toNumber = (value, name) => {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(num)) {
    throw new Error(`Parameter "${name}" must be a number, got: ${JSON.stringify(value)}`);
  }
  return num;
};

const round = (value, ctx) => {
  const precision = parseInt((ctx.env && ctx.env.PRECISION) || '4', 10);
  return Number(value.toFixed(precision));
};

/**
 * Adds two numbers (a + b).
 *
 * @param {number} body.a - First operand. Strings that look like numbers are
 *   accepted (useful with replacers such as {{ randomInt0_100 }}).
 * @param {number} body.b - Second operand.
 * @returns {200} The operation performed and its result, rounded to PRECISION decimals.
 * ```json
 * { "operation": "add", "a": 2, "b": 40, "result": 42 }
 * ```
 * @memory {write} lastResult - The result of the operation. Later steps can
 *   read it with {{ memory.lastResult }}.
 * @example
 * application: calculator
 * method: add
 * parameters:
 *   body:
 *     a: 2
 *     b: 40
 * test:
 *   status: 200
 *   body:
 *     result: 42
 */
export const add = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const body = (parameters || {}).body || {};
    const a = toNumber(body.a, 'a');
    const b = toNumber(body.b, 'b');
    const result = round(a + b, ctx);
    return [{}, 200, { operation: 'add', a, b, result }, { lastResult: result }];
  }
], 'add');

/**
 * Multiplies two numbers (a * b).
 *
 * @param {number} body.a - First operand.
 * @param {number} body.b - Second operand.
 * @returns {200} The operation performed and its result.
 * ```json
 * { "operation": "multiply", "a": 6, "b": 7, "result": 42 }
 * ```
 * @memory {write} lastResult - The result of the operation.
 * @example
 * application: calculator
 * method: multiply
 * parameters:
 *   body:
 *     a: "{{ memory.lastResult }}"
 *     b: 2
 */
export const multiply = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const body = (parameters || {}).body || {};
    const a = toNumber(body.a, 'a');
    const b = toNumber(body.b, 'b');
    const result = round(a * b, ctx);
    return [{}, 200, { operation: 'multiply', a, b, result }, { lastResult: result }];
  }
], 'multiply');

/**
 * Divides two numbers (a / b). Returns HTTP 400 with an error body when b is
 * zero — useful to practice testing failure scenarios.
 *
 * @param {number} body.a - Dividend.
 * @param {number} body.b - Divisor. Zero triggers a DIVISION_BY_ZERO error.
 * @returns {200 | 400} On success: the operation and its result. On division
 *   by zero: status 400 and an error object.
 * ```json
 * { "error": { "code": "DIVISION_BY_ZERO", "message": "Cannot divide by zero" } }
 * ```
 * @memory {write} lastResult - The result of the operation (only on success).
 * @example
 * application: calculator
 * method: divide
 * parameters:
 *   body:
 *     a: 1
 *     b: 0
 * test:
 *   status: 400
 *   body:
 *     error:
 *       code: DIVISION_BY_ZERO
 */
export const divide = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const body = (parameters || {}).body || {};
    const a = toNumber(body.a, 'a');
    const b = toNumber(body.b, 'b');

    if (b === 0) {
      return [{}, 400, {
        error: {
          code: 'DIVISION_BY_ZERO',
          message: 'Cannot divide by zero'
        }
      }, {}];
    }

    const result = round(a / b, ctx);
    return [{}, 200, { operation: 'divide', a, b, result }, { lastResult: result }];
  }
], 'divide');
