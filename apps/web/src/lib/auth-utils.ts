// src/lib/auth-utils.ts
/**
 * Authentication utilities using Web Crypto API
 * Compatible with Edge Runtime
 */

/**
 * Generates a random hexadecimal string of specified length
 * @param length The length of the string
 * @returns A random hexadecimal string
 */
export function generateRandomString(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2))
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}

/**
 * Encodes a string as UTF-8 and returns Uint8Array
 * @param str String to encode
 * @returns Uint8Array of UTF-8 encoded string
 */
export function encodeString(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

/**
 * Converts a Uint8Array to a hex string
 * @param buffer Uint8Array to convert
 * @returns Hexadecimal string representation
 */
export function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Hashes a password with a salt using PBKDF2
 * @param password The password to hash
 * @param salt The salt to use (or generate a new one)
 * @returns Promise resolving to { hash: string, salt: string }
 */
export async function hashPassword(
  password: string,
  existingSalt?: string
): Promise<{ hash: string; salt: string }> {
  // Generate salt if not provided
  const salt = existingSalt || generateRandomString(32)

  // Convert password and salt to Uint8Arrays
  const passwordBuffer = encodeString(password)
  const saltBuffer = encodeString(salt)

  // Import the salt as a key
  const importedKey = await globalThis.crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  // Derive bits using PBKDF2
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuffer, iterations: 1000, hash: 'SHA-512' },
    importedKey,
    512 // 64 bytes (512 bits)
  )

  // Convert to hex string
  const hash = bufferToHex(new Uint8Array(derivedBits))

  return { hash, salt }
}

/**
 * Verifies a password against a stored hash and salt
 * @param password The password to verify
 * @param storedSalt The stored salt
 * @param storedHash The stored hash
 * @returns Promise resolving to boolean indicating whether password matches
 */
export async function verifyPassword(
  password: string,
  storedSalt: string,
  storedHash: string
): Promise<boolean> {
  const { hash } = await hashPassword(password, storedSalt)
  return hash === storedHash
}

/**
 * Parse a stored password string in the format "salt:hash"
 * @param storedPassword The stored password string
 * @returns Object containing salt and hash
 */
export function parseStoredPassword(storedPassword: string): {
  salt: string
  hash: string
} {
  const [salt, hash] = storedPassword.split(':')
  return { salt, hash }
}

/**
 * Format a salt and hash into a stored password string
 * @param salt The salt
 * @param hash The hash
 * @returns Formatted string "salt:hash"
 */
export function formatStoredPassword(salt: string, hash: string): string {
  return `${salt}:${hash}`
}
