import { sign, verify } from 'hono/jwt'

export interface AuthPayload {
  sub: string // user ID from Banno
  email: string
  name?: string
  accessToken: string
  refreshToken?: string
  exp: number // expiration time
  iat: number // issued at time
}

// Create a signed JWT session token for authenticated user

export async function createSessionToken(
  payload: Omit<AuthPayload, 'exp' | 'iat'>,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const token = await sign(
    {
      ...payload,
      iat: now,
      exp: now + 60 * 60 * 24 * 30, // 30 days
    },
    secret
  )
  return token
}

// Verify and decode a JWT session token

export async function verifySessionToken(
  token: string,
  secret: string
): Promise<AuthPayload> {
  const payload = await verify(token, secret)
  return payload as unknown as AuthPayload
}

// Exchange OAuth authorization code for tokens from Banno

export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  envUri: string
): Promise<{ accessToken: string; refreshToken?: string }> {
  const tokenEndpoint = `${envUri}oauth/token`

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  })

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.statusText}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    token_type: string
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  }
}

// Get user info from Banno using access token

export async function getUserInfo(
  accessToken: string,
  envUri: string
): Promise<{ sub: string; email: string; name?: string }> {
  const userInfoEndpoint = `${envUri}oauth/userinfo`

  const response = await fetch(userInfoEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.statusText}`)
  }

  return response.json()
}