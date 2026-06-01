import { safeStorage } from 'electron'

const ENC_PREFIX = 'ENC:v2:'

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function encryptValue(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) return plaintext
  const encrypted = safeStorage.encryptString(plaintext)
  return ENC_PREFIX + encrypted.toString('base64')
}

export function decryptValue(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Cannot decrypt: safeStorage is not available on this platform')
  }
  const b64 = stored.slice(ENC_PREFIX.length)
  const buffer = Buffer.from(b64, 'base64')
  return safeStorage.decryptString(buffer)
}

export function isEncryptedValue(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX)
}