import { Hono } from 'hono'
import { Bindings } from '../services/auth.service'
import { Variables } from '../types'
import { renderPlugin } from '../services/plugin.service.tsx'
import { initiateAuth } from '../services/auth.service'

export function createPageRoutes(): Hono<{ Bindings: Bindings, Variables: Variables }> {
  const router = new Hono<{ Bindings: Bindings, Variables: Variables }>()

  // Home Route
  router.get('/', async (c) => {
    const loginUrl = await initiateAuth(c)
    
    return c.render(
      <div className="container mt-5">
        <div className="row">
          <div className="col-md-8 mx-auto">
            <h1 className="display-4 fw-bold">Welcome to Banno</h1>
            <p className="lead mt-3">A modern plugin starter for Banno developers.</p>
            <div className="card mt-4">
              <div className="card-body">
                <h5 className="card-title">Getting Started</h5>
                <p>Sign in to see your account information and data.</p>
                <a href={loginUrl} className="btn btn-primary">Sign In with Banno</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  })

  // Login Route - Redirects to the REDIRECT_URI backend's auth login
  router.get('/login', (c) => {
    const redirectUri = c.env.REDIRECT_URI || 'http://localhost:8787'
    const baseUrl = redirectUri.replace(/\/callback$/, '')
    return c.redirect(`${baseUrl}/auth/login`)
  })

  // Plugin Route - Renders plugin content at /callback/plugin
  // Also accessible at /dashboard for existing sessions
  // Handles OAuth callback if code/state params are present
  router.get('/callback/plugin', renderPlugin)
  router.get('/dashboard', renderPlugin)

  return router
}
