// apps/web/src/components/fields/displays/mask-sensitive.ts

/** How many trailing characters a masked value keeps in the clear. */
const VISIBLE_TAIL = 4

/**
 * Mask a sensitive field value down to its last {@link VISIBLE_TAIL}
 * characters - the convention every bank statement and W-9 tool uses, and the
 * shortest form that still lets somebody confirm they are looking at the right
 * record.
 *
 * 🛑 A value of {@link VISIBLE_TAIL} characters or fewer is masked ENTIRELY.
 * Keeping the tail of a four-character value reveals all of it, which is the
 * one case where a "masked" render would be a lie.
 */
export function maskSensitive(value: string): string {
  if (value.length <= VISIBLE_TAIL) return '•'.repeat(value.length)
  return '•'.repeat(value.length - VISIBLE_TAIL) + value.slice(-VISIBLE_TAIL)
}
