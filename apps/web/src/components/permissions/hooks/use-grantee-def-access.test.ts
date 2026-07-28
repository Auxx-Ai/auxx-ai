// apps/web/src/components/permissions/hooks/use-grantee-def-access.test.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { Area, Level } from '@auxx/lib/permissions/client'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 31 §2.4, phase 2's **def half** — this hook reads ONE grantee.
 *
 * It used to run `resourceAccess.allTypeAccess`: every type-level row for every
 * grantee in the org, narrowed client-side with two filters. That query was
 * properly gated (`isAdminOrOwner`), so this was never an authorization fix — it
 * is the SHAPE finding. Having the org's whole access table in a member page's
 * query cache is what made the §2.1 scope leak buildable, and is what the next
 * row would have reached for. `allTypeAccess` itself survives for the Workspace
 * defaults tab, which is org-wide by definition.
 *
 * What that leaves worth testing is the two things a swap like this breaks:
 * that the rows are still derived from the right halves of the new payload
 * (`own.defs` for the grantee's grant, `baseline.defs` for the workspace
 * default), and that the optimistic write still lands — on `own`/`baseline`,
 * which the server stores verbatim, and NEVER on `effective`, which is composed.
 */

const {
  granteeAccessQuery,
  roleDefaultsQuery,
  granteeAccessSetData,
  granteeAccessInvalidate,
  resourceAccessInvalidate,
  grantTypeMutate,
  revokeTypeMutate,
  resources,
} = vi.hoisted(() => ({
  granteeAccessQuery: vi.fn(),
  roleDefaultsQuery: vi.fn(),
  granteeAccessSetData: vi.fn(),
  granteeAccessInvalidate: vi.fn(),
  resourceAccessInvalidate: vi.fn(),
  grantTypeMutate: vi.fn(),
  revokeTypeMutate: vi.fn(),
  resources: { current: [] as unknown[] },
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      permissions: {
        granteeAccess: { setData: granteeAccessSetData, invalidate: granteeAccessInvalidate },
      },
      resourceAccess: { invalidate: resourceAccessInvalidate },
    }),
    permissions: {
      granteeAccess: { useQuery: granteeAccessQuery },
      roleDefaults: { useQuery: roleDefaultsQuery },
    },
    resourceAccess: {
      grantType: { useMutation: () => ({ mutate: grantTypeMutate }) },
      revokeType: { useMutation: () => ({ mutate: revokeTypeMutate }) },
    },
  },
}))

vi.mock('~/components/resources/hooks', () => ({
  useResources: () => ({ resources: resources.current, isLoading: false }),
}))

const { useGranteeDefAccess } = await import('./use-grantee-def-access')

const USER = 'usr_alice'
const TICKET = 'edef_ticket'
const CONTACT = 'edef_contact'

/** Two record-type resources, both access-manageable. */
const RESOURCES = [
  {
    id: 'ticket',
    apiSlug: 'tickets',
    entityType: 'ticket',
    entityDefinitionId: TICKET,
    plural: 'Tickets',
    label: 'Ticket',
  },
  {
    id: 'contact',
    apiSlug: 'contacts',
    entityType: 'contact',
    entityDefinitionId: CONTACT,
    plural: 'Contacts',
    label: 'Contact',
  },
]

/** `ROLE_DEFAULTS.USER` — the all-`None` floor, trimmed to what these read. */
const ROLE_DEFAULTS = { [Area.records]: Level.None }

interface Payload {
  own: { areas: Record<string, Level>; defs: Record<string, ResourcePermission> }
  baseline: { areas: Record<string, Level>; defs: Record<string, ResourcePermission> }
  effective: { areas: Record<string, Level>; defs: Record<string, ResourcePermission | null> }
}

function payload(overrides: Partial<Payload> = {}): Payload {
  return {
    own: { areas: {}, defs: {}, ...overrides.own },
    baseline: { areas: {}, defs: {}, ...overrides.baseline },
    effective: { areas: {}, defs: {}, ...overrides.effective },
  }
}

function setup(data: Payload, granteeKind: 'user' | 'group' = 'user') {
  granteeAccessQuery.mockReturnValue({ data, isLoading: false })
  roleDefaultsQuery.mockReturnValue({ data: ROLE_DEFAULTS, isLoading: false })
  resources.current = RESOURCES
  return renderHook(() => useGranteeDefAccess(granteeKind, USER)).result
}

/** Run the last `setData` updater over `prev` and return what it produced. */
function patched(prev: Payload) {
  const call = granteeAccessSetData.mock.calls.at(-1)
  const updater = call?.[1] as (p: Payload) => Payload
  return { input: call?.[0], next: updater(prev) }
}

beforeEach(() => {
  for (const fn of [
    granteeAccessQuery,
    roleDefaultsQuery,
    granteeAccessSetData,
    granteeAccessInvalidate,
    resourceAccessInvalidate,
    grantTypeMutate,
    revokeTypeMutate,
  ]) {
    fn.mockReset()
  }
})

describe('rows are derived from the grantee-scoped payload', () => {
  it("reads this grantee's grant from own.defs and the default from baseline.defs", () => {
    const result = setup(
      payload({
        own: { areas: {}, defs: { [TICKET]: ResourcePermission.edit } },
        baseline: { areas: {}, defs: { [TICKET]: ResourcePermission.view } },
      })
    )

    const ticket = result.current.rows.find((r) => r.resource.entityDefinitionId === TICKET)
    expect(ticket?.grantLevel).toBe(ResourcePermission.edit)
    expect(ticket?.baselineLevel).toBe(ResourcePermission.view)
    // Configured def → Inherit resolves to its workspace baseline, not the area.
    expect(ticket?.inheritedLevel).toBe(ResourcePermission.view)
  })

  it('leaves an unconfigured def with no grant and no baseline row', () => {
    const result = setup(payload())

    const contact = result.current.rows.find((r) => r.resource.entityDefinitionId === CONTACT)
    expect(contact?.grantLevel).toBeUndefined()
    // Records is `None` on both the role floor and the member profile.
    expect(contact?.baselineLevel).toBe(ResourcePermission.none)
    expect(contact?.isLockedDown).toBe(true)
  })

  it("falls the Inherit value through to the grantee's OWN area level", () => {
    const result = setup(
      payload({
        own: { areas: { [Area.records]: Level.Full }, defs: {} },
        baseline: { areas: { [Area.records]: Level.Read }, defs: {} },
      })
    )

    const contact = result.current.rows.find((r) => r.resource.entityDefinitionId === CONTACT)
    // The grantee's raise decides what they inherit — `edit`, not `admin`:
    // `levelToRecordBasePermission` caps at Edit because a record type has no
    // `admin` BASE, only a per-record grant.
    expect(contact?.inheritedLevel).toBe(ResourcePermission.edit)
    // ...while the workspace baseline is what everyone else gets.
    expect(contact?.baselineLevel).toBe(ResourcePermission.view)
  })

  it('flags a grant that lifts nothing above the baseline', () => {
    const result = setup(
      payload({
        own: { areas: {}, defs: { [TICKET]: ResourcePermission.view } },
        baseline: { areas: {}, defs: { [TICKET]: ResourcePermission.view } },
      })
    )

    expect(
      result.current.rows.find((r) => r.resource.entityDefinitionId === TICKET)?.isNoEffect
    ).toBe(true)
  })
})

describe('writes patch own/baseline optimistically and never effective', () => {
  const prev = payload({
    own: { areas: {}, defs: { [CONTACT]: ResourcePermission.view } },
    baseline: { areas: {}, defs: { [TICKET]: ResourcePermission.view } },
  })

  it("writes the new permission onto own.defs, addressed to this grantee's key", () => {
    const result = setup(
      payload({ baseline: { areas: {}, defs: { [TICKET]: ResourcePermission.view } } })
    )

    result.current.setLevel(TICKET, ResourcePermission.edit)

    const { input, next } = patched(prev)
    expect(input).toEqual({ granteeType: 'user', granteeId: USER })
    expect(next.own.defs[TICKET]).toBe(ResourcePermission.edit)
    // The grantee's OTHER defs survive — the patch upserts one key, it does not
    // rebuild the map from somewhere else.
    expect(next.own.defs[CONTACT]).toBe(ResourcePermission.view)
    expect(grantTypeMutate).toHaveBeenCalledWith({
      entityDefinitionId: TICKET,
      granteeType: ResourceGranteeType.user,
      granteeId: USER,
      permission: ResourcePermission.edit,
    })
  })

  it('leaves effective alone — it is composed, and the invalidation owns it', () => {
    const result = setup(
      payload({ baseline: { areas: {}, defs: { [TICKET]: ResourcePermission.view } } })
    )

    result.current.setLevel(TICKET, ResourcePermission.edit)

    expect(patched(prev).next.effective).toBe(prev.effective)
  })

  it('drops the row from own.defs on Inherit, and revokes', () => {
    const result = setup(
      payload({ own: { areas: {}, defs: { [CONTACT]: ResourcePermission.view } } })
    )

    result.current.setLevel(CONTACT, 'inherit')

    expect(patched(prev).next.own.defs).toEqual({})
    expect(revokeTypeMutate).toHaveBeenCalledWith({
      entityDefinitionId: CONTACT,
      granteeType: ResourceGranteeType.user,
      granteeId: USER,
    })
  })

  /**
   * The first-touch rule is correctness, not polish: raising one grantee on a
   * def with no baseline row would otherwise make that def restricted and lock
   * every other member out. The baseline write has to be patched too, or the row
   * re-renders as "Restricted" for the moment before the refetch lands.
   */
  it('writes and patches the workspace baseline on first touch', () => {
    const result = setup(payload({ own: { areas: { [Area.records]: Level.Full }, defs: {} } }))

    result.current.setLevel(CONTACT, ResourcePermission.admin)

    // Two `grantType` calls: the baseline first, then the grantee's own row.
    expect(grantTypeMutate).toHaveBeenNthCalledWith(1, {
      entityDefinitionId: CONTACT,
      granteeType: ResourceGranteeType.role,
      granteeId: 'org_member',
      permission: ResourcePermission.none,
    })
    expect(grantTypeMutate).toHaveBeenNthCalledWith(2, {
      entityDefinitionId: CONTACT,
      granteeType: ResourceGranteeType.user,
      granteeId: USER,
      permission: ResourcePermission.admin,
    })

    // Both patches ran against the same key, baseline before own.
    const baselinePatch = granteeAccessSetData.mock.calls.at(-2)?.[1] as (p: Payload) => Payload
    expect(baselinePatch(prev).baseline.defs[CONTACT]).toBe(ResourcePermission.none)
    expect(patched(prev).next.own.defs[CONTACT]).toBe(ResourcePermission.admin)
  })

  it('does NOT re-write the baseline when the def already has one', () => {
    const result = setup(
      payload({ baseline: { areas: {}, defs: { [TICKET]: ResourcePermission.view } } })
    )

    result.current.setLevel(TICKET, ResourcePermission.admin)

    expect(grantTypeMutate).toHaveBeenCalledTimes(1)
    expect(grantTypeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ granteeType: ResourceGranteeType.user })
    )
  })

  it('does not touch the cache when the grantee page is not mounted', () => {
    const result = setup(
      payload({ baseline: { areas: {}, defs: { [TICKET]: ResourcePermission.view } } })
    )

    result.current.setLevel(TICKET, ResourcePermission.edit)

    const updater = granteeAccessSetData.mock.calls.at(-1)?.[1] as (p: unknown) => unknown
    expect(updater(undefined)).toBeUndefined()
  })
})

describe('a profile grantee takes its area levels from the live draft', () => {
  /**
   * A profile's def override is authored directly ON the profile being edited,
   * so its Inherit fall-through is the editor's unsaved draft — never the
   * persisted `own.areas` the endpoint returns for it.
   */
  it('prefers profileOwnLevels over the persisted own.areas', () => {
    granteeAccessQuery.mockReturnValue({
      data: payload({ own: { areas: { [Area.records]: Level.None }, defs: {} } }),
      isLoading: false,
    })
    roleDefaultsQuery.mockReturnValue({ data: ROLE_DEFAULTS, isLoading: false })
    resources.current = RESOURCES

    const { result } = renderHook(() =>
      useGranteeDefAccess('profile', 'pprf_1', {
        levels: { [Area.records]: Level.Full },
        baseLevel: null,
      })
    )

    const contact = result.current.rows.find((r) => r.resource.entityDefinitionId === CONTACT)
    // The draft's Full, mapped to the record base vocabulary...
    expect(contact?.inheritedLevel).toBe(ResourcePermission.edit)
    // ...and NOT the persisted `None` the endpoint returned for this profile.
    expect(contact?.inheritedLevel).not.toBe(ResourcePermission.none)
  })
})
