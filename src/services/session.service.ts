import KVService from './kv.service'
import { refreshAccessToken } from './auth.service'
import type { Bindings } from './auth.service'

export interface SessionData {
  userId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

/**
 * SessionService - Manages user sessions in KV with refresh token support
 * Single source of truth with automatic token refresh and 30-day TTL
 */
export class SessionService {
  private kvService: KVService
  private env: Bindings

  constructor(kvNamespace: any, kvEncryptionSecret: string, env: Bindings) {
    this.kvService = new KVService(kvNamespace, kvEncryptionSecret, { requireSecret: true })
    this.env = env
  }

  /**
   * Creates a new session in KV with encrypted tokens and 30-day TTL
   * Also creates a user-to-session mapping
   * Cleans up any existing session for the user
   */
  async createUserSession(sessionId: string, userId: string, data: SessionData): Promise<void> {
    const expiresAt = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 30)

    // Clean up any existing session for this user
    const existingSessionId = await this.getUserSessionId(userId)
    if (existingSessionId && existingSessionId !== sessionId) {
      await this.deleteSession(existingSessionId)
    }

    await this.kvService.put(`session:${sessionId}`, {
      userId: data.userId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Math.floor(data.expiresAt / 1000)
    }, expiresAt)

    // Create user-to-session mapping (also with 30-day TTL)
    await this.kvService.put(`user_session:${userId}`, sessionId, expiresAt)
  }

  /**
   * Gets the active session ID for a user
   */
  async getUserSessionId(userId: string): Promise<string | null> {
    try {
      return await this.kvService.get<string>(`user_session:${userId}`)
    } catch (error) {
      return null
    }
  }

  /**
   * Retrieves session from KV with automatic token refresh on expiry
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const kvRes = await this.kvService.get<{
        userId: string
        accessToken: string
        refreshToken: string
        expiresAt: number
      }>(`session:${sessionId}`)
      
      if (!kvRes) return null

      const now = Math.floor(Date.now() / 1000)
      if (kvRes.expiresAt && kvRes.expiresAt < now) {
        try {
          const tokenResponse = await refreshAccessToken(kvRes.refreshToken, this.env) as any
          
          // Update session with new tokens
          const newExpiresAt = now + (tokenResponse.expires_in || 3600) // Default 1 hour
          await this.updateSession(sessionId, {
            userId: kvRes.userId,
            accessToken: tokenResponse.access_token,
            refreshToken: tokenResponse.refresh_token || kvRes.refreshToken,
            expiresAt: newExpiresAt * 1000
          })
          return {
            userId: kvRes.userId,
            accessToken: tokenResponse.access_token,
            refreshToken: tokenResponse.refresh_token || kvRes.refreshToken,
            expiresAt: newExpiresAt * 1000
          }
        } catch (refreshError) {
          await this.deleteSession(sessionId)
          return null
        }
      }

      return {
        userId: kvRes.userId,
        accessToken: kvRes.accessToken,
        refreshToken: kvRes.refreshToken,
        expiresAt: kvRes.expiresAt * 1000
      }
    } catch (error) {
      return null
    }
  }

  /**
   * Deletes a session from KV
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.kvService.delete(`session:${sessionId}`)
    } catch (error) {
      // Silently fail on delete errors
    }
  }

  /**
   * Deletes the user-to-session mapping
   */
  async deleteUserSession(userId: string): Promise<void> {
    try {
      await this.kvService.delete(`user_session:${userId}`)
    } catch (error) {
      // Silently fail on delete errors
    }
  }

  /**
   * Updates existing session in KV with new token data
   */
  async updateSession(sessionId: string, data: SessionData): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + (60 * 60 * 24 * 30)

    try {
      await this.kvService.put(`session:${sessionId}`, {
        userId: data.userId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Math.floor(data.expiresAt / 1000)
      }, expiresAt)
    } catch (error) {
      throw error
    }
  }

  /**
   * Manually refreshes session tokens
   */
  async refreshTokens(sessionId: string): Promise<SessionData | null> {
    const session = await this.kvService.get<{
      userId: string
      accessToken: string
      refreshToken: string
      expiresAt: number
    }>(`session:${sessionId}`)

    if (!session) return null

    try {
      const tokenResponse = await refreshAccessToken(session.refreshToken, this.env) as any
      const now = Math.floor(Date.now() / 1000)
      const newExpiresAt = now + (tokenResponse.expires_in || 3600)

      const updatedSession: SessionData = {
        userId: session.userId,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token || session.refreshToken,
        expiresAt: newExpiresAt * 1000
      }

      await this.updateSession(sessionId, updatedSession)
      
      return updatedSession
    } catch (error) {
      return null
    }
  }
}
