// packages/sdk/src/util/to-camel-case.ts

/**
 * Normalizes a string to lower camel case by stripping non-alphanumeric
 * separators and capitalizing subsequent word segments.
 *
 * @param input Arbitrary text that may contain separators like spaces, hyphens, or underscores.
 * @returns The camel-cased string with the initial segment lowercased.
 *
 * @example
 * ```ts
 * toCamelCase('user-profile');
 * // => 'userProfile'
 *
 * toCamelCase('Customer Name');
 * // => 'customerName'
 *
 * toCamelCase('api__response__code');
 * // => 'apiResponseCode'
 * ```
 */
export function toCamelCase(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word, index) => {
      if (index === 0) {
        return word.toLowerCase()
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join('')
}
