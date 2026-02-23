// packages/seed/src/utils/auth-hash.ts
// Helpers for generating and verifying scrypt-based password hashes used by auth seeding

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { scryptAsync } from '@noble/hashes/scrypt.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

/** SCRYPT_CONFIG matches the production Better Auth hashing parameters. */
const SCRYPT_CONFIG = {
  /** N is the CPU/memory cost parameter. */
  N: 16384,
  /** r controls block size for scrypt. */
  r: 16,
  /** p controls parallelization for scrypt. */
  p: 1,
  /** dkLen sets the derived key length in bytes. */
  dkLen: 64,
  /** maxmem prevents excessive memory usage. */
  maxmem: 128 * 16384 * 16 * 2,
} as const

/** HashedPassword represents the structured result of a hashing operation. */
export interface HashedPassword {
  /** salt stores the hexadecimal salt used for hashing. */
  salt: string
  /** keyHex stores the derived key in hexadecimal form. */
  keyHex: string
  /** value concatenates salt and keyHex for database storage. */
  value: string
}

/** randomSalt produces a 16-byte random salt compatible with scrypt hashing. */
function randomSalt(): string {
  const webCrypto = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined

  if (webCrypto?.getRandomValues) {
    const saltBytes = new Uint8Array(16)
    webCrypto.getRandomValues(saltBytes)
    return bytesToHex(saltBytes)
  }

  return bytesToHex(randomBytes(16))
}

/**
 * hashPassword hashes the provided password using scrypt with deterministic salt support.
 * @param password - Plain-text password to hash.
 * @param existingSalt - Optional salt for deterministic hashing.
 * @returns Structured hash information suitable for database ingestion.
 */
export async function hashPassword(
  password: string,
  existingSalt?: string
): Promise<HashedPassword> {
  const salt = existingSalt ?? randomSalt()
  const key = await scryptAsync(
    utf8ToBytes(password.normalize('NFKC')),
    utf8ToBytes(salt),
    SCRYPT_CONFIG
  )
  const keyHex = bytesToHex(key)
  return {
    salt,
    keyHex,
    value: `${salt}:${keyHex}`,
  }
}

/**
 * constantTimeEqual performs a timing-safe equality check between two byte arrays.
 * @param left - The first byte array.
 * @param right - The second byte array.
 * @returns True when arrays match exactly.
 */
function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  return timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

/**
 * verifyPassword validates a plain-text password against a stored scrypt hash.
 * @param password - Plain password to verify.
 * @param stored - Stored salt:keyHex pair from the database.
 * @returns True when the password matches the stored hash.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, keyHex] = stored.split(':')
  if (!salt || !keyHex) return false

  const derived = await hashPassword(password, salt)
  return constantTimeEqual(hexToBytes(derived.keyHex), hexToBytes(keyHex))
}
