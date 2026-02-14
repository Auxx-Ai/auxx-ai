// packages/lib/src/workflow-engine/utils/serialization.ts

/**
 * Custom JSON replacer function to handle BigInt values
 */
export function bigIntReplacer(key: string, value: any): any {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  return value
}

/**
 * Safely serialize an object that may contain BigInt values
 */
export function safeJsonStringify(obj: any): string {
  return JSON.stringify(obj, bigIntReplacer)
}

/**
 * Safely parse JSON that may contain BigInt string representations
 * Note: This doesn't convert strings back to BigInt automatically
 */
export function safeJsonParse(json: string): any {
  return JSON.parse(json)
}

/**
 * Deep clone an object while handling BigInt values
 */
export function safeDeepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any
  }

  if (obj instanceof Array) {
    return obj.map((item) => safeDeepClone(item)) as any
  }

  if (typeof obj === 'bigint') {
    return obj as any
  }

  const cloned: any = {}
  for (const key in obj) {
    if (Object.hasOwn(obj, key)) {
      cloned[key] = safeDeepClone(obj[key])
    }
  }

  return cloned
}

/**
 * Prepare an object for JSON serialization by converting BigInt to string
 */
export function prepareForSerialization(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj === 'bigint') {
    return obj.toString()
  }

  if (obj instanceof Date) {
    return obj.toISOString()
  }

  if (Array.isArray(obj)) {
    return obj.map(prepareForSerialization)
  }

  if (typeof obj === 'object') {
    const prepared: any = {}
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        prepared[key] = prepareForSerialization(obj[key])
      }
    }
    return prepared
  }

  return obj
}
