// packages/lib/src/ai/kopilot/capabilities/entities/tools/__tests__/bulk-update-entity-capabilities.test.ts
//
// Plan v3/03 §5.3 — `bulk_update_entity` bypasses `UnifiedCrudHandler` and
// writes straight through `FieldValueService`, so it carries its OWN copy of the
// write gate. That copy used to be a def-only loop (`assertEditEntity` per
// DISTINCT def) and is now the same per-ROW gate the handler calls, so these
// tests assert the gate's four properties end-to-end through the tool:
//
//   1. the def gate is the fast path — an all-def-editable batch reads no rows;
//   2. only def-DENIED ids are stamped, and a row shared at `edit` IS writable;
//   3. a missing row or a missing stamp DENIES, and the batch fails WHOLE;
//   4. absent capabilities ⇒ unrestricted, byte-for-byte as before.
//
// The stamped read is scripted with a GRANT RANK rather than a canned `_access`
// string wherever the fold matters, because that is what the picker actually
// hands `recordAccessAt` (`record-picker-service.ts` — `caps.recordAccessAt(
// scopeKey, grantRank)`); it is also the only way the agent case below can say
// anything true, since `AgentPolicyCapabilities` DISCARDS the grant half.

import type { Rung } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const applyBulkSpy = vi.fn()
/** Stands in for `RecordPickerService.getResourcesByIds` — the `_access` read. */
const stampedRead = vi.fn<(ids: string[]) => Promise<Record<string, { _access?: Rung }>>>()

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  // `null` ⇒ the tool skips field-key validation and actor resolution, which
  // keeps this test focused on the capability gate.
  findCachedResource: vi.fn(async () => null),
  // Feeds `buildDefIdToSlug`, which the tool now passes to the per-row gate
  // (plan v3/06 §7.2 — `ALWAYS_PER_ROW_DEF_SLUGS` is slug-keyed while an agent's
  // `recordIds` carry def CUIDs). Empty is honest here: `buildDefIdToSlug([])`
  // is the identity resolver, and neither def in this file is in the carve-out,
  // so every assertion below still describes the def gate and the stamp.
  getCachedResources: vi.fn(async () => []),
}))

vi.mock('../../../../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    async applyBulk(args: unknown) {
      return applyBulkSpy(args)
    }
  },
}))

// The gate lazy-imports the picker for the def-denied remainder only. Mocking it
// keeps the picker's Drizzle graph out of this suite AND makes the stamped read
// scriptable — under the default Vitest config `@auxx/database`'s schema columns
// are `undefined`, so a real picker query could not answer anything here.
vi.mock('../../../../../../resources/picker/record-picker-service', () => ({
  RecordPickerService: class {
    async getResourcesByIds(ids: string[]) {
      return stampedRead(ids)
    }
  },
}))

import type { PublishedAgentPermissionPolicy } from '@auxx/database'
import { ForbiddenError } from '../../../../../../errors'
import { CapabilitySet } from '../../../../../../permissions/capabilities/capability-set'
import type { CapabilityView } from '../../../../../../permissions/capabilities/capability-view'
import { RUNG_ORDER } from '../../../../../../permissions/capabilities/rung'
import { Area, expandLevelsToKeys, Level } from '../../../../../../permissions/client'
import { emptyAgentPolicy } from '../../../../../../permissions/profiles/agent-policy'
import {
  AgentPolicyCapabilities,
  buildDefIdToApiSlug,
  buildDefIdToEntitySlug,
  type PolicyResourceRef,
} from '../../../../../../permissions/profiles/agent-policy-capabilities'
import type { ToolContext } from '../../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../../agent-framework/types'
import { createBulkUpdateEntityTool } from '../bulk-update-entity'

/** A def the member may edit at the DEF level — the ordinary lane. */
const OPEN_DEF = 'edf_contact00000000000000000'
/** A def with no def-level access — reachable only through a per-row grant. */
const CLOSED_DEF = 'edf_deals0000000000000000000'

const OPEN_A = `${OPEN_DEF}:ins_a00000000000000000000`
const OPEN_B = `${OPEN_DEF}:ins_b00000000000000000000`
const CLOSED_A = `${CLOSED_DEF}:ins_c00000000000000000000`
const CLOSED_B = `${CLOSED_DEF}:ins_d00000000000000000000`

/**
 * A real `CapabilitySet` for a MEMBER whose Records area is `level`, with an
 * explicit restricted-def set so `CLOSED_DEF` is shut while `OPEN_DEF` stays
 * open. The shipped arithmetic, not a stub — the previous version of this file
 * hand-rolled a `CapabilityView` literal, which went stale the moment the
 * interface grew `recordAccessAt` / `canEditRecordAt`.
 */
function member(level: Level, restrictedDefs: string[] = []): CapabilitySet {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.records]: level })),
    // `none` is a restriction marker and never seeds `defAccess`, so a closed def
    // is expressed by membership in `restrictedDefIds` with NO grant entry.
    {} as Record<string, never>,
    'USER',
    'full',
    (id) => id,
    new Set(restrictedDefs),
    (id) => id
  )
}

const AGENT_RESOURCES: PolicyResourceRef[] = [
  { id: 'r-contacts', apiSlug: 'contacts', entityDefinitionId: OPEN_DEF },
  { id: 'r-deals', apiSlug: 'deals', entityDefinitionId: CLOSED_DEF },
]

/** A pure AGENT principal: `contacts` at `edit`, `deals` denied outright. */
function agent(): AgentPolicyCapabilities {
  const policy: PublishedAgentPermissionPolicy = {
    ...emptyAgentPolicy(),
    areas: { default: 'none', overrides: { [Area.records]: 'admin' } },
    definitions: { default: 'none', overrides: { contacts: 'edit' } },
  }
  return new AgentPolicyCapabilities(
    policy,
    buildDefIdToApiSlug(AGENT_RESOURCES),
    buildDefIdToEntitySlug(AGENT_RESOURCES)
  )
}

/** The row a stamped read returns for `recordId` given its aggregated grant rank. */
function stampedAt(capabilities: CapabilityView, recordId: string, grantRank: number | null) {
  const defId = recordId.slice(0, recordId.indexOf(':'))
  return { _access: capabilities.recordAccessAt(defId, grantRank) }
}

function runTool(recordIds: string[], capabilities?: CapabilityView, approvedRecordIds?: string[]) {
  const tool = createBulkUpdateEntityTool(() => ({ db: {}, capabilities }) as never)
  const ctx = { organizationId: 'org_1', userId: 'u_1' } as ToolContext
  return tool.execute(
    {
      recordIds,
      ...(approvedRecordIds ? { _approvedRecordIds: approvedRecordIds } : {}),
      values: [{ fieldId: 'ticket_status', value: 'COMPLETED' }],
    },
    ctx
  ) as Promise<AgentToolResult>
}

beforeEach(() => {
  applyBulkSpy.mockReset()
  applyBulkSpy.mockResolvedValue({ count: 2 })
  stampedRead.mockReset()
  stampedRead.mockResolvedValue({})
})

describe('absent capabilities ⇒ unrestricted', () => {
  it('writes as before, gating nothing and reading no rows', async () => {
    const result = await runTool([OPEN_A, CLOSED_A], undefined)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ total: 2, approved: 2, updated: 2 })
    expect(applyBulkSpy).toHaveBeenCalledTimes(1)
    expect(stampedRead).not.toHaveBeenCalled()
  })
})

describe('the def gate is the fast path', () => {
  it('an all-def-editable batch writes with ZERO extra I/O', async () => {
    const result = await runTool([OPEN_A, OPEN_B], member(Level.Edit))

    expect(result.success).toBe(true)
    expect(applyBulkSpy).toHaveBeenCalledTimes(1)
    expect(stampedRead).not.toHaveBeenCalled()
  })

  it('asks the def gate ONCE per DISTINCT def, not once per record', async () => {
    const capabilities = member(Level.Edit)
    const canEditEntity = vi.spyOn(capabilities, 'canEditEntity')

    const result = await runTool([OPEN_A, OPEN_B, OPEN_A, OPEN_B], capabilities)

    expect(result.success).toBe(true)
    expect(canEditEntity).toHaveBeenCalledTimes(1)
    expect(canEditEntity).toHaveBeenCalledWith(OPEN_DEF)
  })

  it('gates the APPROVED subset, not the originally requested ids', async () => {
    // `CLOSED_A` was requested but not approved, so it must never reach the gate
    // — no def question about it, and no row read for it.
    const result = await runTool([OPEN_A, CLOSED_A], member(Level.Edit, [CLOSED_DEF]), [OPEN_A])

    expect(result.success).toBe(true)
    expect(stampedRead).not.toHaveBeenCalled()
    expect(applyBulkSpy).toHaveBeenCalledWith(expect.objectContaining({ recordIds: [OPEN_A] }))
  })
})

describe('§5.3 — a row the def gate refuses is judged on its own `_access`', () => {
  it('a row shared at `edit` IS writable — the case the def loop got wrong', async () => {
    const capabilities = member(Level.Edit, [CLOSED_DEF])
    const row = stampedAt(capabilities, CLOSED_A, RUNG_ORDER.edit)
    expect(row._access).toBe('edit')
    stampedRead.mockResolvedValue({ [CLOSED_A]: row })

    const result = await runTool([CLOSED_A], capabilities)

    expect(result.success).toBe(true)
    expect(stampedRead).toHaveBeenCalledWith([CLOSED_A])
    expect(applyBulkSpy).toHaveBeenCalledTimes(1)
  })

  it('only the def-DENIED remainder is stamped in a MIXED batch', async () => {
    const capabilities = member(Level.Edit, [CLOSED_DEF])
    stampedRead.mockResolvedValue({
      [CLOSED_B]: stampedAt(capabilities, CLOSED_B, RUNG_ORDER.admin),
    })

    const result = await runTool([OPEN_A, CLOSED_B], capabilities)

    expect(result.success).toBe(true)
    // `OPEN_A` passed the def gate, so it was never read back.
    expect(stampedRead).toHaveBeenCalledWith([CLOSED_B])
  })

  it('a row shared at `read` is refused and the WHOLE batch fails', async () => {
    const capabilities = member(Level.Edit, [CLOSED_DEF])
    stampedRead.mockResolvedValue({
      [CLOSED_A]: stampedAt(capabilities, CLOSED_A, RUNG_ORDER.edit),
      [CLOSED_B]: stampedAt(capabilities, CLOSED_B, RUNG_ORDER.read),
    })

    await expect(runTool([CLOSED_A, CLOSED_B], capabilities)).rejects.toBeInstanceOf(ForbiddenError)
    expect(applyBulkSpy).not.toHaveBeenCalled()
  })

  it('a row denied by BOTH routes throws before any write', async () => {
    // No grant at all: the def gate says no and the stamp folds to `none`.
    const capabilities = member(Level.Edit, [CLOSED_DEF])
    stampedRead.mockResolvedValue({ [CLOSED_A]: stampedAt(capabilities, CLOSED_A, null) })

    await expect(runTool([OPEN_A, CLOSED_A], capabilities)).rejects.toBeInstanceOf(ForbiddenError)
    expect(applyBulkSpy).not.toHaveBeenCalled()
  })
})

describe('§5.2 — non-enumeration: an id the read path hid DENIES', () => {
  it('a row that does not come back from the stamped read is refused', async () => {
    // The read path drops unauthorized ids SILENTLY, so "absent" is the strongest
    // denial signal there is.
    stampedRead.mockResolvedValue({})

    await expect(runTool([CLOSED_A], member(Level.Full, [CLOSED_DEF]))).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(applyBulkSpy).not.toHaveBeenCalled()
  })

  it('a row that comes back WITHOUT a stamp is refused', async () => {
    // An unenforced read carries no `_access`; "no stamp" must never read as
    // "no objection".
    stampedRead.mockResolvedValue({ [CLOSED_A]: {} })

    await expect(runTool([CLOSED_A], member(Level.Full, [CLOSED_DEF]))).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(applyBulkSpy).not.toHaveBeenCalled()
  })
})

describe('a pure AGENT principal behaves exactly as it did under the def loop', () => {
  it('a def the published policy allows writes with no row read', async () => {
    const result = await runTool([OPEN_A, OPEN_B], agent())

    expect(result.success).toBe(true)
    expect(stampedRead).not.toHaveBeenCalled()
  })

  it('a def the policy denies is refused even with an `admin`-rank grant row', async () => {
    // `AgentPolicyCapabilities.recordAccessAt` DISCARDS `grantRank` — an agent's
    // stamp is its own published def rung — and `hasRecordGrantsOn` is
    // unconditionally `false`, so no share on the agent's synthetic user can
    // lift it. The row gate can only ever re-ask the policy question.
    const capabilities = agent()
    expect(capabilities.hasRecordGrantsOn(CLOSED_DEF)).toBe(false)
    const row = stampedAt(capabilities, CLOSED_A, RUNG_ORDER.admin)
    expect(row._access).toBe('none')
    stampedRead.mockResolvedValue({ [CLOSED_A]: row })

    await expect(runTool([CLOSED_A], capabilities)).rejects.toBeInstanceOf(ForbiddenError)
    expect(applyBulkSpy).not.toHaveBeenCalled()
  })
})
