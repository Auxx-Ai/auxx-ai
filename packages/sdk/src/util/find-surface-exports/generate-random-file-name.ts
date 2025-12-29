/**
 * Generates a random file name with the specified extension.
 *
 * This function creates a random alphanumeric string using base-36 encoding
 * and appends the provided file extension. Useful for creating temporary or
 * unique file names that need to avoid collisions.
 *
 * @param extension - The file extension to append (without the leading dot)
 * @returns A random file name in the format `{randomString}.{extension}`
 *
 * @example
 * ```typescript
 * generateRandomFileName('ts') // Returns something like 'k8j3h2.ts'
 * generateRandomFileName('json') // Returns something like 'x9m4n1.json'
 * ```
 */
export function generateRandomFileName(extension: string) {
  return `${Math.random().toString(36).slice(2)}.${extension}`
}
