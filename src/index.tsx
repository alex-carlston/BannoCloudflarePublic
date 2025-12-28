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
    if (origin.includes('localhost') || origin.endsWith('.banno.com')) {
      return origin
    }
    return 'http://localhost:3000'
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
}))

// CSRF
app.use('*', csrf())

// JSX Renderer
app.use('*', jsxRenderer(({ children }) => (
  <Layout>{children}</Layout>
), { docType: false }))

// CSP
app.use('*', async (c, next) => {
  await next()
  const cspPolicy = `frame-ancestors 'self' ${c.env.ENV_URI} http://localhost:3000; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; img-src 'self' data: https:; connect-src 'self' https://api.banno.com https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com; form-action 'self' ${c.env.ENV_URI}; frame-src 'self' ${c.env.ENV_URI}; base-uri 'self'; default-src 'self'`
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

// Error handler
app.onError((err, c) => {
  console.error('Error:', err)
  return c.text('Internal Server Error', 500)
})

export default app