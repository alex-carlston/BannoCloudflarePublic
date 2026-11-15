import { Context } from 'hono'
import { setSignedCookie } from 'hono/cookie'
import { processAuthCallback } from '../services/auth.service'
import { SessionService } from '../services/session.service'
import KVService from '../services/kv.service'
import { decodeJwtPayload } from './crypto'
import type { CloudflareBindings, Variables } from '../types'

// Keys the /claims inspector never stores or shows: PII and full account/card numbers.
// Matches claim URIs too (e.g. .../claim/phone_numbers). Add keys here as new ones turn up.
const SENSITIVE_KEY = /birth|dob|address|street|postal|zip|phone|tax|ssn|social|cvv|^numbers?$|account_?number|card_?number|full_?number|micr|expiration|^pan$|unmasked/i

export function redactSensitive(value: any): any {
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) =>
      [k, v != null && SENSITIVE_KEY.test(k) ? '[redacted]' : redactSensitive(v)]))
  }
  return value
}

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

  // Keep the decoded id_token claims (accounts, cards, user...) for the /claims inspector
  const kvService = new KVService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET)
  await kvService.put(`id_token:${userId}`, redactSensitive(idTokenPayload), Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30)

  await setSignedCookie(c, '__Secure-session_id', sessionId, c.env.SESSION_ENC_SECRET, {
    httpOnly: true,
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'None'
  })

  return sessionId
}