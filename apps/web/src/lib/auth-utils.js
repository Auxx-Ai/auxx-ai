// src/lib/auth-utils.ts
/**
 * Authentication utilities using Web Crypto API
 * Compatible with Edge Runtime
 */
var __awaiter =
  (this && this.__awaiter) ||
  ((thisArg, _arguments, P, generator) => {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P((resolve) => {
            resolve(value)
          })
    }
    return new (P || (P = Promise))((resolve, reject) => {
      function fulfilled(value) {
        try {
          step(generator.next(value))
        } catch (e) {
          reject(e)
        }
      }
      function rejected(value) {
        try {
          step(generator['throw'](value))
        } catch (e) {
          reject(e)
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected)
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next())
    })
  })
var __generator =
  (this && this.__generator) ||
  ((thisArg, body) => {
    var _ = {
        label: 0,
        sent: () => {
          if (t[0] & 1) throw t[1]
          return t[1]
        },
        trys: [],
        ops: [],
      },
      f,
      y,
      t,
      g = Object.create((typeof Iterator === 'function' ? Iterator : Object).prototype)
    return (
      (g.next = verb(0)),
      (g['throw'] = verb(1)),
      (g['return'] = verb(2)),
      typeof Symbol === 'function' &&
        (g[Symbol.iterator] = function () {
          return this
        }),
      g
    )
    function verb(n) {
      return (v) => step([n, v])
    }
    function step(op) {
      if (f) throw new TypeError('Generator is already executing.')
      while ((g && ((g = 0), op[0] && (_ = 0)), _))
        try {
          if (
            ((f = 1),
            y &&
              (t =
                op[0] & 2
                  ? y['return']
                  : op[0]
                    ? y['throw'] || ((t = y['return']) && t.call(y), 0)
                    : y.next) &&
              !(t = t.call(y, op[1])).done)
          )
            return t
          if (((y = 0), t)) op = [op[0] & 2, t.value]
          switch (op[0]) {
            case 0:
            case 1:
              t = op
              break
            case 4:
              _.label++
              return { value: op[1], done: false }
            case 5:
              _.label++
              y = op[1]
              op = [0]
              continue
            case 7:
              op = _.ops.pop()
              _.trys.pop()
              continue
            default:
              if (
                !((t = _.trys), (t = t.length > 0 && t[t.length - 1])) &&
                (op[0] === 6 || op[0] === 2)
              ) {
                _ = 0
                continue
              }
              if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) {
                _.label = op[1]
                break
              }
              if (op[0] === 6 && _.label < t[1]) {
                _.label = t[1]
                t = op
                break
              }
              if (t && _.label < t[2]) {
                _.label = t[2]
                _.ops.push(op)
                break
              }
              if (t[2]) _.ops.pop()
              _.trys.pop()
              continue
          }
          op = body.call(thisArg, _)
        } catch (e) {
          op = [6, e]
          y = 0
        } finally {
          f = t = 0
        }
      if (op[0] & 5) throw op[1]
      return { value: op[0] ? op[1] : void 0, done: true }
    }
  })
/**
 * Generates a random hexadecimal string of specified length
 * @param length The length of the string
 * @returns A random hexadecimal string
 */
export function generateRandomString(length) {
  var bytes = new Uint8Array(Math.ceil(length / 2))
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
export function encodeString(str) {
  return new TextEncoder().encode(str)
}
/**
 * Converts a Uint8Array to a hex string
 * @param buffer Uint8Array to convert
 * @returns Hexadecimal string representation
 */
export function bufferToHex(buffer) {
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
export function hashPassword(password, existingSalt) {
  return __awaiter(this, void 0, void 0, function () {
    var salt, passwordBuffer, saltBuffer, importedKey, derivedBits, hash
    return __generator(this, (_a) => {
      switch (_a.label) {
        case 0:
          salt = existingSalt || generateRandomString(32)
          passwordBuffer = encodeString(password)
          saltBuffer = encodeString(salt)
          return [
            4 /*yield*/,
            globalThis.crypto.subtle.importKey('raw', passwordBuffer, { name: 'PBKDF2' }, false, [
              'deriveBits',
            ]),
            // Derive bits using PBKDF2
          ]
        case 1:
          importedKey = _a.sent()
          return [
            4 /*yield*/,
            globalThis.crypto.subtle.deriveBits(
              { name: 'PBKDF2', salt: saltBuffer, iterations: 1000, hash: 'SHA-512' },
              importedKey,
              512 // 64 bytes (512 bits)
            ),
            // Convert to hex string
          ]
        case 2:
          derivedBits = _a.sent()
          hash = bufferToHex(new Uint8Array(derivedBits))
          return [2 /*return*/, { hash: hash, salt: salt }]
      }
    })
  })
}
/**
 * Verifies a password against a stored hash and salt
 * @param password The password to verify
 * @param storedSalt The stored salt
 * @param storedHash The stored hash
 * @returns Promise resolving to boolean indicating whether password matches
 */
export function verifyPassword(password, storedSalt, storedHash) {
  return __awaiter(this, void 0, void 0, function () {
    var hash
    return __generator(this, (_a) => {
      switch (_a.label) {
        case 0:
          return [4 /*yield*/, hashPassword(password, storedSalt)]
        case 1:
          hash = _a.sent().hash
          return [2 /*return*/, hash === storedHash]
      }
    })
  })
}
/**
 * Parse a stored password string in the format "salt:hash"
 * @param storedPassword The stored password string
 * @returns Object containing salt and hash
 */
export function parseStoredPassword(storedPassword) {
  var _a = storedPassword.split(':'),
    salt = _a[0],
    hash = _a[1]
  return { salt: salt, hash: hash }
}
/**
 * Format a salt and hash into a stored password string
 * @param salt The salt
 * @param hash The hash
 * @returns Formatted string "salt:hash"
 */
export function formatStoredPassword(salt, hash) {
  return ''.concat(salt, ':').concat(hash)
}
