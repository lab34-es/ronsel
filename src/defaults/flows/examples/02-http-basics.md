---
title: 02 · HTTP basics
description: Query params, JSON bodies, random data and status codes against httpbin.org.
---

# HTTP basics with httpbin

This flow talks to [httpbin.org](https://httpbin.org), an HTTP echo service.
It needs internet access — make sure you run it with the `local` environment
(which points `BASE_URL` at `https://httpbin.org`).

## Echoing query parameters

`GET /get` echoes the query string back under `args`, so we can assert it:

```step
application: httpbin
method: get
description: Send a query parameter and assert the echo
parameters:
  query:
    tool: ronsel
test:
  status: 200
  body:
    args:
      tool: ronsel
```

## Random data on every run

Replacers generate **fresh random data on each execution**. Here we post a
random email and name, and assert the echoed JSON with a JavaScript
expression instead of a fixed value:

```step
application: httpbin
method: post
description: Post a random user and assert the echoed payload
parameters:
  body:
    email: "{{ randomEmail }}"
    name: "{{ randomName }}"
test:
  status: 200
  body:
    json:
      email: "$expr: typeof value === 'string' && value.includes('@')"
      name: "$expr: typeof value === 'string' && value.length > 0"
```

## Asserting error status codes

Non-2xx responses are first-class citizens: ask httpbin for a `404` and
assert it.

```step
application: httpbin
method: status
description: A 404 is exactly what we expect here
parameters:
  params:
    code: 404
test:
  status: 404
```

## Slow endpoints and retries

`/delay/{seconds}` waits before answering. Steps can declare a `retry`
policy for their tests — handy for eventually-consistent systems:

```step
application: httpbin
method: delay
description: Wait for a slow response (2 seconds)
parameters:
  params:
    seconds: 2
test:
  status: 200
  retry:
    times: 2
    delay: 1000
```
