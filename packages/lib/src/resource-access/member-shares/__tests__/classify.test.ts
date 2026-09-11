// packages/lib/src/resource-access/member-shares/__tests__/classify.test.ts

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  groupKeyForDef,
  isOwnerRow,
  MEMBER_SHARE_GROUPS,
  NEVER_OWNED_DEFS,
  SELF_GRANTING_DEFS,
} from '../classify'

/**
 * Plan 46 §3.2 — the owner/share classifier.
 *
 * 96% of the `granteeType: 'user'` rows in the dev database are the member's own
 * property, self-granted by the resource's creation path. A literal "delete every
 * row where granteeId = X" deletes the member's own snippets, dashboards,
 * signature and personal mailbox, so this predicate is the whole safety argument
 * for the feature — not the UI that reads it.
 */

const MEMBER = 'u_member'
const ADMIN = 'u_admin'

const row = (over: Partial<Parameters<typeof isOwnerRow>[0]> = {}) => ({
  granteeId: MEMBER,
  grantedById: MEMBER,
  entityDefinitionId: 'snippet',
  ...over,
})

describe('isOwnerRow — the matrix', () => {
  it('treats a self-granted row as owned', () => {
    expect(isOwnerRow(row({ grantedById: MEMBER }))).toBe(true)
  })

  it('treats an admin-granted row as a share', () => {
    expect(isOwnerRow(row({ grantedById: ADMIN }))).toBe(false)
  })

  it.each([
    ...SELF_GRANTING_DEFS,
  ])('treats a NULL granter on the self-granting def %s as owned', (def) => {
    expect(isOwnerRow(row({ grantedById: null, entityDefinitionId: def }))).toBe(true)
  })

  it.each([
    'thread',
    'contact',
    'dataset',
    'kb',
    'workflow',
    'agent',
    'clx_some_record_def',
  ])('treats a NULL granter on %s as a share', (def) => {
    expect(isOwnerRow(row({ grantedById: null, entityDefinitionId: def }))).toBe(false)
  })

  /**
   * The direction of error is the point. A share misread as ownership is
   * recoverable (the row survives; an admin revokes it from the resource's own
   * share card). Ownership misread as a share is not — the member loses their own
   * dashboard. So the NULL-granter case must land on "owned" for exactly the defs
   * whose creation path self-grants, and the naive
   * `grantedById !== null && grantedById === granteeId` rule gets that backwards.
   */
  it('errs toward owned rather than shared for a null granter on a self-granting def', () => {
    const naive = (r: ReturnType<typeof row>) =>
      r.grantedById !== null && r.grantedById === r.granteeId
    const dashboard = row({ grantedById: null, entityDefinitionId: 'dashboard' })
    expect(naive(dashboard)).toBe(false)
    expect(isOwnerRow(dashboard)).toBe(true)
  })

  it.each([
    MEMBER,
    ADMIN,
    null,
  ])('treats personal_inbox as owned under granter %s, unconditionally', (grantedById) => {
    expect(isOwnerRow(row({ grantedById, entityDefinitionId: 'personal_inbox' }))).toBe(true)
  })

  /*
   * The `inbox` / `personal_inbox` pair is the whole point of NEVER_OWNED_DEFS,
   * and the two rows below differ ONLY in the def.
   *
   * A SHARED mailbox is not personal property. Its rows are self-granted at
   * `admin` by provisioning, so the plain self-grant rule called it owned and
   * the sweep left it — which is how a member on a profile with `inboxes: None`
   * went on reading a shared inbox after every visible share had been removed,
   * with nothing on the tab explaining why.
   */
  it.each([
    MEMBER,
    ADMIN,
    null,
  ])('treats a SHARED inbox as a share under granter %s, even self-granted', (grantedById) => {
    expect(isOwnerRow(row({ grantedById, entityDefinitionId: 'inbox' }))).toBe(false)
  })
})

describe('groupKeyForDef', () => {
  it.each([
    'thread',
    'inbox',
    'personal_inbox',
    'contact',
    'snippet',
    'dashboard',
    'agent',
  ])('maps the reserved slug %s to its own group', (slug) => {
    expect(groupKeyForDef(slug)).toBe(slug)
  })

  it('maps an EntityDefinition CUID to the record group', () => {
    expect(groupKeyForDef('clx0000000000000000000000')).toBe('record')
  })

  it('has copy for every group key it can produce', () => {
    for (const key of Object.keys(MEMBER_SHARE_GROUPS)) {
      const meta = MEMBER_SHARE_GROUPS[key as keyof typeof MEMBER_SHARE_GROUPS]
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.noun.length).toBeGreaterThan(0)
    }
  })

  it('names a removal path for every group that can hold OWNED rows', () => {
    for (const def of SELF_GRANTING_DEFS) {
      expect(MEMBER_SHARE_GROUPS[groupKeyForDef(def)].ownedRemoval).toBeTruthy()
    }
    expect(MEMBER_SHARE_GROUPS.personal_inbox.ownedRemoval).toBeTruthy()
  })

  it('carries the load-bearing contact description (§5.3)', () => {
    expect(MEMBER_SHARE_GROUPS.contact.description).toMatch(/every conversation/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE ENUMERATION TEST (§3.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every place in `packages/lib/src` that WRITES a `ResourceAccess` row, and
 * whether that write self-grants the acting user.
 *
 * This exists so a NEW self-granting creation path fails a test rather than
 * quietly getting its rows swept: `SELF_GRANTING_DEFS` is what makes a
 * NULL-`grantedById` row read as the member's own property, and a new resource
 * whose creator grant is added without touching that set would have its rows
 * classified as shares the first time a granter goes missing.
 *
 * Adding a write site? Decide which bucket it is in, add it here, and — if it
 * self-grants on a reserved slug — add the slug to `SELF_GRANTING_DEFS`.
 *
 * `'<cuid>'` marks a def in the `EntityDefinition` CUID keyspace. Those never
 * need a `SELF_GRANTING_DEFS` entry: the fallback only applies when
 * `grantedById IS NULL`, and no CUID-def write path has ever omitted the granter.
 */
const RESOURCE_ACCESS_WRITE_SITES: Record<string, { selfGrantsDefs: string[] }> = {
  // The three generic write funnels — they write whatever the caller asks for.
  'resource-access/resource-access-service.ts': { selfGrantsDefs: [] },
  // Creation paths that grant the creator `admin` on the thing they just made.
  'snippets/snippet-mutations.ts': { selfGrantsDefs: ['snippet'] },
  'sequences/access.ts': { selfGrantsDefs: ['sequence'] },
  'dashboards/dashboard-mutations.ts': { selfGrantsDefs: ['dashboard'] },
  'groups/group-functions.ts': { selfGrantsDefs: ['<cuid>'] },
  'seed/user-seeder.ts': { selfGrantsDefs: ['inbox', 'signature'] },
  // Third-party grants only — never a self-grant.
  'groups/permission-functions.ts': { selfGrantsDefs: [] },
  'inboxes/inbox-floor.ts': { selfGrantsDefs: [] },
  'approval-requests/access-request-mutations.ts': { selfGrantsDefs: [] },
  'approval-requests/record-access-request-mutations.ts': { selfGrantsDefs: [] },
}

const SRC = path.resolve(__dirname, '../../..')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      yield* walk(full)
      continue
    }
    if (!entry.name.endsWith('.ts')) continue
    if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue
    yield full
  }
}

function findWriteSites(): string[] {
  const hits: string[] = []
  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8')
    const writesDirectly = /\.insert\(\s*schema\.ResourceAccess\s*\)/.test(source)
    const grantsThroughFunnel =
      /(?<!function )grantInstanceAccess\(/.test(source) &&
      !file.endsWith('resource-access-service.ts')
    if (writesDirectly || grantsThroughFunnel) {
      hits.push(path.relative(SRC, file).split(path.sep).join('/'))
    }
  }
  // The member-shares mutation only DELETES rows.
  return hits.filter((f) => !f.startsWith('resource-access/member-shares/')).sort()
}

describe('SELF_GRANTING_DEFS enumerates the creation paths (§3.2)', () => {
  it('knows every ResourceAccess write site in packages/lib/src', () => {
    expect(findWriteSites()).toEqual(Object.keys(RESOURCE_ACCESS_WRITE_SITES).sort())
  })

  /*
   * "Self-granting" and "owned" are two different questions, and conflating them
   * was a real bug: `inbox` self-grants at provisioning, which put it in
   * SELF_GRANTING_DEFS and therefore made a shared team mailbox untouchable by
   * the sweep. A member on a profile with `inboxes: None` kept reading a shared
   * inbox after every visible share was removed.
   *
   * So a self-granting def must be ACCOUNTED FOR by one of the two sets, never
   * silently absent from both — but which one is a judgment about whether the
   * resource is personal property.
   */
  it('accounts for every self-granting reserved slug in one of the two sets', () => {
    const declared = new Set(
      Object.values(RESOURCE_ACCESS_WRITE_SITES)
        .flatMap((site) => site.selfGrantsDefs)
        .filter((def) => def !== '<cuid>')
    )
    for (const def of declared) {
      expect(
        SELF_GRANTING_DEFS.has(def) || NEVER_OWNED_DEFS.has(def) || def === 'personal_inbox',
        `${def} self-grants but is in neither SELF_GRANTING_DEFS nor NEVER_OWNED_DEFS — decide whether it is the member's own property`
      ).toBe(true)
    }
  })

  it('never puts a def in both sets', () => {
    for (const def of NEVER_OWNED_DEFS) {
      expect(SELF_GRANTING_DEFS.has(def)).toBe(false)
    }
  })

  it('does not carry a def no creation path self-grants', () => {
    const declared = new Set(
      Object.values(RESOURCE_ACCESS_WRITE_SITES).flatMap((site) => site.selfGrantsDefs)
    )
    for (const def of SELF_GRANTING_DEFS) {
      expect(declared.has(def)).toBe(true)
    }
  })
})
