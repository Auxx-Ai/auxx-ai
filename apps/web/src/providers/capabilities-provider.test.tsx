// apps/web/src/providers/capabilities-provider.test.tsx

import type { ClientCapabilities } from '@auxx/lib/permissions/client'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 39 §3.1 + §8 — the capability replacement for `useUser({ requireRoles })`.
 *
 * Three assertions carry the plan's safety argument, per gate:
 * an ADMIN is unchanged, a **key-holder now gets in** (the half that does not
 * exist today), and a member at `None` is still bounced.
 *
 * The fourth is the one that is not about any single gate: `can()` returns
 * `false` both when the answer is "denied" AND when there is no snapshot yet.
 * `useUser`'s role guard could not confuse the two — it bailed on `role == null`
 * (`use-user.ts:161`). A capability gate has to bail on `isLoading` or it ejects
 * a legitimate admin mid-org-switch, which is a lockout, not a cosmetic flash.
 */

const h = vi.hoisted(() => ({
  organizationId: 'org_1' as string | null,
  /** `undefined` = the org is absent from dehydrated state (NOT seeded). */
  caps: undefined as ClientCapabilities | undefined,
  /** Realtime refetch result, if any. */
  liveData: undefined as ClientCapabilities | undefined,
  push: vi.fn(),
  pathname: '/app/settings/permissions',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push }),
  usePathname: () => h.pathname,
}))
vi.mock('~/realtime/hooks', () => ({ useRealtimeRoom: () => {} }))
vi.mock('@auxx/lib/realtime/client', () => ({
  rooms: { user: (id: string) => `user:${id}`, orgEvents: (id: string) => `org:${id}` },
}))
vi.mock('~/trpc/react', () => ({
  api: {
    permissions: {
      myCapabilities: { useQuery: () => ({ data: h.liveData, refetch: vi.fn() }) },
    },
  },
}))
vi.mock('~/providers/dehydrated-state-provider', () => ({
  useDehydratedUser: () => ({ id: 'user_1' }),
  useDehydratedOrganization: (orgId: string | null) =>
    orgId && h.caps ? { id: orgId, capabilities: h.caps } : undefined,
}))
vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: () => true }),
  useOrganizationIdContext: () => ({ organizationId: h.organizationId }),
}))

import {
  CapabilitiesProvider,
  useAccess,
  useRequireCapability,
  useRequireEntityEdit,
} from '~/providers/capabilities-provider'

/** A composed snapshot holding exactly `keys` — no instance or def access. */
function caps(keys: string[], role: 'ADMIN' | 'OWNER' | 'USER' = 'USER'): ClientCapabilities {
  return {
    keys: keys as ClientCapabilities['keys'],
    defAccess: {},
    restrictedEntityDefIds: [],
    role,
    seatType: 'full',
  }
}

function Probe({ permissionKey, enabled }: { permissionKey: string; enabled?: boolean }) {
  useRequireCapability(permissionKey, enabled)
  const { isLoading, can } = useAccess()
  return <div data-testid='probe' data-loading={isLoading} data-can={can(permissionKey)} />
}

function renderProbe(permissionKey = 'permissions.manage', enabled?: boolean) {
  return render(
    <CapabilitiesProvider>
      <Probe permissionKey={permissionKey} enabled={enabled} />
    </CapabilitiesProvider>
  )
}

beforeEach(() => {
  h.organizationId = 'org_1'
  h.caps = undefined
  h.liveData = undefined
  h.pathname = '/app/settings/permissions'
  h.push.mockClear()
})

describe('useRequireCapability', () => {
  it('lets an ADMIN through — ROLE_DEFAULTS composes every key, so this is a no-op', () => {
    h.caps = caps(['permissions.manage', 'members.manage', 'settings.manage'], 'ADMIN')
    renderProbe()
    expect(h.push).not.toHaveBeenCalled()
  })

  it('lets a plain member holding the key through — the delegation this plan adds', () => {
    // A member with ONLY `permissions.manage`: no role, no other area. Today
    // `useUser({ requireRoles })` bounces exactly this person, which is what
    // made `Area.permissions` a lever that does nothing (doc 19 §0.25).
    h.caps = caps(['permissions.manage'])
    renderProbe()
    expect(h.push).not.toHaveBeenCalled()
    expect(screen.getByTestId('probe').dataset.can).toBe('true')
  })

  it('redirects a member whose area is None', () => {
    h.caps = caps(['records.view'])
    renderProbe()
    expect(h.push).toHaveBeenCalledWith('/access-denied')
  })

  it('does NOT redirect while capabilities are unseeded', () => {
    // No org in dehydrated state — `can()` is fail-closed here BY DESIGN, so the
    // redirect has to distinguish "denied" from "not known yet". Without the
    // `isLoading` bail-out an admin refreshing mid-org-switch lands on
    // /access-denied for a page they own.
    h.caps = undefined
    renderProbe()
    expect(screen.getByTestId('probe').dataset.loading).toBe('true')
    expect(h.push).not.toHaveBeenCalled()
  })

  it('does not redirect on auth pages', () => {
    h.caps = caps([])
    h.pathname = '/login'
    renderProbe()
    expect(h.push).not.toHaveBeenCalled()
  })

  it('holds the redirect when disabled, so a caller can render its own denial', () => {
    h.caps = caps([])
    renderProbe('permissions.manage', false)
    expect(h.push).not.toHaveBeenCalled()
  })
})

describe('useRequireEntityEdit', () => {
  /**
   * Seed a snapshot with an explicit per-def grant. The def must be RESTRICTED
   * for `defAccess` to be consulted at all — `effectiveRecordLevel` reads the
   * records BASE for unrestricted defs, so an unrestricted def with a `view` row
   * still resolves to the base rung and would not test anything.
   */
  function withDefAccess(permission: 'view' | 'edit') {
    h.caps = {
      ...caps(['records.view', 'records.edit']),
      defAccess: { def_tag: permission },
      restrictedEntityDefIds: ['def_tag'],
    }
  }

  function renderDefProbe(defId: string | undefined = 'def_tag') {
    function DefProbe() {
      useRequireEntityEdit(defId)
      return <div data-testid='probe' />
    }
    return render(
      <CapabilitiesProvider>
        <DefProbe />
      </CapabilitiesProvider>
    )
  }

  it('lets a member who may edit the def through', () => {
    withDefAccess('edit')
    renderDefProbe()
    expect(h.push).not.toHaveBeenCalled()
  })

  it('redirects a member who may only read the def', () => {
    // The tags page writes through `record.create`/`.delete`, so read is not
    // enough — this is the question `assertEditEntity` asks server-side.
    withDefAccess('view')
    renderDefProbe()
    expect(h.push).toHaveBeenCalledWith('/access-denied')
  })

  it('does NOT redirect before the def id resolves', () => {
    // The resource store hydrates async. Treating an unresolved def as "denied"
    // is the same bug as ignoring `isLoading` — it bounces on the first render.
    withDefAccess('edit')
    renderDefProbe(undefined)
    expect(h.push).not.toHaveBeenCalled()
  })
})

describe('CapabilitiesProvider seeding', () => {
  it('reports isLoading only until a snapshot exists', () => {
    h.caps = caps(['permissions.manage'])
    renderProbe()
    expect(screen.getByTestId('probe').dataset.loading).toBe('false')
  })

  it('discards a realtime refetch belonging to the previous org', () => {
    // The refetch resolves against org_1 and grants the key...
    h.caps = caps(['records.view'])
    h.liveData = caps(['permissions.manage'])
    const { rerender } = renderProbe()
    expect(screen.getByTestId('probe').dataset.can).toBe('true')

    // ...then the member switches to an org where they hold nothing. The stale
    // result must not survive the switch and grant access in the new org.
    h.organizationId = 'org_2'
    h.caps = caps(['records.view'])
    h.liveData = undefined
    rerender(
      <CapabilitiesProvider>
        <Probe permissionKey='permissions.manage' />
      </CapabilitiesProvider>
    )
    expect(screen.getByTestId('probe').dataset.can).toBe('false')
  })
})
