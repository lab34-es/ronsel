import fs from 'fs';
import path from 'path';

import * as appDocs from '../../src/helpers/appDocs';

const SOURCE = `/**
 * A tiny example application.
 *
 * It has **markdown** in its description.
 */
import { applications } from 'ronsel';

/** Not attached to an export, must be ignored. */
const helper = () => {};

/**
 * Adds two numbers (a + b).
 *
 * A second paragraph with more details.
 *
 * @param {number} body.a - First operand. It can be
 *   written over several lines.
 * @param {number} [body.b=0] - Second operand.
 * @returns {200} The result of the operation.
 * \`\`\`json
 * { "result": 42 }
 * \`\`\`
 * @memory {write} lastResult - The result of the operation.
 * @memory {read} userId - Read from a previous step.
 * @example
 * application: example
 * method: add
 * parameters:
 *   body:
 *     a: 2
 * @unknownTag ignored on purpose
 */
module.exports.add = applications.handler([
  async () => [{}, 200, {}, {}]
], 'add');

/**
 * A method without tags.
 */
exports.noTags = applications.handler([
  async () => [{}, 200, {}, {}]
], 'noTags');
`;

describe('appDocs', () => {
  describe('parse', () => {
    const parsed = appDocs.parse(SOURCE);

    it('takes the application description from the block at the top of the file', () => {
      expect(parsed.description).toBe(
        'A tiny example application.\n\nIt has **markdown** in its description.'
      );
    });

    it('ignores blocks that do not document an exported method', () => {
      expect(Object.keys(parsed.methods).sort()).toEqual(['add', 'noTags']);
    });

    it('takes the method description from the free text of its block', () => {
      expect(parsed.methods.add.description).toBe(
        'Adds two numbers (a + b).\n\nA second paragraph with more details.'
      );
      expect(parsed.methods.noTags.description).toBe('A method without tags.');
    });

    it('reads input parameters from @param', () => {
      expect(parsed.methods.add.input).toEqual([
        {
          name: 'body.a',
          type: 'number',
          required: true,
          description: 'First operand. It can be written over several lines.'
        },
        {
          name: 'body.b',
          type: 'number',
          required: false,
          default: '0',
          description: 'Second operand.'
        }
      ]);
    });

    it('reads the output, and its example body, from @returns', () => {
      expect(parsed.methods.add.output).toEqual({
        status: 200,
        description: 'The result of the operation.',
        body: { result: 42 }
      });
    });

    it('reads flow memory usage from @memory', () => {
      expect(parsed.methods.add.memory).toEqual([
        { key: 'lastResult', mode: 'write', description: 'The result of the operation.' },
        { key: 'userId', mode: 'read', description: 'Read from a previous step.' }
      ]);
    });

    it('keeps the indentation of @example, which is a YAML step', () => {
      expect(parsed.methods.add.example).toBe([
        'application: example',
        'method: add',
        'parameters:',
        '  body:',
        '    a: 2'
      ].join('\n'));
    });

    it('leaves undocumented sections empty', () => {
      expect(parsed.methods.noTags.input).toEqual([]);
      expect(parsed.methods.noTags.memory).toEqual([]);
      expect(parsed.methods.noTags.output).toBeNull();
      expect(parsed.methods.noTags.example).toBeNull();
    });

    it('supports a non numeric status', () => {
      const source = '/**\n * Docs.\n * @returns {200 | 400} Depends.\n */\nmodule.exports.x = 1;';
      expect(appDocs.parse(source).methods.x.output).toEqual({
        status: '200 | 400',
        description: 'Depends.'
      });
    });

    it('does not take a method block as the application description', () => {
      const source = '/**\n * Docs of the method.\n */\nmodule.exports.only = 1;';
      expect(appDocs.parse(source).description).toBeNull();
    });

    it('returns an empty result for sources without JSDoc', () => {
      expect(appDocs.parse('module.exports.x = 1;')).toEqual({ description: null, methods: {} });
      expect(appDocs.parse(null)).toEqual({ description: null, methods: {} });
    });
  });

  describe('bundled example applications', () => {
    const appsDir = path.join(__dirname, '..', '..', 'src', 'defaults', 'applications');
    const apps = fs.readdirSync(appsDir);

    it.each(apps)('%s documents itself with JSDoc, and has no docs.json', (app) => {
      expect(fs.existsSync(path.join(appsDir, app, 'docs.json'))).toBe(false);

      const parsed = appDocs.parse(fs.readFileSync(path.join(appsDir, app, 'index.ts'), 'utf8'));
      const methods = Object.values(parsed.methods);

      expect(parsed.description).toBeTruthy();
      expect(methods.length).toBeGreaterThan(0);
      methods.forEach(method => {
        expect(method.description).toBeTruthy();
        expect(method.example).toBeTruthy();
      });
    });
  });
});
