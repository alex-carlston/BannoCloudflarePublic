import { Context } from 'hono'
import { setSignedCookie } from 'hono/cookie'
import { processAuthCallback } from '../services/auth.service'
import { SessionService } from '../services/session.service'
import { decodeJwtPayload } from './crypto'
import type { CloudflareBindings, Variables } from '../types'

export async function handleOAuthCallback(c: Context<{ Bindings: CloudflareBindings; Variables: Variables }>) {
  const tokens = await processAuthCallback(c)
  if (!tokens.access_token) throw new Error('Token exchange failed')

  const idTokenPayload = decodeJwtPayload(tokens.id_token) as { sub: string }
  const userId = idTokenPayload.sub

  if (!c.env.SESSIONS_KV) throw new Error('SESSIONS_KV required')
  if (!c.env.SESSION_ENC_SECRET) throw new Error('SESSION_ENC_SECRET required')

  const sessionService = new SessionService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET!, c.env)

  // Check if user already has an active session
  const existingSessionId = await sessionService.getUserSessionId(userId)

  let sessionId: string
  if (existingSessionId) {
    // Update existing session with new tokens
    sessionId = existingSessionId
    await sessionService.updateSession(sessionId, {
      userId: userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in * 1000)
    })
  } else {
    // Create new session for user
    sessionId = crypto.randomUUID()
    await sessionService.createUserSession(sessionId, userId, {
      userId: userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in * 1000)
    })
  }

  await setSignedCookie(c, '__Secure-session_id', sessionId, c.env.SESSION_ENC_SECRET, {
    httpOnly: true,
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'None'
  })

  return sessionId
}