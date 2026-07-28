// apps/web/src/components/permissions/hooks/use-agent-policy-clamp.test.ts

import { Area, PermissionKey } from '@auxx/lib/permissions/client'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedAgentPolicy } from './use-agent-policy'

/**
 * The §2.4a clamp PREVIEW — "publishing would reduce this policy".
 *
 * The case that matters is the false positive. `Area.auditLog` offers a single
 * rung (`Read`), so an owner composes `Read` there — the ceiling — while the
 * seeded `agent` profile asks for `admin` on the flat four-rung vocabulary.
 * Comparing those two spellings raw told an OWNER their publish would be reduced,
 * for a difference `expandLevelsToKeys` erases: both sides compose to exactly
 * `auditLogView`. The row beside the banner already read the clamped rung, so the
 * screen contradicted itself.
 */

const { held } = vi.hoisted(() => ({ held: { current: [] as string[] } }))

vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({
    capabilities: held.current,
    canViewEntity: () => true,
    canEditEntity: () => true,
    canAdministerDef: () => true,
    isLoading: false,
  }),
}))

import { useAgentPolicyClamp } from './use-agent-policy-clamp'

/** The seeded `agent` system profile as the editor holds it: all-`admin`. */
const ALL_ADMIN = {
  areas: { default: 'admin', overrides: {} },
  definitions: { default: 'admin', overrides: {} },
  resources: {},
} as unknown as NormalizedAgentPolicy

function entriesFor(areas: readonly Area[], capabilities: PermissionKey[]) {
  held.current = capabilities
  return renderHook(() => useAgentPolicyClamp(ALL_ADMIN, areas, [])).result.current.entries
}

describe('the clamp preview on an area whose ladder is shorter than the policy', () => {
  it('reports nothing when the viewer holds the area ceiling', () => {
    // An owner: every key, which on `auditLog` composes to its only rung, `Read`.
    const entries = entriesFor([Area.auditLog], Object.values(PermissionKey))
    expect(entries).toEqual([])
  })

  it('still reports the area when the viewer holds nothing there', () => {
    const entries = entriesFor([Area.auditLog], [])
    expect(entries).toEqual([
      expect.objectContaining({ key: Area.auditLog, from: 'view', to: 'none' }),
    ])
  })

  it('reports a full-ladder area at the rung the viewer actually holds', () => {
    const entries = entriesFor([Area.records], [PermissionKey.recordsView])
    expect(entries).toEqual([
      expect.objectContaining({ key: Area.records, from: 'admin', to: 'view' }),
    ])
  })
})
