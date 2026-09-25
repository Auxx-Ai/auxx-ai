// packages/lib/src/mrp/__tests__/actions/draft-builds.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import type { ActionItem } from '../../actions/shared'

const h = vi.hoisted(() => ({
  items: new Map<string, ActionItem>(),
  buildCalls: [] as Record<string, unknown>[],
  refuseBuild: new Map<string, Error>(),
}))

vi.mock('../../actions/shared', async (importActual) => ({
  ...(await importActual<typeof import('../../actions/shared')>()),
  resolveActionRun: vi.fn(async (_db: unknown, _org: string, runId?: string) => ({
    id: runId ?? 'run_latest',
    asOf: new Date('2026-09-20T00:00:00Z'),
  })),
  readActionItems: vi.fn(async (_db: unknown, _org: string, _run: string, ids: string[]) => {
    return new Map(ids.flatMap((id) => (h.items.has(id) ? [[id, h.items.get(id)!]] : [])))
  }),
}))

vi.mock('../../../inventory/builds/build-mutations', () => ({
  createBuild: vi.fn(
    async (_db: unknown, _org: string, _user: string, input: { partId: string }) => {
      h.buildCalls.push(input)
      const refusal = h.refuseBuild.get(input.partId)
      if (refusal) return err(refusal)
      return ok({ buildId: `build_${input.partId}` })
    }
  ),
}))

import { draftBuilds } from '../../actions/draft-builds'

function made(partId: string, over: Partial<ActionItem> = {}): ActionItem {
  return {
    partId,
    suggestionKind: 'build',
    supplyType: 'made',
    suggestedQty: 20,
    suggestedVendorPartId: null,
    suggestedSupplierId: null,
    ...over,
  }
}

const draft = (items: { partId: string; quantity?: number }[], runId?: string) =>
  draftBuilds({} as never, 'org_1', 'user_1', { runId, items })

beforeEach(() => {
  h.items.clear()
  h.buildCalls.length = 0
  h.refuseBuild.clear()
})

describe('draftBuilds', () => {
  it('creates one manual planned build per made part, memo naming the run', async () => {
    h.items.set('m1', made('m1'))
    h.items.set('m2', made('m2'))

    const result = (
      await draft([{ partId: 'm1' }, { partId: 'm2', quantity: 7 }], 'run_3')
    )._unsafeUnwrap()

    expect(result).toEqual({
      runId: 'run_3',
      created: [
        { partId: 'm1', buildId: 'build_m1' },
        { partId: 'm2', buildId: 'build_m2' },
      ],
      refused: [],
    })
    expect(h.buildCalls).toEqual([
      {
        partId: 'm1',
        quantityPlanned: 20,
        notes: 'Drafted from MRP run run_3 (as of 2026-09-20). Parts: m1',
        source: 'manual',
      },
      {
        partId: 'm2',
        quantityPlanned: 7,
        notes: 'Drafted from MRP run run_3 (as of 2026-09-20). Parts: m2',
        source: 'manual',
      },
    ])
  })

  it('refuses each unusable part and a refused build does not lose the others', async () => {
    h.items.set('ok', made('ok'))
    h.items.set('bought', made('bought', { suggestionKind: 'purchase' }))
    h.items.set('none', made('none', { suggestionKind: null }))
    h.items.set('noqty', made('noqty', { suggestedQty: null }))
    h.items.set('nobom', made('nobom'))
    h.items.set('last', made('last'))
    h.refuseBuild.set('nobom', new UnprocessableEntityError('This part has no bill of materials'))

    const result = (
      await draft([
        { partId: 'ok' },
        { partId: 'missing' },
        { partId: 'bought' },
        { partId: 'none' },
        { partId: 'noqty' },
        { partId: 'nobom' },
        { partId: 'last', quantity: 0 },
      ])
    )._unsafeUnwrap()

    expect(result.created).toEqual([{ partId: 'ok', buildId: 'build_ok' }])
    expect(result.refused).toEqual([
      { partId: 'missing', reason: 'Not planned in this MRP run' },
      { partId: 'bought', reason: 'The run does not suggest a build' },
      { partId: 'none', reason: 'The run does not suggest a build' },
      { partId: 'noqty', reason: 'No quantity to build' },
      { partId: 'nobom', reason: 'This part has no bill of materials' },
      { partId: 'last', reason: 'No quantity to build' },
    ])
  })
})
