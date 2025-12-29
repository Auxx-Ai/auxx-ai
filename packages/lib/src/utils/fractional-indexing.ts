// packages/lib/src/utils/fractional-indexing.ts
// License: CC0 (no rights reserved).
// Based on https://observablehq.com/@dgreensp/implementing-fractional-indexing

/** Base 62 digits for order key generation */
export const BASE_62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Generate a midpoint string between two strings
 * @param a - Lower bound (may be empty string)
 * @param b - Upper bound (null or non-empty string)
 * @param digits - Character set for digits
 * @returns Midpoint string
 */
function midpoint(a: string, b: string | null | undefined, digits: string): string {
  const zero = digits[0]!
  if (b != null && a >= b) {
    throw new Error(a + ' >= ' + b)
  }
  if (a.slice(-1) === zero || (b && b.slice(-1) === zero)) {
    throw new Error('trailing zero')
  }
  if (b) {
    // Remove longest common prefix. Pad `a` with 0s as we go.
    let n = 0
    while ((a[n] || zero) === b[n]) {
      n++
    }
    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n), digits)
    }
  }
  // First digits (or lack of digit) are different
  const digitA = a ? digits.indexOf(a[0]!) : 0
  const digitB = b != null ? digits.indexOf(b[0]!) : digits.length
  if (digitB - digitA > 1) {
    const midDigit = Math.round(0.5 * (digitA + digitB))
    return digits[midDigit]!
  } else {
    // First digits are consecutive
    if (b && b.length > 1) {
      return b.slice(0, 1)
    } else {
      return digits[digitA]! + midpoint(a.slice(1), null, digits)
    }
  }
}

/**
 * Validate an integer part of an order key
 * @param int - Integer string to validate
 */
function validateInteger(int: string): void {
  if (int.length !== getIntegerLength(int[0]!)) {
    throw new Error('invalid integer part of order key: ' + int)
  }
}

/**
 * Get the length of an integer based on its head character
 * @param head - First character of the integer
 * @returns Expected length of the integer
 */
function getIntegerLength(head: string): number {
  if (head >= 'a' && head <= 'z') {
    return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
  } else if (head >= 'A' && head <= 'Z') {
    return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2
  } else {
    throw new Error('invalid order key head: ' + head)
  }
}

/**
 * Extract the integer part from an order key
 * @param key - Order key
 * @returns Integer part of the key
 */
function getIntegerPart(key: string): string {
  const integerPartLength = getIntegerLength(key[0]!)
  if (integerPartLength > key.length) {
    throw new Error('invalid order key: ' + key)
  }
  return key.slice(0, integerPartLength)
}

/**
 * Validate an order key
 * @param key - Order key to validate
 * @param digits - Character set for digits
 */
function validateOrderKey(key: string, digits: string): void {
  if (key === 'A' + digits[0]!.repeat(26)) {
    throw new Error('invalid order key: ' + key)
  }
  const i = getIntegerPart(key)
  const f = key.slice(i.length)
  if (f.slice(-1) === digits[0]) {
    throw new Error('invalid order key: ' + key)
  }
}

/**
 * Increment an integer (may return null if at maximum)
 * @param x - Integer to increment
 * @param digits - Character set for digits
 * @returns Incremented integer or null
 */
function incrementInteger(x: string, digits: string): string | null {
  validateInteger(x)
  const head = x[0]!
  const digs = x.slice(1).split('')
  let carry = true
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = digits.indexOf(digs[i]!) + 1
    if (d === digits.length) {
      digs[i] = digits[0]!
    } else {
      digs[i] = digits[d]!
      carry = false
    }
  }
  if (carry) {
    if (head === 'Z') {
      return 'a' + digits[0]!
    }
    if (head === 'z') {
      return null
    }
    const h = String.fromCharCode(head.charCodeAt(0) + 1)
    if (h > 'a') {
      digs.push(digits[0]!)
    } else {
      digs.pop()
    }
    return h + digs.join('')
  } else {
    return head + digs.join('')
  }
}

/**
 * Decrement an integer (may return null if at minimum)
 * @param x - Integer to decrement
 * @param digits - Character set for digits
 * @returns Decremented integer or null
 */
function decrementInteger(x: string, digits: string): string | null {
  validateInteger(x)
  const head = x[0]!
  const digs = x.slice(1).split('')
  let borrow = true
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = digits.indexOf(digs[i]!) - 1
    if (d === -1) {
      digs[i] = digits.slice(-1)
    } else {
      digs[i] = digits[d]!
    }
    borrow = d === -1
  }
  if (borrow) {
    if (head === 'a') {
      return 'Z' + digits.slice(-1)
    }
    if (head === 'A') {
      return null
    }
    const h = String.fromCharCode(head.charCodeAt(0) - 1)
    if (h < 'Z') {
      digs.push(digits.slice(-1))
    } else {
      digs.pop()
    }
    return h + digs.join('')
  } else {
    return head + digs.join('')
  }
}

/**
 * Generate an order key between two keys
 * @param a - Lower bound order key (null for start)
 * @param b - Upper bound order key (null for end)
 * @param digits - Character set for digits (defaults to BASE_62_DIGITS)
 * @returns New order key between a and b
 */
export function generateKeyBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  digits: string = BASE_62_DIGITS
): string {
  if (a != null) {
    validateOrderKey(a, digits)
  }
  if (b != null) {
    validateOrderKey(b, digits)
  }
  if (a != null && b != null && a >= b) {
    throw new Error(a + ' >= ' + b)
  }
  if (a == null) {
    if (b == null) {
      return 'a' + digits[0]!
    }

    const ib = getIntegerPart(b)
    const fb = b.slice(ib.length)
    if (ib === 'A' + digits[0]!.repeat(26)) {
      return ib + midpoint('', fb, digits)
    }
    if (ib < b) {
      return ib
    }
    const res = decrementInteger(ib, digits)
    if (res == null) {
      throw new Error('cannot decrement any more')
    }
    return res
  }

  if (b == null) {
    const ia = getIntegerPart(a)
    const fa = a.slice(ia.length)
    const i = incrementInteger(ia, digits)
    return i == null ? ia + midpoint(fa, null, digits) : i
  }

  const ia = getIntegerPart(a)
  const fa = a.slice(ia.length)
  const ib = getIntegerPart(b)
  const fb = b.slice(ib.length)
  if (ia === ib) {
    return ia + midpoint(fa, fb, digits)
  }
  const i = incrementInteger(ia, digits)
  if (i == null) {
    throw new Error('cannot increment any more')
  }
  if (i < b) {
    return i
  }
  return ia + midpoint(fa, null, digits)
}

/**
 * Generate n order keys between two keys
 * @param a - Lower bound order key (null for start)
 * @param b - Upper bound order key (null for end)
 * @param n - Number of keys to generate
 * @param digits - Character set for digits (defaults to BASE_62_DIGITS)
 * @returns Array of n distinct keys in sorted order
 */
export function generateNKeysBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  n: number,
  digits: string = BASE_62_DIGITS
): string[] {
  if (n === 0) {
    return []
  }
  if (n === 1) {
    return [generateKeyBetween(a, b, digits)]
  }
  if (b == null) {
    let c = generateKeyBetween(a, b, digits)
    const result = [c]
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(c, b, digits)
      result.push(c)
    }
    return result
  }
  if (a == null) {
    let c = generateKeyBetween(a, b, digits)
    const result = [c]
    for (let i = 0; i < n - 1; i++) {
      c = generateKeyBetween(a, c, digits)
      result.push(c)
    }
    result.reverse()
    return result
  }
  const mid = Math.floor(n / 2)
  const c = generateKeyBetween(a, b, digits)
  return [...generateNKeysBetween(a, c, mid, digits), c, ...generateNKeysBetween(c, b, n - mid - 1, digits)]
}
