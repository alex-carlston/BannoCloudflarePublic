import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { jsxRenderer } from 'hono/jsx-renderer'
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'
import { csrf } from 'hono/csrf'
import { bodyLimit } from 'hono/body-limit'
import { Layout } from './layout'
import type { HonoEnv } from './types'
import { createAuthRoutes } from './routes/auth.routes'
import { createPageRoutes } from './routes/page.routes.tsx'

const app = new Hono<HonoEnv>()

// Logging
app.use('*', logger())

// Security Headers
app.use('*', secureHeaders({
  xFrameOptions: false, // Allow iframe embedding
  xContentTypeOptions: true,
  xXssProtection: true,
  strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
}))

// Body Size Limit
app.use('*', bodyLimit({
  maxSize: 50 * 1024, // 50 KB
  onError: (c) => c.text('Request body too large', 413),
}))

// CORS
app.use('*', cors({
  origin: (origin: string) => {
    // Allow HTTPS origins and localhost for development
    if (origin?.startsWith('https://') && origin.endsWith('.banno.com')) {
      return origin
    }
    // Allow localhost for development (both HTTP and HTTPS)
    if (origin?.includes('localhost')) {
      return origin
    }
    return null // Reject invalid origins
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
}))

// Rate Limiting Middleware
app.use('/auth/*', async (c, next) => {
  // Simple IP-based rate limiting using KV
  const clientIP = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
  const key = `ratelimit:auth:${clientIP}`

  if (c.env.SESSIONS_KV) {
    try {
      const current = await c.env.SESSIONS_KV.get(key)
      const count = current ? parseInt(current) : 0

      if (count >= 10) { // 10 requests per minute
        return c.text('Rate limit exceeded. Please try again later.', 429, {
          'Retry-After': '60'
        })
      }

      // Increment counter with 60 second expiry
      await c.env.SESSIONS_KV.put(key, (count + 1).toString(), { expirationTtl: 60 })
    } catch (error) {
      // Continue if rate limiting fails (fail open)
      console.warn('Rate limiting check failed:', error)
    }
  }

  await next()
})

// Input Validation Middleware
app.use('*', async (c, next) => {
  // Sanitize query parameters - basic XSS prevention
  const url = new URL(c.req.url)
  for (const [key, value] of url.searchParams) {
    if (value.includes('<script') || value.includes('javascript:') || value.includes('data:text/html')) {
      return c.text('Invalid request parameters', 400)
    }
  }
  await next()
})

// CSRF Protection (exclude OAuth routes which use state parameter)
app.use('*', async (c, next) => {
  // Skip CSRF for OAuth routes (they use state parameter instead)
  if (c.req.path.startsWith('/auth') || c.req.path.startsWith('/callback')) {
    return next()
  }

  // Apply CSRF protection to other routes
  const csrfMiddleware = csrf({
    origin: (origin) => {
      // Allow requests from the same origin, Banno domains, or localhost
      const requestOrigin = new URL(c.req.url).origin
      return !origin || origin === requestOrigin || origin.includes('.banno.com') || origin.includes('localhost')
    }
  })

  return csrfMiddleware(c, next)
})

// JSX Renderer
app.use('*', jsxRenderer(({ children }) => (
  <Layout>{children}</Layout>
), { docType: false }))

// CSP
app.use('*', async (c, next) => {
  await next()
  const envUri = c.env.ENV_URI || 'https://digital.garden-fi.com'
  const cspPolicy = `frame-ancestors 'self' ${envUri}; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com 'unsafe-inline'; img-src 'self' https:; connect-src 'self' https://api.banno.com https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; form-action 'self' ${envUri}; frame-src 'self' ${envUri}; base-uri 'self'; default-src 'self'`
  c.res.headers.set('Content-Security-Policy', cspPolicy)
})

// === ROUTES ===

// Mount auth routes
app.route('/', createAuthRoutes())

// Mount page routes
app.route('/', createPageRoutes())

// 404 handler
app.notFound((c) => {
  return c.text('Not Found', 404)
})

// Error handler - Don't leak sensitive information
app.onError((err, c) => {
  console.error('Application error:', {
    message: err.message,
    stack: err.stack,
    url: c.req.url,
    method: c.req.method,
    // Don't log sensitive headers or body
  })

  // Return generic error message
  return c.text('Internal Server Error', 500)
})

export default app