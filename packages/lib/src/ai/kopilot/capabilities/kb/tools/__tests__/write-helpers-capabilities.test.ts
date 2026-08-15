// packages/lib/src/ai/kopilot/capabilities/kb/tools/__tests__/write-helpers-capabilities.test.ts
//
// Permissions v2 §3.3 (Phase C2): `runBlockCrudOp` is the single choke point for
// every KB write tool (insert_blocks / replace_block / delete_blocks /
// move_blocks, plus runMarkdownReplace via runPatchSequence), so the
// `assertEditInstance('kb', …)` gate lives there — before the snapshot, the lock
// and the patch. Absent capabilities ⇒ unrestricted, exactly as before.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureSnapshotSpy = vi.fn()
const updateArticleDraftSpy = vi.fn()

vi.mock('../../../../../../kb/kopilot-snapshot', () => ({
  readKopilotSnapshot: vi.fn(async () => undefined),
  captureKopilotSnapshot: (...args: unknown[]) => captureSnapshotSpy(...args),
}))

vi.mock('../../../../../../kb/realtime', () => ({
  publishKbArticleEvent: vi.fn(async () => {}),
}))

vi.mock('../../../../../../kb/kb-service', () => ({
  KBService: class {
    async updateArticleDraft(...args: unknown[]) {
      return updateArticleDraftSpy(...args)
    }
  },
}))

import { ForbiddenError } from '../../../../../../errors'
import type { CapabilityView } from '../../../../../../permissions/capabilities/capability-view'
import { Level } from '../../../../../../permissions/capabilities/registry'
import type { AgentDeps } from '../../../../../agent-framework/types'
import type { ToolDeps } from '../../../types'
import { runBlockCrudOp } from '../write-helpers'

const KB_ID = 'kb_home'
const ARTICLE_ID = 'art_1'

/** All-permissive `CapabilityView`; override just the gate under test. */
function makeCapabilities(overrides: Partial<CapabilityView> = {}): CapabilityView {
  const yes = () => true
  const noop = () => {}
  return {
    can: yes,
    has: yes,
    assert: noop,
    areaLevel: () => Level.Full,
    canWriteEntity: yes,
    assertWriteEntity: noop,
    canEditEntity: yes,
    assertEditEntity: noop,
    filterEditableDefIds: (ids: string[]) => ids,
    canViewEntity: yes,
    assertViewEntity: noop,
    filterViewableDefIds: (ids: string[]) => ids,
    // Record lane (plan v3/03 P5) — all-permissive: every def is present and
    // every row folds to `admin`.
    hasDefPresence: yes,
    hasRecordGrantsOn: yes,
    recordDefRung: () => 'admin',
    recordAccessAt: () => 'admin',
    canDeleteRecordAt: yes,
    canEditRecordAt: yes,
    viewAccessFor: () => undefined,
    canAdministerDef: yes,
    assertAdministerDef: noop,
    canViewInstance: yes,
    // The list-side twin of `canViewInstance` above: sees everything, denies nothing.
    instanceListScope: () => ({ kind: 'exclude', excludeIds: [] }),
    canEditInstance: yes,
    canAdminInstance: yes,
    assertViewInstance: noop,
    assertEditInstance: noop,
    assertAdminInstance: noop,
    ...overrides,
  }
}

function makeToolDeps(capabilities?: CapabilityView): ToolDeps {
  return {
    db: {
      query: {
        Article: {
          findFirst: async () => ({
            id: ARTICLE_ID,
            homeKnowledgeBaseId: KB_ID,
            draftRevision: {
              contentJson: [{ type: 'block', attrs: { id: 'b1', blockType: 'text' }, content: [] }],
            },
          }),
        },
      },
    },
    organizationId: 'org_1',
    userId: 'u_1',
    sessionId: 's_1',
    sessionContext: {
      references: [{ kind: 'article', id: ARTICLE_ID, origin: 'mention' }],
    },
    capabilities,
  } as unknown as ToolDeps
}

const agentDeps = {
  organizationId: 'org_1',
  userId: 'u_1',
  sessionId: 's_1',
  turnId: 't_1',
} as AgentDeps

function run(capabilities?: CapabilityView) {
  return runBlockCrudOp({
    agentDeps,
    toolDeps: makeToolDeps(capabilities),
    patch: { op: 'delete', blockIds: ['b1'] },
    opIndex: 0,
  })
}

beforeEach(() => {
  captureSnapshotSpy.mockReset()
  updateArticleDraftSpy.mockReset()
})

describe('runBlockCrudOp — KB instance-access write gate', () => {
  it('without capabilities, applies the op as before', async () => {
    const result = await run(undefined)

    expect(result.ok).toBe(true)
    expect(updateArticleDraftSpy).toHaveBeenCalledTimes(1)
  })

  it('with an editable KB, applies the op', async () => {
    const result = await run(makeCapabilities())

    expect(result.ok).toBe(true)
    expect(updateArticleDraftSpy).toHaveBeenCalledTimes(1)
  })

  it('throws ForbiddenError before the snapshot/lock when the KB is not editable', async () => {
    const seen: Array<[string, string]> = []
    const capabilities = makeCapabilities({
      canEditInstance: () => false,
      assertEditInstance: (key, instanceId) => {
        seen.push([key, instanceId])
        throw new ForbiddenError("You don't have permission to edit this.")
      },
    })

    await expect(run(capabilities)).rejects.toBeInstanceOf(ForbiddenError)
    expect(seen).toEqual([['kb', KB_ID]])
    // Nothing was captured, locked, or persisted.
    expect(captureSnapshotSpy).not.toHaveBeenCalled()
    expect(updateArticleDraftSpy).not.toHaveBeenCalled()
  })
})
