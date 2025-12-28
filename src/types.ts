/**
 * Centralized type definitions for the application
 */
export interface CloudflareBindings {
  CLIENT_ID: string
  CLIENT_SECRET: string
  REDIRECT_URI: string
  ENV_URI: string
  SESSION_ENC_SECRET?: string
  SESSIONS_KV?: KVNamespace
  DB?: D1Database
}

/**
 * Hono context variables (request-scoped)
 */
export interface Variables {
  requestId?: string
  cspNonce?: string
  userId?: string
}

/**
 * ID Token payload from Banno OIDC
 */
export interface IdTokenPayload {
  sub: string
  [key: string]: any
}

export type HonoEnv = {
  Bindings: CloudflareBindings
  Variables: Variables
}

// Component types
export type ComponentChildren = any

export interface LayoutProps {
  children: ComponentChildren
  title?: string
}