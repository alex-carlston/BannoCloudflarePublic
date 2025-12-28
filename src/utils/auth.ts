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
  const sessionId = crypto.randomUUID()

  if (c.env.SESSIONS_KV) {
    const sessionService = new SessionService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET!, c.env)
    await sessionService.createSession(sessionId, {
      userId: idTokenPayload.sub,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in * 1000)
    })
  }

  if (!c.env.SESSION_ENC_SECRET) throw new Error('SESSION_ENC_SECRET required')

  await setSignedCookie(c, '__Secure-session_id', sessionId, c.env.SESSION_ENC_SECRET, {
    httpOnly: true,
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'None'
  })

  return sessionId
}