/**
 * KVService - Cloudflare KV wrapper with AES-GCM encryption
 * Encrypts sensitive data using SESSION_ENC_SECRET with key rotation support
 */
export class KVService {
  private kv: any
  private secrets: string[] = []
  private derivedKeys: Map<string, CryptoKey> = new Map()
  private requireSecret: boolean = true

  /**
   * Initialize KV service with optional encryption
   * @param kvNamespace - Cloudflare KV namespace binding
   * @param secret - Encryption secret(s) for AES-GCM encryption
   * @param options.requireSecret - Whether encryption is required (default: true)
   */
  constructor(kvNamespace: any, secret?: string | string[], options?: { requireSecret?: boolean }) {
    this.kv = kvNamespace
    
    if (Array.isArray(secret)) {
      this.secrets = secret.filter(s => !!s)
    } else if (secret) {
      this.secrets = [secret]
    }
    
    if (options && options.requireSecret === false) this.requireSecret = false

    if (this.requireSecret && this.secrets.length === 0) {
      throw new Error('KV encryption required but no `SESSION_ENC_SECRET` provided')
    }
  }

  /**
   * Derives a CryptoKey from a secret using SHA-256
   */
  private async getKey(secret: string): Promise<CryptoKey> {
    if (this.derivedKeys.has(secret)) {
      return this.derivedKeys.get(secret)!
    }

    const enc = new TextEncoder()
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(secret))
    const key = await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    
    this.derivedKeys.set(secret, key)
    return key
  }

  /**
   * Converts ArrayBuffer to base64 string for storage
   */
  private arrayBufferToBase64(buffer: ArrayBuffer) {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }

  /**
   * Converts base64 string back to ArrayBuffer for decryption
   */
  private base64ToArrayBuffer(b64: string) {
    const binary = atob(b64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  }

  /**
   * Stores data in KV with optional AES-GCM encryption
   * Uses primary secret for encryption when available
   */
  async put(key: string, value: any, expirationTtl?: number): Promise<void> {
    let dataToStore = JSON.stringify(value)

    if (this.secrets.length > 0) {
      const primarySecret = this.secrets[0]
      const keyObj = await this.getKey(primarySecret)
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const enc = new TextEncoder()
      
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        keyObj,
        enc.encode(dataToStore)
      )

      // Format: base64(iv):base64(ciphertext)
      dataToStore = `${this.arrayBufferToBase64(iv.buffer)}:${this.arrayBufferToBase64(ciphertext)}`
    }

    await this.kv.put(key, dataToStore, { expiration: expirationTtl })
  }

  /**
   * Retrieves and decrypts data from KV
   * Tries all secrets for decryption to support key rotation
   */
  async get<T>(key: string): Promise<T | null> {
    const value = await this.kv.get(key)
    if (!value) return null

    // If no secrets configured, assume plaintext
    if (this.secrets.length === 0) {
      try {
        return JSON.parse(value) as T
      } catch {
        return null
      }
    }

    // Try to decrypt with each secret in order
    for (const secret of this.secrets) {
      try {
        const parts = value.split(':')
        if (parts.length !== 2) continue // Not encrypted format

        const iv = this.base64ToArrayBuffer(parts[0])
        const ciphertext = this.base64ToArrayBuffer(parts[1])
        const keyObj = await this.getKey(secret)

        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(iv) },
          keyObj,
          ciphertext
        )

        const dec = new TextDecoder()
        return JSON.parse(dec.decode(decrypted)) as T
      } catch (e) {
        // Decryption failed with this key, try next
        continue
      }
    }

    // If all decryptions fail, check if it's plaintext (migration scenario)
    try {
      return JSON.parse(value) as T
    } catch {
      console.error(`Failed to decrypt KV key: ${key}`)
      return null
    }
  }

  /**
   * Deletes a key from KV
   */
  async delete(key: string) {
    if (!this.kv) return
    await this.kv.delete(key)
  }
}

export default KVService
