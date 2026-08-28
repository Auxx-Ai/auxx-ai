// packages/database/src/tests/gl-role-assignment-schema.test.ts
//
// Structural guard for the role -> account mapping (decision G19).
//
// The table exists for ONE line — `uniqueIndex(organizationId, role)` — and the
// direction of that index is the whole design. `G19` needs a role to resolve to
// exactly one account (required, enforced) while an account may serve many roles
// (permitted, ordinary — an org that runs DTC and dealer revenue through one
// account). The two shapes that were rejected each get the direction wrong:
//
//  - `gl_account.role` as a `unique: true` SINGLE_SELECT enforces the constraint
//    AND its converse, so it rejects the exact case `G19` names.
//  - `gl_account.roles` as a MULTI_SELECT cannot express it at all: "each role
//    appears on at most one account" is set-membership uniqueness ACROSS rows,
//    and `FieldValue` carries exactly two unique indexes — the PK and
//    `(entityId, fieldId, sortKey)`. Decision `G6`'s argument verbatim.
//
// So these pin the index, its direction, and the deliberate ABSENCE of a foreign
// key on `glAccountId`.

import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { GlRoleAssignment as FromBarrel } from '../db/schema'
import { GlRoleAssignment } from '../db/schema/gl-role-assignment'

const config = getTableConfig(GlRoleAssignment)
const columnNames = config.columns.map((c) => c.name)

describe('GlRoleAssignment', () => {
  it('is exported from the schema barrel, so `schema.GlRoleAssignment` resolves', () => {
    expect(FromBarrel).toBe(GlRoleAssignment)
    expect(config.name).toBe('GlRoleAssignment')
  })

  // ── THE CONSTRAINT ────────────────────────────────────────────────────────
  it('claims (organizationId, role) uniquely — one role, one account, per org', () => {
    const unique = config.indexes.find((i) => i.config.unique)
    expect(unique?.config.name).toBe('GlRoleAssignment_org_role_key')
    expect(unique?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual([
      'organizationId',
      'role',
    ])
  })

  // 🛑 The converse must NOT be constrained. An index on (organizationId,
  // glAccountId) that were unique would reject an org combining two roles onto
  // one account — the exact case `G19` names as ordinary.
  it('does NOT constrain (organizationId, glAccountId) — an account may serve many roles', () => {
    const byAccount = config.indexes.find(
      (i) => i.config.name === 'GlRoleAssignment_org_account_idx'
    )
    expect(byAccount).toBeDefined()
    expect(byAccount?.config.unique).toBeFalsy()
  })

  // ── NO FOREIGN KEY ON glAccountId ─────────────────────────────────────────
  // The same call `GlPostingLine.accountCode` makes. `cascade` would destroy an
  // org's posting configuration silently the moment somebody deleted an account;
  // `restrict` would block a bookkeeper archiving one behind an error message
  // that cannot explain itself. `resolveRoles` validates existence, active
  // status and type compatibility on every read and fails closed — which `G19`
  // requires anyway — so an FK buys nothing the validation does not already do.
  it('names the gl_account by instance id with no foreign key', () => {
    const account = config.columns.find((c) => c.name === 'glAccountId')
    expect(account?.getSQLType()).toBe('text')
    expect(account?.notNull).toBe(true)

    const fkColumns = config.foreignKeys.flatMap((fk) => fk.reference().columns.map((c) => c.name))
    expect(fkColumns).not.toContain('glAccountId')
    // Only the org (cascade) and the confirming user (set null) are keyed.
    expect(fkColumns.sort()).toEqual(['confirmedByUserId', 'organizationId'])
  })

  // Plain `text`, not a pgEnum: the role vocabulary is `ACCOUNT_ROLES` in
  // `packages/lib/src/postings/build-entry.ts`, and a second copy is the thing
  // that drifts. `GlPostingLine.accountRole` made the same call.
  it('stores the role as plain text, never redefining the vocabulary', () => {
    const role = config.columns.find((c) => c.name === 'role')
    expect(role?.getSQLType()).toBe('text')
    expect(role?.notNull).toBe(true)
    // Not backed by a pgEnum: a pgEnum column reports `enumValues`.
    expect((role as { enumValues?: string[] } | undefined)?.enumValues).toBeUndefined()
  })

  // `G19` leans on the difference between a suggestion and a confirmation — the
  // wizard renders "we chose this for you" differently from "you chose this" —
  // and on "marked unused" being different from "never looked at", which is what
  // an ABSENT row means.
  it('carries the provenance and the marked-unused flag `G19` depends on', () => {
    expect(columnNames).toEqual(
      expect.arrayContaining([
        'source',
        'confirmedAt',
        'confirmedByUserId',
        'markedUnused',
        'createdAt',
        'updatedAt',
      ])
    )
    const source = config.columns.find((c) => c.name === 'source')
    expect(source?.notNull).toBe(true)

    // Defaulted and NOT NULL: a null here would be a third state between "in
    // use" and "explicitly unused", which nothing knows how to read.
    const unused = config.columns.find((c) => c.name === 'markedUnused')
    expect(unused?.getSQLType()).toBe('boolean')
    expect(unused?.notNull).toBe(true)
    expect(unused?.hasDefault).toBe(true)
  })

  // Unlike `GlPostingLine`, this table IS mutable — a mapping is configuration,
  // not ledger history, and repointing a role is an ordinary thing to do.
  it('is updatable, because a mapping is configuration rather than ledger history', () => {
    expect(columnNames).toContain('updatedAt')
  })
})
