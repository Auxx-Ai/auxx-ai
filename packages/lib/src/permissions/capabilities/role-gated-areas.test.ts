// packages/lib/src/permissions/capabilities/role-gated-areas.test.ts
//
// Plan 19 step 10 (§5.3 piece 3) — the anti-rot test for the `AreaMetadata.roleGated` audit.
//
// WHAT THIS PROVES
//   1. The area registry enumerates completely and non-vacuously, so nothing
//      below passes over an empty or half-built `PERMISSION_AREAS`.
//   2. The `roleGated` set is EXACTLY pinned, both ways. An area that gains the
//      flag without being listed here fails; an area whose routers get migrated
//      and drops the flag while still listed here also fails. §5.3 says the flag
//      "drops per-area as routers migrate" — that drop must be a deliberate,
//      reviewed edit, not something a refactor does quietly.
//   3. `roleGated` and `adminOnly` stay INDEPENDENT. They answer opposite
//      questions — `adminOnly` is "may a USER be granted this?" (no), `roleGated`
//      is "can an ADMIN be clamped out of this?" (no) — and `settings` carrying
//      both is exactly the case where a future reader is tempted to collapse one
//      into the other. Pinned so neither set can drift into implying the other.
//   4. A flagged area is a MEANINGFUL one: it still expands to at least one
//      `PermissionKey`, and it is not simultaneously `workerOnly` (which already
//      hides the control, making the lock unobservable and the flag a lie by
//      omission).
//
// WHAT THIS DOES **NOT** PROVE
//   That each flagged area really is fronted by a binary role gate today, or that
//   an unflagged one really is not. The evidence lives in `apps/web/src/server`
//   (`adminProcedure`, bare `isAdminOrOwner`) — a different package, and one this
//   package must not reach into. Grepping router sources from a lib unit test
//   would manufacture confidence rather than earn it: a router can resolve a
//   `CapabilitySet` and never consult it, and the check would break the moment
//   `@auxx/lib` is built without `apps/web` present.
//
//   The honest substitute is the curated pin in (2), backed by the per-area
//   comment in `registry.ts` naming a concrete blocking router. The audit itself
//   is a human claim; this suite's job is to make any change to that claim
//   explicit and reviewable instead of silent. Mirrors the shape of
//   `ai/kopilot/capabilities/__tests__/tool-permission-declarations.test.ts`.

import { describe, expect, it } from 'vitest'
import { AREA_ORDER, Area, expandLevelsToKeys, Level, PERMISSION_AREAS } from './registry'

/**
 * Areas whose enforcement is still decided by a binary role check on at least one
 * load-bearing router — `adminProcedure` or a bare `isAdminOrOwner`, with no
 * assert of one of the area's own `PermissionKey`s (doc 19 §5.3 piece 3).
 *
 * Each entry's justification, naming the concrete blocking router, lives on the
 * area in `registry.ts` — keep the two in sync.
 *
 * TO ADD an entry you must be adding an area whose routers are not
 * capability-driven; name the blocking gate in the registry comment.
 * TO REMOVE one, migrate its routers to `permissionProcedure` (or an equivalent
 * capability assert), drop `roleGated` from the registry, and delete the line
 * here. The test fails if you do either half without the other.
 */
const ROLE_GATED: readonly Area[] = [
  // `workflow.ts` never reads `workflows.manage` — the key has no server-side
  // enforcement at all. Worse than role-gated; §11.5 must close it, not migrate it.
  Area.workflows,
  // `agent.ts` is migrated, but `agent-toolset` / `agent-trigger` / `agent-scope` /
  // `agent-procedure` / `procedure` / `eval` are all still `adminProcedure`.
  Area.agents,
  // `availability.ts` is bare `adminProcedure`; so are the invoice / work-order
  // pre-delete guards on the board's own record faces.
  Area.dispatchBoard,
  // `setting.ts` + `organization.ts:update` are bare `isAdminOrOwner`;
  // `settings.manage` has zero enforcement sites.
  Area.settings,
  // The app CONNECTION lifecycle in `apps.ts` (plus `apiKey.ts` chat keys) gates on
  // `isAdminOrOwner`, never on `integrations.manage`.
  Area.integrations,
]

/**
 * Areas never grantable below ADMIN (the USER baseline is forced to `None`).
 * Pinned alongside {@link ROLE_GATED} purely to hold the two apart — this is a
 * DIFFERENT question, and the overlap is a coincidence of `settings`, not a rule.
 */
const ADMIN_ONLY: readonly Area[] = [Area.settings]

const sorted = (areas: readonly Area[]) => [...areas].sort()

const areasWhere = (predicate: (area: Area) => boolean) => AREA_ORDER.filter(predicate).sort()

describe('AreaMetadata.roleGated — registry enumeration (doc 19 §5.3)', () => {
  it('enumerates the full area surface', () => {
    // Guards against a truncated registry making every assertion below vacuous.
    expect(AREA_ORDER.length).toBeGreaterThanOrEqual(21)
    expect(new Set(AREA_ORDER).size).toBe(AREA_ORDER.length)
    for (const area of AREA_ORDER) {
      expect(PERMISSION_AREAS[area]?.area, area).toBe(area)
    }
  })

  it('pins the roleGated set EXACTLY — an area cannot silently gain or lose it', () => {
    expect(areasWhere((area) => PERMISSION_AREAS[area].roleGated === true)).toEqual(
      sorted(ROLE_GATED)
    )
  })

  it('roleGated is only ever set to true, so the pin above is total', () => {
    // `roleGated: false` would be indistinguishable from "audited and clean" while
    // reading as a deliberate statement; absence is the only way to say "not gated".
    for (const area of AREA_ORDER) {
      const { roleGated } = PERMISSION_AREAS[area]
      expect(roleGated === undefined || roleGated === true, area).toBe(true)
    }
  })

  it('keeps roleGated and adminOnly independent — neither flag implies the other', () => {
    expect(areasWhere((area) => PERMISSION_AREAS[area].adminOnly === true)).toEqual(
      sorted(ADMIN_ONLY)
    )

    const roleGatedSet = new Set(ROLE_GATED)
    const adminOnlySet = new Set(ADMIN_ONLY)

    // roleGated ⊄ adminOnly: locking an admin out of authoring is not the same as
    // withholding the area from members.
    expect(ROLE_GATED.filter((area) => !adminOnlySet.has(area)).length).toBeGreaterThan(0)
    // The one overlap is `settings`, and it is deliberate — both flags, independently earned.
    expect(sorted(ADMIN_ONLY.filter((area) => roleGatedSet.has(area)))).toEqual([Area.settings])
  })

  it('only flags areas where a lock is meaningful', () => {
    for (const area of ROLE_GATED) {
      const meta = PERMISSION_AREAS[area]
      // An area with no keys has nothing to gate, so the flag would be noise.
      expect(expandLevelsToKeys({ [area]: Level.Full }).length, area).toBeGreaterThan(0)
      // `workerOnly` already hides the control; flagging it would lock nothing a
      // user can see (see `leveled-area-grid.tsx`'s AREA_GROUPS filter).
      expect(meta.workerOnly, area).not.toBe(true)
    }
  })

  it('leaves the areas the audit cleared unflagged', () => {
    // Sanity anchors from doc 19: `permissions` moved off `adminProcedure` onto a
    // `permissionsManage` assert (§0.25), and `members` runs every write through
    // `requireMemberManage`. If either regains a binary gate, the audit is stale.
    expect(PERMISSION_AREAS[Area.permissions].roleGated).toBeUndefined()
    expect(PERMISSION_AREAS[Area.members].roleGated).toBeUndefined()
  })
})
