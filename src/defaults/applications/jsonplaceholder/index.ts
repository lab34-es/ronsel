/**
 * A free fake REST API (jsonplaceholder.typicode.com) with posts and users.
 * Demonstrates CRUD-style steps and passing data between steps via memory.
 */
import { applications, httpClient } from 'ronsel';
import type { Context, Parameters } from 'ronsel';

/**
 * GET /posts — lists posts, optionally filtered by user.
 *
 * @param {number} [query.userId] - Only return posts authored by this user (1-10).
 * @returns {200} An array of posts.
 * ```json
 * [{ "userId": 1, "id": 1, "title": "…", "body": "…" }]
 * ```
 * @example
 * application: jsonplaceholder
 * method: listPosts
 * parameters:
 *   query:
 *     userId: 1
 * test:
 *   status: 200
 *   body: "$expr: Array.isArray(value) && value.length === 10"
 */
export const listPosts = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { query } = parameters || {};
    return httpClient.get(ctx, '/posts', { params: query || {} });
  }
], 'listPosts');

/**
 * GET /posts/{id} — fetches a single post.
 *
 * @param {number} params.id - The post id (1-100).
 * @returns {200} The post object. Unknown ids return 404.
 * ```json
 * { "userId": 1, "id": 1, "title": "…", "body": "…" }
 * ```
 * @example
 * application: jsonplaceholder
 * method: getPost
 * parameters:
 *   params:
 *     id: 1
 * test:
 *   status: 200
 *   body:
 *     id: 1
 *     userId: 1
 */
export const getPost = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const params = (parameters || {}).params || {};
    return httpClient.get(ctx, `/posts/${params.id}`);
  }
], 'getPost');

/**
 * POST /posts — creates a post (the fake API answers 201 with the new id,
 * but does not persist it).
 *
 * @param {string} body.title - Post title.
 * @param {string} body.body - Post content.
 * @param {number} body.userId - Author id.
 * @returns {201} The created post, including the id assigned by the API.
 * ```json
 * { "id": 101, "title": "…", "body": "…", "userId": 1 }
 * ```
 * @memory {write} lastPostId - The id of the created post. Later steps can
 *   read it with {{ memory.lastPostId }}.
 * @example
 * application: jsonplaceholder
 * method: createPost
 * parameters:
 *   body:
 *     title: "{{ randomString }}"
 *     body: "Written by {{ randomName }}"
 *     userId: 1
 * test:
 *   status: 201
 */
export const createPost = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { body } = parameters || {};
    const [headers, status, responseBody] = await httpClient.post(ctx, '/posts', {
      body: body || {}
    });
    const memory = responseBody && responseBody.id ? { lastPostId: responseBody.id } : {};
    return [headers, status, responseBody, memory];
  }
], 'createPost');

/**
 * GET /users/{id} — fetches a user profile.
 *
 * @param {number} params.id - The user id (1-10).
 * @returns {200} The user object with address and company details.
 * ```json
 * { "id": 1, "name": "Leanne Graham", "email": "…", "company": {} }
 * ```
 * @example
 * application: jsonplaceholder
 * method: getUser
 * parameters:
 *   params:
 *     id: 1
 * test:
 *   status: 200
 *   body:
 *     id: 1
 */
export const getUser = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const params = (parameters || {}).params || {};
    return httpClient.get(ctx, `/users/${params.id}`);
  }
], 'getUser');
