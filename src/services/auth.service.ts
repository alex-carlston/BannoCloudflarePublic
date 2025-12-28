import { Context } from 'hono'
import KVService from './kv.service'
import { decodeJwtPayload } from '../utils/crypto'
import type { CloudflareBindings, Variables } from '../types'

export type Bindings = CloudflareBindings

/**
 * OAuth 2.0 scopes for Banno API access
 * Core: openid, offline_access, profile
 * Banno-specific: accounts, user data, transactions, documents
 */
const SCOPES = [
  'openid',
  'offline_access',
  'profile',
  'https://api.banno.com/consumer/auth/accounts.readonly',
  'https://api.banno.com/consumer/auth/user.readonly',
  'https://api.banno.com/consumer/auth/user.profile.readonly',
  'https://api.banno.com/consumer/claim/devices.readonly',
  'https://api.banno.com/consumer/claim/netteller_id.readonly',
  'https://api.banno.com/consumer/claim/phone_numbers.readonly',
  'https://api.banno.com/consumer/claim/user_type.readonly',
  'https://api.banno.com/consumer/auth/documents.readonly',
  'https://api.banno.com/consumer/auth/transactions.detail.readonly',
  'https://api.banno.com/consumer/claim/customer_identifier.readonly',
  'https://api.banno.com/consumer/claim/loans.readonly',
  'https://api.banno.com/consumer/claim/shares.readonly'
]

export interface AuthInitResult {
  url: string;
  codeVerifier: string;
  state: string;
}

export interface TokenResponse {
  access_token: string
  id_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

function base64UrlEncode(array: Uint8Array) {
  return btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateRandomString(length: number = 32) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Generates PKCE parameters for OAuth security
 * Creates code_verifier and code_challenge for authorization code flow
 */
async function generatePKCE() {
  const codeVerifier = await generateRandomString();

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = base64UrlEncode(new Uint8Array(hash));

  return { codeVerifier, codeChallenge };
}

/**
 * Generates OAuth authorization URL with PKCE parameters
 * Includes client_id, scope, redirect_uri, code_challenge, and state for CSRF protection
 */
export async function generateAuthUrl(env: Bindings): Promise<AuthInitResult> {
  const { codeVerifier, codeChallenge } = await generatePKCE()
  const state = await generateRandomString(16)

  const params = new URLSearchParams({
    client_id: env.CLIENT_ID,
    response_type: 'code',
    scope: SCOPES.join(' '),
    redirect_uri: env.REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: state
  })

  return {
    url: `${env.ENV_URI}/a/consumer/api/v0/oidc/auth?${params.toString()}`,
    codeVerifier,
    state
  }
}

export async function initiateAuth(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<string> {
  const { url, codeVerifier, state } = await generateAuthUrl(c.env)
  
  if (c.env.SESSIONS_KV) {
    const kvService = new KVService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET, { requireSecret: false })
    const expiresAt = Math.floor(Date.now() / 1000) + 600
    await kvService.put(`auth_state:${state}`, { codeVerifier }, expiresAt)
  }

  return url
}

/**
 * Processes OAuth callback and exchanges authorization code for tokens
 * Validates state parameter for CSRF protection and retrieves stored code_verifier
 */
export async function processAuthCallback(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<TokenResponse> {
  const code = c.req.query('code')
  const error = c.req.query('error')
  const error_description = c.req.query('error_description')
  const state = c.req.query('state')

  if (error) throw new Error(error_description || error || 'Unknown error')
  if (!code) throw new Error('No code provided')
  if (!state) throw new Error('No state provided')

  let codeVerifier: string | undefined
  if (c.env.SESSIONS_KV) {
    const kvService = new KVService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET, { requireSecret: false })
    const authState = await kvService.get<{ codeVerifier: string }>(`auth_state:${state}`)
    if (authState) {
      codeVerifier = authState.codeVerifier
      await kvService.delete(`auth_state:${state}`)
    } else {
      throw new Error('Invalid or expired OAuth state')
    }
  } else {
    throw new Error('KV namespace required for authentication')
  }

  if (!codeVerifier) throw new Error('Invalid state or missing code verifier')

  return await exchangeCodeForToken(code, codeVerifier, c.env)
}

/**
 * Exchanges authorization code for OAuth tokens using PKCE verifier
 */
export async function exchangeCodeForToken(code: string, codeVerifier: string, env: Bindings): Promise<TokenResponse> {
  const response = await fetch(`${env.ENV_URI}/a/consumer/api/v0/oidc/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.REDIRECT_URI,
      code_verifier: codeVerifier
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`)
  }

  return await response.json()
}

/**
 * Refreshes access token using refresh token
 * Returns new access_token and optionally new refresh_token
 */
export async function refreshAccessToken(refreshToken: string, env: Bindings): Promise<TokenResponse> {
  const response = await fetch(`${env.ENV_URI}/a/consumer/api/v0/oidc/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`)
  }

  return await response.json()
}
