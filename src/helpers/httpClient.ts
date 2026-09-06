import axios from 'axios';
import createDebug from 'debug';

const debug = createDebug('ronsel:helpers:httpClient');

/**
 * Generates request headers based on the context environment
 * @param {Object} ctx - The context object containing environment variables
 * @returns {Object} - Compiled headers object
 */
const headers = (ctx) => {
  const { env } = ctx;
  // Merge all conditional headers into a single object
  return [
    env.X_API_KEY ? { 'x-api-key': env.X_API_KEY } : {},
    env.HTTP_BASIC_AUTH ? { 'Authorization': `Basic ${Buffer.from(env.HTTP_BASIC_AUTH).toString('base64')}` } : {}
  ].reduce((acc, h) => Object.assign(acc, h), {});
};

/**
 * Core fetch function to make HTTP requests
 * @param {Object} ctx - The context object containing environment and reporter
 * @param {string} urlPath - The URL path to be appended to the base URL
 * @param {Object} opts - Request options including method, headers, data, etc.
 * @returns {Promise<Array>} - Promise resolving to [headers, status, body]
 */
const _fetch = (ctx, urlPath, opts?) => {
  // Prepare meta object to track request timing
  const meta = { start: Date.now() };

  const filteredCase = ctx.case || ''; // Default case if not provided

  // ctx.env must contain all ctx.env variables, giving priority
  // to the ones ending by "filteredCase" (e.g. "BASE_URL_filteredCase")

  if (filteredCase) {
    ctx.env = Object.keys(ctx.env).reduce((acc, key) => {
      // Check if the key ends with the filtered case
      if (key.endsWith(`_${filteredCase}`)) {
        // Create a new key without the filtered case suffix
        const newKey = key.replace(`_${filteredCase}`, '');
        acc[newKey] = ctx.env[key]; // Assign the value to the new key
      } else {
        acc[key] = ctx.env[key]; // Keep the original key-value pair
      }
      return acc;
    }, {});
  }

  // Build full URL by combining base URL with the provided path
  const fullUrl = `${ctx.env.BASE_URL}${urlPath}`;
  
  // Debug URL
  debug('Request URL: %s', fullUrl);
  
  // Extract special options and keep standard axios options
  const {
    skipCertCheck, // Custom option to bypass SSL certificate validation
    ...options
  } = opts || {};

  // Initialize and merge headers from context
  if (!options.headers) {options.headers = {};}
  options.headers = Object.assign(headers(ctx), options.headers);

  // Process request body for JSON objects
  if (options.data) {
    if (typeof options.data === 'object') {
      options.data = JSON.stringify(options.data);
      options.headers['content-type'] = 'application/json';
    }
  }
  
  if (options.body) {
    if (typeof options.body === 'object') {
      options.data = JSON.stringify(options.body);
      options.headers['content-type'] = 'application/json';
      delete options.body; // Remove body to avoid duplication
    }
  }

  // Handle SSL certificate validation bypass if requested
  const prevRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (skipCertCheck) {
    // Setting to 0 disables certificate validation (use with caution)
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
  
  // Log the outgoing request using the context's reporter
  ctx.reporter.request(options.method, { url: fullUrl, options });

  // Prepare axios request configuration
  const axiosRequest = Object.assign({}, { url: fullUrl }, options);

  // Perform the request and handle response processing
  return axios.request(axiosRequest)
    .then(response => formatResponse(ctx, response, meta))
    .catch(error => formatResponse(ctx, error, meta))
    .finally(() => {
      // Restore original SSL certificate validation setting if it was changed
      if (skipCertCheck) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevRejectUnauthorized;
      }
    });
};

/**
 * Process and format HTTP response
 * @param {Object} ctx - The context object
 * @param {Object|Error} response - The axios response or error object
 * @param {Object} meta - Metadata including timing information
 * @returns {Promise<Array>} - Promise resolving to [headers, status, body]
 */
const formatResponse = async (ctx, response, meta) => {
  let body;

  // Record end time for performance tracking
  meta.end = Date.now();

  // Determine if response is JSON based on content-type header
  // Note: For error cases, we'll check if response.response exists and has headers
  let isJson = false;
  if (response instanceof Error && (response as any).response && (response as any).response.headers) {
    const errorHeaders = (response as any).response.headers;
    isJson = errorHeaders['content-type'] && errorHeaders['content-type'].includes('application/json');
  } else if (response.headers) {
    isJson = response.headers.get && response.headers.get('content-type') &&
      response.headers.get('content-type').includes('application/json');
  }

  if (response instanceof Error) {
    // HTTP errors (4xx / 5xx) are regular responses for a flow: the step
    // tests decide whether the status code is expected or not.
    if ((response as any).response) {
      return formatResponse(ctx, (response as any).response, meta);
    }

    // Network / setup errors: fail the step (the runner reports the error
    // under the step) instead of killing the whole process.
    console.error('Error:', response.message);
    throw response;
  }

  const headers = response.headers;
  const status = response.status;

  // Re-determine if response is JSON. Supports both AxiosHeaders (with a
  // .get method) and plain header objects.
  const contentType = headers
    ? (typeof headers.get === 'function' ? headers.get('content-type') : headers['content-type'])
    : null;
  isJson = Boolean(contentType && contentType.includes('application/json'));
  
  // Parse response body according to content type
  try {
    if (isJson && response.data) {
      body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    } else {
      body = response.data || '';
    }
  } catch (_error) {
    // Fallback to raw data if parsing fails
    body = response.data || '';
  }
  
  // Log the response using the context's reporter and return response components
  return Promise.resolve([headers, status, body])
    .then(([headers, status, body]) => {
      const timing = meta.end - meta.start;
      ctx.reporter.response({ headers, status, body }, {
        ...meta,
        timing // Calculate total request duration
      });
      return [headers, status, body];
    });
};

/**
 * Perform a GET request
 * @param {Object} ctx - The context object
 * @param {string} url - The URL path
 * @param {Object} opts - Request options
 * @returns {Promise<Array>} - Promise resolving to [headers, status, body]
 */
const get = (ctx, url, opts?) => {
  return _fetch(ctx, url, Object.assign(opts || {}, { method: 'GET' }));
};

/**
 * Perform a POST request
 * @param {Object} ctx - The context object
 * @param {string} url - The URL path
 * @param {Object} opts - Request options
 * @returns {Promise<Array>} - Promise resolving to [headers, status, body]
 */
const post = (ctx, url, opts?) => {
  return _fetch(ctx, url, Object.assign(opts || {}, { method: 'POST' }));
};

/**
 * Perform a PUT request
 * @param {Object} ctx - The context object
 * @param {string} url - The URL path
 * @param {Object} opts - Request options
 * @returns {Promise<Array>} - Promise resolving to [headers, status, body]
 */
const put = (ctx, url, opts?) => {
  return _fetch(ctx, url, Object.assign(opts || {}, { method: 'PUT' }));
};

/**
 * Perform a DELETE request
 * @param {Object} ctx - The context object
 * @param {string} url - The URL path
 * @param {Object} opts - Request options
 * @returns {Promise<Array>} - Promise resolving to [headers, status, body]
 */
const del = (ctx, url, opts?) => {
  return _fetch(ctx, url, Object.assign(opts || {}, { method: 'DELETE' }));
};

/**
 * Perform a PATCH request
 * @param {Object} ctx - The context object
 * @param {string} url - The URL path
 * @param {Object} opts - Request options
 * @returns {Promise<Array>} - Promise resolving to [headers, status, body]
 */
const patch = (ctx, url, opts?) => {
  return _fetch(ctx, url, Object.assign(opts || {}, { method: 'PATCH' }));
};

export {
  get,
  post,
  put,
  del,
  patch
};
