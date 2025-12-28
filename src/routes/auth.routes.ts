import { Hono, Context } from 'hono'
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie'
import { Bindings, initiateAuth } from '../services/auth.service'
import { SessionService } from '../services/session.service'
import { handleOAuthCallback } from '../utils/auth'
import type { Variables } from '../types'

export function createAuthRoutes(): Hono<{ Bindings: Bindings; Variables: Variables }> {
  const router = new Hono<{ Bindings: Bindings; Variables: Variables }>()

  // Login Route - Redirects to Banno's OAuth authorization endpoint
  router.get('/auth/login', async (c) => {
    const url = await initiateAuth(c)
    return c.redirect(url)
  })

  // Logout Route
  router.get('/logout', async (c) => {
    // Retrieve signed session cookie
    const sessionId = await getSignedCookie(c, c.env.SESSION_ENC_SECRET!, '__Secure-session_id')
    
    if (sessionId && c.env.SESSIONS_KV) {
      const sessionService = new SessionService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET!, c.env)
      
      // Get session data to find user ID for cleanup
      const session = await sessionService.getSession(sessionId)
      if (session) {
        // Clean up user-to-session mapping
        await sessionService.deleteUserSession(session.userId)
      }
      
      // Delete the session
      await sessionService.deleteSession(sessionId)
    }
    
    // Delete signed cookie
    deleteCookie(c, '__Secure-session_id', {
      secure: true,
      path: '/'
    })
    
    return c.redirect('/')
  })

  // Callback Route - OAuth callback from Banno
  router.get('/callback', async (c) => {
    const code = c.req.query('code')
    const error = c.req.query('error')
    const error_description = c.req.query('error_description')

    if (error) return c.text(`Authentication Error: ${error_description || error}`, 400)
    if (!code) return c.redirect('/auth/login')

    try {
      await handleOAuthCallback(c)
      return c.redirect('/callback/plugin')
    } catch (error: any) {
      return c.text('Error during authentication: ' + error.message, 500)
    }
  })

  return router
}
