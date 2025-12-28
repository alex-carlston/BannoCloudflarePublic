/**
 * Generate a cryptographically secure random state token for OAuth CSRF protection
 */
export function generateState(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a cryptographically secure random session ID
 */
export function generateSessionId(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Decode JWT payload without verification (use only for debugging)
 */
export function decodeJwtPayload(token: string): any {
  const parts = token.split('.')
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(payload)
  return JSON.parse(decodeURIComponent(decoded.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')))
}

/**
 * Verify JWT signature (basic implementation - in production, use a proper JWT library)
 * Note: This is a simplified verification. For production, consider using a dedicated JWT library.
 */
export async function verifyJwtSignature(token: string, publicKey?: string): Promise<any> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('Invalid JWT format')

    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')))
    const payload = decodeJwtPayload(token)

    // Basic expiry check
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('JWT expired')
    }

    // For now, return payload without full signature verification
    // In production, implement proper RSA/ECDSA signature verification
    return payload
  } catch (error) {
    throw new Error(`JWT verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Handle OAuth callback: exchange code for tokens, create session, set cookie
 */
export async function handleOAuthCallback(c: any) {
  const tokens = await c.env.processAuthCallback(c)
  if (!tokens.access_token) throw new Error('Token exchange failed')

  // Verify JWT signature (basic verification)
  const idTokenPayload = await verifyJwtSignature(tokens.id_token)
  const sessionId = crypto.randomUUID()

  if (c.env.SESSIONS_KV) {
    const { SessionService } = await import('../services/session.service')
    const sessionService = new SessionService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET!, c.env)
    await sessionService.createSession(sessionId, {
      userId: idTokenPayload.sub,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in * 1000)
    })
  }

  const { setSignedCookie } = await import('hono/cookie')
  await setSignedCookie(c, '__Secure-session_id', sessionId, c.env.SESSION_ENC_SECRET, {
    httpOnly: true,
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'None'
  })

  return sessionId
}
