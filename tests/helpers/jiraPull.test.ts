// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';

// Every helper resolves its files through paths.contextDir: point it at a
// throwaway directory so the tests never touch the real ~/ronsel
const mockContext = fs.mkdtempSync(path.join(os.tmpdir(), 'ronsel-pull-'));
const CONTEXT = mockContext;

jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (pathParts) =>
    require('path').join(mockContext, ...(pathParts || [])),
  createFolder: async () => {}
}));

// The settings live in the user's context folder: keep them in memory instead
jest.mock('../../src/helpers/config', () => {
  let stored = {};
  return {
    load: jest.fn(async () => stored),
    save: jest.fn(async (name, data) => { stored = data; return data; }),
    __set: (value) => { stored = value; },
    __get: () => stored
  };
});

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn()
}));

import axios from 'axios';
import * as configHelper from '../../src/helpers/config';
import * as jira from '../../src/helpers/jira';
import * as client from '../../src/helpers/jira/client';
import * as pull from '../../src/helpers/jira/pull';
import * as adf from '../../src/helpers/jira/adf';
import * as testDoc from '../../src/helpers/jira/testDoc';

const xrayDir = path.join(CONTEXT, 'flows', 'xray');

const BASIC_SETTINGS = {
  kind: 'basic',
  jiraBaseUrl: 'https://acme.atlassian.net',
  projectKey: 'ABC',
  basic: { email: 'jane@acme.com', apiToken: 'api-token' }
};

const CLOUD_SETTINGS = {
  kind: 'cloud',
  jiraBaseUrl: 'https://acme.atlassian.net',
  projectKey: 'ABC',
  cloud: {
    xrayBaseUrl: 'https://xray.cloud.getxray.app',
    clientId: 'client-id',
    clientSecret: 'client-secret'
  }
};

/**
 * A Jira issue as the REST API sends it.
 */
const issue = (key, summary, type, extra = {}) => ({
  key,
  id: `id-${key}`,
  fields: {
    summary,
    issuetype: { name: type },
    status: { name: 'To Do' },
    description: null,
    ...extra
  }
});

/**
 * The embedded form Jira uses for a parent or a linked issue.
 */
const linked = (key, summary, type) => ({
  key,
  fields: { summary, issuetype: { name: type } }
});

/**
 * Answer every request a pull makes from a fixed set of issues.
 * @param {Object} options - { tests, byKey }
 */
const mockJira = ({ tests = [], byKey = {} }: { tests?: any[]; byKey?: Record<string, any> }) => {
  (axios.get as jest.Mock).mockImplementation((url, config = {}) => {
    const params = config.params || {};

    if (url.endsWith('/rest/api/2/field')) {
      return Promise.resolve({ data: [{ id: 'customfield_10014', name: 'Epic Link' }] });
    }

    if (url.endsWith('/rest/api/2/search/jql')) {
      const keys = String(params.jql).match(/^key in \(([^)]+)\)$/);

      if (keys) {
        const wanted = keys[1].split(',').map(key => key.trim());
        return Promise.resolve({
          data: { issues: wanted.map(key => byKey[key]).filter(Boolean), nextPageToken: null }
        });
      }

      return Promise.resolve({ data: { issues: tests, nextPageToken: null } });
    }

    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });

  (axios.post as jest.Mock).mockImplementation((url) => {
    if (url.endsWith('/rest/api/2/search/approximate-count')) {
      return Promise.resolve({ data: { count: tests.length } });
    }

    return Promise.reject(new Error(`Unexpected POST ${url}`));
  });
};

/**
 * Start a pull and wait for it to finish.
 * @returns {Promise<Object>} The final progress
 */
const runPull = async () => {
  await jira.startPull({});

  for (let i = 0; i < 200 && pull.status().running; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  const status = pull.status();
  if (status.running) { throw new Error('The pull never finished'); }

  return status;
};

/**
 * Every file the pull wrote, as paths relative to the "xray" folder.
 * @returns {Array<string>}
 */
const written = (dir = xrayDir, prefix = '') => {
  if (!fs.existsSync(dir)) { return []; }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? written(path.join(dir, entry.name), relative) : [relative];
  }).sort();
};

const read = (relative) => fs.readFileSync(path.join(xrayDir, relative), 'utf8');

beforeEach(() => {
  fs.rmSync(path.join(CONTEXT, 'flows'), { recursive: true, force: true });
  (configHelper as any).__set({});
  client.resetToken();
  (axios.get as jest.Mock).mockReset();
  (axios.post as jest.Mock).mockReset();
});

afterAll(() => {
  fs.rmSync(CONTEXT, { recursive: true, force: true });
});

describe('jira.startPull', () => {
  test('refuses to run without a project key', async () => {
    (configHelper as any).__set({ ...BASIC_SETTINGS, projectKey: '' });

    await expect(jira.startPull({})).rejects.toThrow(/project key/i);
  });

  test('refuses to run when the integration is not configured', async () => {
    (configHelper as any).__set({ kind: 'basic', jiraBaseUrl: '', projectKey: 'ABC', basic: {} });

    await expect(jira.startPull({})).rejects.toThrow(/Configure/i);
  });

  test('rejects a project key that is not one', async () => {
    (configHelper as any).__set({ ...BASIC_SETTINGS, projectKey: 'ABC OR 1=1' });

    await expect(jira.startPull({})).rejects.toThrow(/not a Jira project key/i);
  });
});

describe('the Jira hierarchy layout (Jira Cloud with an API token)', () => {
  beforeEach(() => {
    (configHelper as any).__set(BASIC_SETTINGS);
  });

  test('files a test under the feature and the story it hangs from', async () => {
    mockJira({
      tests: [issue('ABC-123', 'Pay with an expired card', 'Test', {
        description: 'h2. Setup\nA card that expired *yesterday*.',
        parent: linked('ABC-42', 'Pay with a card', 'Story')
      })],
      byKey: {
        'ABC-42': issue('ABC-42', 'Pay with a card', 'Story', {
          parent: linked('ABC-10', 'Checkout', 'Epic')
        })
      }
    });

    const status = await runPull();

    expect(status.phase).toBe('done');
    expect(status.created).toBe(1);
    expect(written()).toEqual([
      'ABC/ABC-10_checkout/ABC-42_pay-with-a-card/ABC-123_pay-with-an-expired-card.md'
    ]);

    const document = read('ABC/ABC-10_checkout/ABC-42_pay-with-a-card/ABC-123_pay-with-an-expired-card.md');

    expect(document).toContain('testKey: ABC-123');
    expect(document).toContain('feature: ABC-10');
    expect(document).toContain('userStory: ABC-42');
    expect(document).toContain('url: https://acme.atlassian.net/browse/ABC-123');
    // The Jira description is the content of the document, not a property
    expect(document).toContain('## Setup');
    expect(document).toContain('A card that expired **yesterday**.');
  });

  test('falls back to the related work when the test has no parent', async () => {
    mockJira({
      tests: [issue('ABC-124', 'Reject an unknown card', 'Test', {
        issuelinks: [
          { type: { name: 'Relates' }, outwardIssue: linked('ABC-99', 'Some bug', 'Bug') },
          { type: { name: 'Test' }, outwardIssue: linked('ABC-42', 'Pay with a card', 'Story') }
        ]
      })],
      byKey: {
        'ABC-42': issue('ABC-42', 'Pay with a card', 'Story', {
          issuelinks: [{ type: { name: 'Relates' }, inwardIssue: linked('ABC-10', 'Checkout', 'Epic') }]
        })
      }
    });

    await runPull();

    expect(written()).toEqual([
      'ABC/ABC-10_checkout/ABC-42_pay-with-a-card/ABC-124_reject-an-unknown-card.md'
    ]);
  });

  test('keeps a test with no hierarchy at all rather than dropping it', async () => {
    mockJira({ tests: [issue('ABC-125', 'Orphan test', 'Test')] });

    await runPull();

    expect(written()).toEqual([
      `ABC/${pull.NO_FEATURE}/${pull.NO_STORY}/ABC-125_orphan-test.md`
    ]);
  });

  test('moves a test that changed story instead of writing it twice', async () => {
    mockJira({
      tests: [issue('ABC-123', 'Pay with an expired card', 'Test', {
        parent: linked('ABC-42', 'Pay with a card', 'Story')
      })],
      byKey: {
        'ABC-42': issue('ABC-42', 'Pay with a card', 'Story', {
          parent: linked('ABC-10', 'Checkout', 'Epic')
        })
      }
    });

    await runPull();

    // The steps the user wrote after the first pull must survive the second
    const first = 'ABC/ABC-10_checkout/ABC-42_pay-with-a-card/ABC-123_pay-with-an-expired-card.md';
    fs.appendFileSync(path.join(xrayDir, first), '\n```step\napplication: calculator\n```\n');

    mockJira({
      tests: [issue('ABC-123', 'Pay with an expired card', 'Test', {
        parent: linked('ABC-43', 'Pay with a wallet', 'Story')
      })],
      byKey: {
        'ABC-43': issue('ABC-43', 'Pay with a wallet', 'Story', {
          parent: linked('ABC-10', 'Checkout', 'Epic')
        })
      }
    });

    const status = await runPull();

    expect(status.moved).toBe(1);
    expect(status.created).toBe(0);
    expect(written()).toEqual([
      'ABC/ABC-10_checkout/ABC-43_pay-with-a-wallet/ABC-123_pay-with-an-expired-card.md'
    ]);

    const document = read('ABC/ABC-10_checkout/ABC-43_pay-with-a-wallet/ABC-123_pay-with-an-expired-card.md');
    expect(document).toContain('```step');
    expect(document).toContain('userStory: ABC-43');
  });

  test('a second pull that changes nothing rewrites nothing', async () => {
    mockJira({ tests: [issue('ABC-125', 'Orphan test', 'Test')] });

    await runPull();
    const status = await runPull();

    expect(status.unchanged).toBe(1);
    expect(status.created).toBe(0);
    expect(status.updated).toBe(0);
  });

  test('leaves a test that is already in "xray" alone when overwrite is off', async () => {
    mockJira({ tests: [issue('ABC-125', 'Orphan test', 'Test', { summary: 'Orphan test' })] });

    await runPull();

    const file = `ABC/${pull.NO_FEATURE}/${pull.NO_STORY}/ABC-125_orphan-test.md`;
    const before = read(file);

    (configHelper as any).__set({ ...BASIC_SETTINGS, pull: { overwrite: false } });

    // Jira renamed the test: with overwrite off, the file must not notice
    mockJira({ tests: [issue('ABC-125', 'Renamed in Jira', 'Test')] });

    const status = await runPull();

    expect(status.overwrite).toBe(false);
    expect(status.skipped).toBe(1);
    expect(status.updated).toBe(0);
    expect(status.created).toBe(0);
    expect(status.moved).toBe(0);
    expect(written()).toEqual([file]);
    expect(read(file)).toBe(before);
  });

  test('still writes a test that was never pulled when overwrite is off', async () => {
    (configHelper as any).__set({ ...BASIC_SETTINGS, pull: { overwrite: false } });

    mockJira({ tests: [issue('ABC-125', 'Orphan test', 'Test')] });

    const status = await runPull();

    expect(status.created).toBe(1);
    expect(status.skipped).toBe(0);
    expect(written()).toEqual([`ABC/${pull.NO_FEATURE}/${pull.NO_STORY}/ABC-125_orphan-test.md`]);
  });
});

describe('the Xray Test Repository layout (Xray Cloud)', () => {
  beforeEach(() => {
    (configHelper as any).__set(CLOUD_SETTINGS);

    (axios.post as jest.Mock).mockImplementation((url, body) => {
      if (url.endsWith('/api/v2/authenticate')) {
        return Promise.resolve({ data: '"jwt-token"' });
      }

      if (url.endsWith('/api/v2/graphql')) {
        // Only the first page has results: the second call would loop
        if (body.variables.start > 0) {
          return Promise.resolve({ data: { data: { getTests: { total: 1, results: [] } } } });
        }

        return Promise.resolve({
          data: {
            data: {
              getTests: {
                total: 1,
                results: [{
                  issueId: '10001',
                  testType: { name: 'Manual' },
                  folder: { path: '/Authentication/Login' },
                  jira: {
                    key: 'ABC-200',
                    summary: 'Login with valid credentials',
                    status: { name: 'To Do' },
                    issuetype: { name: 'Test' },
                    description: {
                      type: 'doc',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sign in and land on the dashboard.' }] }]
                    }
                  }
                }]
              }
            }
          }
        });
      }

      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
  });

  test('writes the test details Xray answers, steps and all', async () => {
    (axios.post as jest.Mock).mockImplementation((url, body) => {
      if (url.endsWith('/api/v2/authenticate')) {
        return Promise.resolve({ data: '"jwt-token"' });
      }

      if (url.endsWith('/api/v2/graphql')) {
        if (body.variables.start > 0) {
          return Promise.resolve({ data: { data: { getTests: { total: 1, results: [] } } } });
        }

        return Promise.resolve({
          data: {
            data: {
              getTests: {
                total: 1,
                results: [{
                  issueId: '10001',
                  testType: { name: 'Manual' },
                  folder: { path: '/Authentication/Login' },
                  steps: [
                    { id: '1', action: 'Open the login page', data: null, result: 'The form shows' },
                    { id: '2', action: 'Sign in', data: 'jane@acme.com', result: 'The dashboard shows' }
                  ],
                  gherkin: null,
                  unstructured: null,
                  jira: {
                    key: 'ABC-200',
                    summary: 'Login with valid credentials',
                    status: { name: 'To Do' },
                    issuetype: { name: 'Test' },
                    description: null
                  }
                }]
              }
            }
          }
        });
      }

      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    await runPull();

    const document = read('ABC/Authentication/Login/ABC-200_login-with-valid-credentials.md');

    expect(document).toContain('## Test details');
    expect(document).toContain('**Test type:** Manual');
    expect(document).toContain('### Step 1');
    expect(document).toContain('Open the login page');
    expect(document).toContain('**Expected result**');
    expect(document).toContain('### Step 2');
    expect(document).toContain('jane@acme.com');
  });

  test('writes the scenario of a Cucumber test', async () => {
    (axios.post as jest.Mock).mockImplementation((url, body) => {
      if (url.endsWith('/api/v2/authenticate')) {
        return Promise.resolve({ data: '"jwt-token"' });
      }

      if (body.variables.start > 0) {
        return Promise.resolve({ data: { data: { getTests: { total: 1, results: [] } } } });
      }

      return Promise.resolve({
        data: {
          data: {
            getTests: {
              total: 1,
              results: [{
                issueId: '10002',
                testType: { name: 'Cucumber' },
                folder: { path: '/' },
                steps: [],
                gherkin: 'Given a registered user\nWhen they sign in\nThen the dashboard shows',
                unstructured: null,
                jira: {
                  key: 'ABC-201',
                  summary: 'Sign in',
                  status: { name: 'To Do' },
                  issuetype: { name: 'Test' },
                  description: null
                }
              }]
            }
          }
        }
      });
    });

    await runPull();

    const document = read('ABC/ABC-201_sign-in.md');

    expect(document).toContain('```gherkin');
    expect(document).toContain('Given a registered user');
  });

  test('pulls the tests anyway when Xray will not answer the details', async () => {
    (axios.post as jest.Mock).mockImplementation((url, body) => {
      if (url.endsWith('/api/v2/authenticate')) {
        return Promise.resolve({ data: '"jwt-token"' });
      }

      // The Xray that does not know the detail fields refuses that query
      if (/steps/.test(body.query)) {
        return Promise.resolve({
          data: { errors: [{ message: 'Cannot query field "steps" on type "Test"' }] }
        });
      }

      if (body.variables.start > 0) {
        return Promise.resolve({ data: { data: { getTests: { total: 1, results: [] } } } });
      }

      return Promise.resolve({
        data: {
          data: {
            getTests: {
              total: 1,
              results: [{
                issueId: '10003',
                testType: { name: 'Manual' },
                folder: { path: '/' },
                jira: {
                  key: 'ABC-202',
                  summary: 'No details here',
                  status: { name: 'To Do' },
                  issuetype: { name: 'Test' },
                  description: null
                }
              }]
            }
          }
        }
      });
    });

    const status = await runPull();

    expect(status.phase).toBe('done');
    expect(status.created).toBe(1);
    expect(status.log.some(line => line.level === 'warn' && /test details/i.test(line.message))).toBe(true);

    const document = read('ABC/ABC-202_no-details-here.md');

    expect(document).toContain('testKey: ABC-202');
    expect(document).not.toContain('## Test details');
  });

  test('mirrors the folders of the Test Repository', async () => {
    const status = await runPull();

    expect(status.phase).toBe('done');
    expect(status.strategy).toBe('xray-repository');
    expect(written()).toEqual(['ABC/Authentication/Login/ABC-200_login-with-valid-credentials.md']);

    const document = read('ABC/Authentication/Login/ABC-200_login-with-valid-credentials.md');

    expect(document).toContain('testKey: ABC-200');
    expect(document).toContain('folder: /Authentication/Login');
    expect(document).toContain('testType: Manual');
    expect(document).toContain('Sign in and land on the dashboard.');
  });
});

describe('the Xray Test Repository layout (Xray Server/DC)', () => {
  const SERVER_SETTINGS = {
    kind: 'server',
    jiraBaseUrl: 'https://jira.acme.com',
    projectKey: 'ABC',
    server: { personalAccessToken: 'personal-access-token' }
  };

  beforeEach(() => {
    (configHelper as any).__set(SERVER_SETTINGS);

    (axios.get as jest.Mock).mockImplementation((url) => {
      if (url.endsWith('/rest/raven/1.0/api/testrepository/ABC/folders')) {
        return Promise.resolve({
          data: { id: -1, name: '', folders: [{ id: 1, name: 'Login', folders: [] }] }
        });
      }

      if (url.endsWith('/rest/raven/1.0/api/testrepository/ABC/folders/1/tests')) {
        return Promise.resolve({ data: { tests: [{ key: 'ABC-300' }] } });
      }

      if (url.endsWith('/rest/raven/1.0/api/test/ABC-300/step')) {
        return Promise.resolve({
          data: [{
            id: 1,
            index: 1,
            step: { raw: 'Open the app', rendered: '<p>Open the app</p>' },
            data: { raw: '' },
            result: { raw: 'It opens' }
          }]
        });
      }

      if (url.endsWith('/rest/api/2/field')) {
        return Promise.resolve({
          data: [
            { id: 'customfield_20001', name: 'Test Type' },
            { id: 'customfield_20002', name: 'Cucumber Scenario' }
          ]
        });
      }

      if (url.endsWith('/rest/api/2/search/jql')) {
        return Promise.resolve({
          data: {
            issues: [issue('ABC-300', 'Sign in', 'Test', {
              customfield_20001: { value: 'Manual' }
            })],
            nextPageToken: null
          }
        });
      }

      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    (axios.post as jest.Mock).mockImplementation((url) => {
      if (url.endsWith('/rest/api/2/search/approximate-count')) {
        return Promise.resolve({ data: { count: 1 } });
      }

      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
  });

  test('writes the steps Xray for Server/DC answers, in the folder of the repository', async () => {
    const status = await runPull();

    expect(status.phase).toBe('done');
    expect(written()).toEqual(['ABC/Login/ABC-300_sign-in.md']);

    const document = read('ABC/Login/ABC-300_sign-in.md');

    expect(document).toContain('folder: /Login');
    expect(document).toContain('testType: Manual');
    expect(document).toContain('## Test details');
    expect(document).toContain('### Step 1');
    expect(document).toContain('Open the app');
    expect(document).toContain('It opens');
  });

  test('asks nothing about a test it is going to skip', async () => {
    await runPull();

    (configHelper as any).__set({ ...SERVER_SETTINGS, pull: { overwrite: false } });
    (axios.get as jest.Mock).mockClear();

    const status = await runPull();

    expect(status.skipped).toBe(1);
    expect((axios.get as jest.Mock).mock.calls.some(([url]) => url.includes('/api/test/ABC-300/step'))).toBe(false);
  });
});

describe('several projects', () => {
  /**
   * Answer the requests of a pull that walks several projects: one set of
   * tests per project key, and the projects that are meant to be unreachable.
   *
   * @param {Object} byProject - Tests, keyed by project key
   * @param {Array<string>} unreachable - Project keys Jira refuses to answer
   */
  const mockProjects = (byProject, unreachable: string[] = []) => {
    const projectOf = (jql) => (String(jql).match(/project = "([^"]+)"/) || [])[1];
    const testsOf = (jql) => byProject[projectOf(jql)] || [];

    (axios.get as jest.Mock).mockImplementation((url, config: any = {}) => {
      const params = config.params || {};

      if (url.endsWith('/rest/api/2/field')) {
        return Promise.resolve({ data: [] });
      }

      if (url.endsWith('/rest/api/2/search/jql')) {
        const project = projectOf(params.jql);

        if (unreachable.includes(project)) {
          return Promise.reject(new Error(`No permission to read ${project}`));
        }

        return Promise.resolve({ data: { issues: testsOf(params.jql), nextPageToken: null } });
      }

      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    (axios.post as jest.Mock).mockImplementation((url, body: any = {}) => {
      if (url.endsWith('/rest/api/2/search/approximate-count')) {
        return Promise.resolve({ data: { count: testsOf(body.jql).length } });
      }

      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
  };

  test('writes every project into a folder of its own', async () => {
    (configHelper as any).__set({ ...BASIC_SETTINGS, projectKey: 'ABC, ACME' });

    mockProjects({
      ABC: [issue('ABC-125', 'Orphan test', 'Test')],
      ACME: [issue('ACME-7', 'Another test', 'Test')]
    });

    const status = await runPull();

    expect(status.phase).toBe('done');
    expect(status.projectKeys).toEqual(['ABC', 'ACME']);
    expect(status.created).toBe(2);
    // The progress bar spans the whole pull, not the project being read
    expect(status.total).toBe(2);
    // written() lists what is on disk sorted, so the folders come back in
    // alphabetical order rather than in the order they were pulled
    expect(written()).toEqual([
      `ABC/${pull.NO_FEATURE}/${pull.NO_STORY}/ABC-125_orphan-test.md`,
      `ACME/${pull.NO_FEATURE}/${pull.NO_STORY}/ACME-7_another-test.md`
    ]);
  });

  test('moves a test pulled before there were project folders into its own', async () => {
    (configHelper as any).__set(BASIC_SETTINGS);
    mockProjects({ ABC: [issue('ABC-125', 'Orphan test', 'Test')] });

    await runPull();

    // What a version of the tool without project folders left on disk
    const legacy = path.join(xrayDir, pull.NO_FEATURE, pull.NO_STORY);
    const pulled = path.join(xrayDir, 'ABC', pull.NO_FEATURE, pull.NO_STORY);

    fs.mkdirSync(legacy, { recursive: true });
    fs.renameSync(
      path.join(pulled, 'ABC-125_orphan-test.md'),
      path.join(legacy, 'ABC-125_orphan-test.md')
    );
    fs.rmSync(path.join(xrayDir, 'ABC'), { recursive: true, force: true });

    const status = await runPull();

    expect(status.moved).toBe(1);
    expect(status.created).toBe(0);
    expect(written()).toEqual([`ABC/${pull.NO_FEATURE}/${pull.NO_STORY}/ABC-125_orphan-test.md`]);
  });

  test('carries on with the next project when one cannot be read', async () => {
    (configHelper as any).__set({ ...BASIC_SETTINGS, projectKey: 'NOPE, ABC' });

    mockProjects({ ABC: [issue('ABC-125', 'Orphan test', 'Test')] }, ['NOPE']);

    const status = await runPull();

    expect(status.phase).toBe('done');
    expect(status.created).toBe(1);
    expect(status.errors).toEqual([{ key: 'NOPE', message: expect.stringMatching(/No permission/) }]);
    expect(written()).toEqual([`ABC/${pull.NO_FEATURE}/${pull.NO_STORY}/ABC-125_orphan-test.md`]);
  });

  test('fails when no project at all could be read', async () => {
    (configHelper as any).__set({ ...BASIC_SETTINGS, projectKey: 'NOPE, ALSO_NOPE' });

    mockProjects({}, ['NOPE', 'ALSO_NOPE']);

    const status = await runPull();

    expect(status.phase).toBe('error');
    expect(status.error).toMatch(/No permission/);
  });

  test('rejects a project key that is not one, whichever it is', async () => {
    (configHelper as any).__set({ ...BASIC_SETTINGS, projectKey: 'ABC, 1=1' });

    await expect(jira.startPull({})).rejects.toThrow(/"1=1" is not a Jira project key/);
  });
});

describe('pull.folderSegments', () => {
  test('turns an Xray path into folder names, illegal characters and all', () => {
    expect(pull.folderSegments('/Authentication/Login')).toEqual(['Authentication', 'Login']);
    expect(pull.folderSegments('/')).toEqual([]);
    expect(pull.folderSegments(null)).toEqual([]);
    expect(pull.folderSegments('/A: B/C*D')).toEqual(['A B', 'C D']);
  });
});

describe('testDoc', () => {
  test('names a file after its key and its summary', () => {
    expect(testDoc.keyedName('ABC-1', 'Pay with a card')).toBe('ABC-1_pay-with-a-card');
    expect(testDoc.keyedName('ABC-2', 'Añadir código')).toBe('ABC-2_anadir-codigo');
    expect(testDoc.keyedName('ABC-3', '   ')).toBe('ABC-3_untitled');
  });

  test('rewrites only the description on a second pull', () => {
    const first = testDoc.build(null, { key: 'ABC-1', summary: 'Login', description: 'Before' });
    const edited = `${first}\n\`\`\`step\napplication: calculator\n\`\`\`\n`;
    const second = testDoc.build(edited, { key: 'ABC-1', summary: 'Login', description: 'After' });

    expect(second).toContain('After');
    expect(second).not.toContain('Before');
    expect(second).toContain('```step');
  });

  test('keeps the properties the user added to the file', () => {
    const first = testDoc.build(null, { key: 'ABC-1', summary: 'Login', description: 'Text' });
    const withOwn = first.replace('---\n\n', '---\n');
    const edited = withOwn.replace('xray:', 'owner: jane\nxray:');

    const second = testDoc.build(edited, { key: 'ABC-1', summary: 'Login', description: 'Text' });

    expect(second).toContain('owner: jane');
  });

  test('rewrites the test details on a second pull, keeping the steps written by hand', () => {
    const first = testDoc.build(null, {
      key: 'ABC-1',
      summary: 'Login',
      description: 'Sign in.',
      details: { testType: 'Manual', steps: [{ action: 'Open the app', result: 'It opens' }] }
    });

    expect(first).toContain('## Test details');
    expect(first).toContain('Open the app');

    const edited = `${first}\n\`\`\`step\napplication: calculator\n\`\`\`\n`;

    const second = testDoc.build(edited, {
      key: 'ABC-1',
      summary: 'Login',
      description: 'Sign in.',
      details: { testType: 'Manual', steps: [{ action: 'Open the app twice', result: 'It opens' }] }
    });

    expect(second).toContain('Open the app twice');
    expect(second).not.toContain('Open the app\n');
    expect(second).toContain('```step');
    // The block is written once, not once per pull
    expect(second.match(/## Test details/g)).toHaveLength(1);
  });

  test('leaves the details alone when the pull could not read them', () => {
    const first = testDoc.build(null, {
      key: 'ABC-1',
      summary: 'Login',
      description: 'Sign in.',
      details: { testType: 'Manual', steps: [{ action: 'Open the app' }] }
    });

    const second = testDoc.build(first, { key: 'ABC-1', summary: 'Login', description: 'Sign in.' });

    expect(second).toContain('Open the app');
    expect(second).toBe(first);
  });

  test('says so when a test has no details in Xray', () => {
    const document = testDoc.build(null, {
      key: 'ABC-1',
      summary: 'Login',
      description: 'Sign in.',
      details: { testType: 'Manual', steps: [] }
    });

    expect(document).toContain('_This test has no details in Xray._');
  });

  test('says so when Jira has no description', () => {
    expect(testDoc.build(null, { key: 'ABC-1', summary: 'Login' })).toContain('_No description in Jira._');
  });
});

describe('adf.toMarkdown', () => {
  test('converts the wiki markup of the REST v2 API', () => {
    expect(adf.toMarkdown('h1. Title')).toBe('# Title');
    expect(adf.toMarkdown('* one\n* two')).toBe('- one\n- two');
    expect(adf.toMarkdown('{code:js}\nconst a = 1;\n{code}')).toBe('```js\nconst a = 1;\n```');
    expect(adf.toMarkdown('See [the docs|https://example.com]')).toBe('See [the docs](https://example.com)');
    expect(adf.toMarkdown('{{npm test}}')).toBe('`npm test`');
    // An identifier is not emphasis
    expect(adf.toMarkdown('call some_function_name now')).toBe('call some_function_name now');
  });

  test('converts the Atlassian Document Format of the v3 API', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Steps' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open the app' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sign in', marks: [{ type: 'strong' }] }] }] }
          ]
        }
      ]
    };

    expect(adf.toMarkdown(document)).toBe('## Steps\n\n- Open the app\n- **Sign in**');
  });

  test('is empty when Jira has nothing to say', () => {
    expect(adf.toMarkdown(null)).toBe('');
    expect(adf.toMarkdown({})).toBe('');
  });
});
