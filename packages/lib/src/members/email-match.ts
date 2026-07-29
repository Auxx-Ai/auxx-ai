// packages/lib/src/members/email-match.ts

import { type SQL, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * Canonical form of an email used as a matching key.
 *
 * `User.email` is normalized to lowercase by better-auth on signup, but
 * `OrganizationInvitation.email` is stored exactly as the inviting admin typed
 * it. Comparing the two raw makes `Foo@bar.com` and `foo@bar.com` read as two
 * different people, which strands the invitee: the invite is never matched at
 * signup, so they silently get a throwaway organization instead of joining.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Case-insensitive equality against an email column.
 *
 * Deliberately `lower(col) = <normalized>` rather than `ilike`: the value is
 * user-supplied, and `ilike` would treat any `%` or `_` inside it as a
 * wildcard — turning a lookup for one address into a pattern match over many.
 */
export function emailEquals(column: PgColumn, email: string): SQL {
  return sql`lower(${column}) = ${normalizeEmail(email)}`
}
