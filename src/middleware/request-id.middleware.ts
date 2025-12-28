import { Context, Next } from 'hono'

// Generates a unique ID for each request and stores it in context variables.
export function requestId() {
  return async (c: Context, next: Next) => {
    const id = crypto.randomUUID()
    c.set('requestId', id)
    c.res.headers.set('X-Request-ID', id)
    await next()
  }
}
