# Public Error Contract

GH-0704 establishes the one safe error shape that can cross a Green Hive HTTP
boundary. Domain packages continue to own their typed, specific error codes;
the platform core translates those codes before a response is sent.

## Transport shape

Every handled failure has this shape:

```ts
{
  error: {
    code: 'PROJECT_NOT_FOUND',
    category: 'NOT_FOUND',
    status: 404,
    retryable: false,
    message: 'Request could not be completed.'
  }
}
```

`code`, `category`, `status` and `retryable` are the stable contract. The
message is deliberately generic. The browser maps the code/category to its own
localized text and must never display a message supplied by a server response.

## Categories

| Category | HTTP | Retryable | Meaning |
| --- | --- | --- | --- |
| `VALIDATION` | 400 | no | External input needs correction. |
| `UNAUTHENTICATED` | 401 | no | A valid session is required. |
| `FORBIDDEN` | 403 | no | The verified caller cannot perform the action. |
| `NOT_FOUND` | 404 | no | The requested published resource is unavailable. |
| `CONFLICT` | 409 | no | The action conflicts with current state or idempotency. |
| `RATE_LIMITED` | 429 | yes | Retry after the response's retry guidance. |
| `RESOURCE_EXHAUSTED` | 409 | no | A reviewed platform resource is exhausted. |
| `UNAVAILABLE` | 503 | yes | A dependency or operation is temporarily unavailable. |
| `INTERNAL` | 500 | yes | An unknown implementation failure was safely masked. |

## Non-negotiable boundary

Only codes listed in `@green-hive/core` are preserved. An arbitrary JavaScript,
database or provider failure is returned as `INTERNAL_ERROR`; its original code,
message, details and stack do not enter JSON. This includes raw SQL, provider
tokens, storage paths and diagnostic payloads.

The contract does not authorize requests, choose app/workspace scope, alter RLS,
create observability records or introduce a browser logging provider. Those
responsibilities remain in their existing platform boundaries.
