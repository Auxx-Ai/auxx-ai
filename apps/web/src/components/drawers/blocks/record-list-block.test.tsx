// apps/web/src/components/drawers/blocks/record-list-block.test.tsx
//
// The `records` block is the payoff of the record layout system, and it has
// exactly three things that can go wrong:
//
//  1. It runs the WRONG read. The two `source` variants are deliberately not
//     interchangeable (relation = cheap, unordered, uncapped; query = ordered,
//     paged, one request), so §1 and §2 pin each one to its own hook.
//  2. It renders the mirror UNCAPPED. `contact_work_orders` has been measured at
//     475 entries and every row fires four queries of its own, so §3 asserts the
//     cap actually keeps rows out of the DOM rather than merely hiding them.
//  3. It loses the filter. §2 asserts the exact `ConditionGroup` shape, because
//     a dropped condition reduces a related list to "every record of that
//     definition" and still looks plausible on screen.
//
// Strategy: the DATA hooks are mocked and everything that makes a decision runs
// for real: the source branch, `extractRelationshipRecordIds`, the empty and
// loading branches, and `TreeRowList`'s show-more collapse.
// `related-record-row` is stubbed to a leaf so a row is countable and so the
// test does not drag the record/resource/value stores in behind it.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HOST_DEF = 'edf_contact00000000000000000'
const HOST_ROW = 'ein_contactrow00000000000000'
const HOST_RECORD_ID = `${HOST_DEF}:${HOST_ROW}`
const TARGET_DEF = 'edf_workorder0000000000000000'

const h = vi.hoisted(() => ({
  /** What `useSystemValues` answers, keyed by system attribute. */
  systemValues: {} as Record<string, unknown>,
  systemValuesLoading: false,
  /** Slug -> EntityDefinition id, i.e. what `useResourceProperty(slug, 'id')` returns. */
  definitionIds: {} as Record<string, string | undefined>,
  /** Instance ids `useRecordList` answers with. */
  listRecordIds: [] as string[],
  listLoading: false,
  /** Every `useRecordList` argument object, in call order. */
  listCalls: [] as Record<string, unknown>[],
}))

vi.mock('~/components/resources', () => ({
  parseRecordId: (recordId: string) => {
    const colon = recordId.indexOf(':')
    return {
      entityDefinitionId: recordId.slice(0, colon),
      entityInstanceId: recordId.slice(colon + 1),
    }
  },
  toRecordId: (definitionId: string, instanceId: string) => `${definitionId}:${instanceId}`,
  useResourceProperty: (slug: string) => h.definitionIds[slug],
  useRecordList: (options: Record<string, unknown>) => {
    h.listCalls.push(options)
    return { recordIds: h.listRecordIds, isLoading: h.listLoading }
  },
}))

vi.mock('~/components/resources/hooks/use-system-values', () => ({
  useSystemValues: (_recordId: string, attrs: string[]) => ({
    values: Object.fromEntries(attrs.map((a) => [a, h.systemValues[a]])),
    isLoading: h.systemValuesLoading,
  }),
}))

// Stubbed wholesale rather than partially: the real module reaches the record,
// resource, field and field-value stores through four hooks per row, none of
// which this file has anything to say about. The stubs keep the two states the
// block itself chooses between (`RowSkeleton`, `EmptyRow`) observable.
vi.mock('../cards/related-record-row', () => ({
  RelatedRecordRow: ({ recordId, statusAttr }: { recordId: string; statusAttr: string }) => (
    <div data-testid='related-row' data-record-id={recordId} data-status-attr={statusAttr} />
  ),
  EmptyRow: ({ label }: { label: string }) => <div data-testid='empty-row'>{label}</div>,
  RowSkeleton: () => <div data-testid='row-skeleton' />,
  TREE_SECONDARY_NOTRUNCATE: 'tree-secondary-notruncate',
}))

import { RecordListBlock } from './record-list-block'

/** Mirror entries in the shape `extractRelationshipRecordIds` reads. */
function mirror(count: number): { recordId: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    recordId: `${TARGET_DEF}:ein_wo${String(i).padStart(4, '0')}`,
  }))
}

function rows() {
  return screen.queryAllByTestId('related-row')
}

beforeEach(() => {
  h.systemValues = {}
  h.systemValuesLoading = false
  h.definitionIds = { work_order: TARGET_DEF }
  h.listRecordIds = []
  h.listLoading = false
  h.listCalls = []
})

// ── 1. relation source ───────────────────────────────────────────────────────

describe('source kind "relation"', () => {
  it('renders one row per mirror entry and forwards the status attribute', () => {
    h.systemValues = { contact_work_orders: mirror(3) }

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: { kind: 'relation', relationAttr: 'contact_work_orders' },
          statusAttr: 'work_order_status',
        }}
      />
    )

    expect(rows()).toHaveLength(3)
    expect(rows()[0]).toHaveAttribute('data-status-attr', 'work_order_status')
    expect(rows()[0]).toHaveAttribute('data-record-id', `${TARGET_DEF}:ein_wo0000`)
  })

  it('passes the empty string when the block declares no status attribute', () => {
    h.systemValues = { contact_work_orders: mirror(1) }

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{ source: { kind: 'relation', relationAttr: 'contact_work_orders' } }}
      />
    )

    // `RelatedRecordRow` requires a `statusAttr`; '' is the value it tolerates
    // (no attribute resolves, so no badge renders) and the reason the block does
    // not have to fork its row rendering.
    expect(rows()[0]).toHaveAttribute('data-status-attr', '')
  })

  it('renders a skeleton and no rows while the mirror is loading', () => {
    h.systemValuesLoading = true
    h.systemValues = { contact_work_orders: mirror(3) }

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{ source: { kind: 'relation', relationAttr: 'contact_work_orders' } }}
      />
    )

    expect(screen.getByTestId('row-skeleton')).toBeInTheDocument()
    expect(rows()).toHaveLength(0)
  })

  it('renders the configured empty label when the mirror is empty', () => {
    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: { kind: 'relation', relationAttr: 'contact_work_orders' },
          emptyLabel: 'No work orders yet',
        }}
      />
    )

    expect(screen.getByTestId('empty-row')).toHaveTextContent('No work orders yet')
  })

  it('falls back to a generic empty label', () => {
    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{ source: { kind: 'relation', relationAttr: 'contact_work_orders' } }}
      />
    )

    expect(screen.getByTestId('empty-row')).toHaveTextContent('Nothing yet')
  })

  it('never reaches the query hook', () => {
    h.systemValues = { contact_work_orders: mirror(2) }

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{ source: { kind: 'relation', relationAttr: 'contact_work_orders' } }}
      />
    )

    expect(h.listCalls).toHaveLength(0)
  })
})

// ── 2. query source ──────────────────────────────────────────────────────────

describe('source kind "query"', () => {
  it('filters on the host field with the host INSTANCE id, in one AND group', () => {
    h.listRecordIds = ['ein_wo0001']

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: {
            kind: 'query',
            definition: 'work_order',
            hostFieldId: 'work_order:contact',
          },
        }}
      />
    )

    const call = h.listCalls.at(-1)!
    expect(call.entityDefinitionId).toBe(TARGET_DEF)
    expect(call.enabled).toBe(true)
    const filters = call.filters as {
      logicalOperator: string
      conditions: { fieldId: string; operator: string; value: string }[]
    }[]
    expect(filters).toHaveLength(1)
    expect(filters[0].logicalOperator).toBe('AND')
    expect(filters[0].conditions).toEqual([
      expect.objectContaining({
        fieldId: 'work_order:contact',
        operator: 'is',
        // The INSTANCE id, not the full recordId. Mirrors contact-tickets-tab.
        value: HOST_ROW,
      }),
    ])
  })

  it('passes undefined, never [], when the block declares no sort', () => {
    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: { kind: 'query', definition: 'work_order', hostFieldId: 'work_order:contact' },
        }}
      />
    )

    // `useRecordList` re-keys its cache on a fresh array identity, so [] is a
    // documented infinite-loop hazard there.
    expect(h.listCalls.at(-1)!.sorting).toBeUndefined()
  })

  it('forwards the declared sort and page size', () => {
    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: {
            kind: 'query',
            definition: 'work_order',
            hostFieldId: 'work_order:contact',
            sort: { fieldId: 'work_order:created_at', desc: true },
            pageSize: 50,
          },
        }}
      />
    )

    const call = h.listCalls.at(-1)!
    expect(call.sorting).toEqual([{ id: 'work_order:created_at', desc: true }])
    // A page size, not a cap on what exists.
    expect(call.limit).toBe(50)
  })

  it('maps returned instance ids onto the TARGET definition', () => {
    h.listRecordIds = ['ein_wo0001', 'ein_wo0002']

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: { kind: 'query', definition: 'work_order', hostFieldId: 'work_order:contact' },
          statusAttr: 'work_order_status',
        }}
      />
    )

    expect(rows().map((r) => r.getAttribute('data-record-id'))).toEqual([
      `${TARGET_DEF}:ein_wo0001`,
      `${TARGET_DEF}:ein_wo0002`,
    ])
  })

  it('stays loading, and disabled, until the target definition resolves', () => {
    h.definitionIds = {}

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: { kind: 'query', definition: 'work_order', hostFieldId: 'work_order:contact' },
        }}
      />
    )

    // An unresolved definition must not render "nothing yet", which reads as an
    // answer when the question has not been asked.
    expect(screen.getByTestId('row-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('empty-row')).not.toBeInTheDocument()
    expect(h.listCalls.at(-1)!.enabled).toBe(false)
  })

  it('never reaches the relation mirror', () => {
    h.systemValues = { contact_work_orders: mirror(5) }
    h.listRecordIds = ['ein_wo0001']

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: { kind: 'query', definition: 'work_order', hostFieldId: 'work_order:contact' },
        }}
      />
    )

    expect(rows()).toHaveLength(1)
  })
})

// ── 3. the visible cap ───────────────────────────────────────────────────────

describe('visibleLimit', () => {
  it('keeps capped rows OUT OF THE DOM, not merely hidden', () => {
    h.systemValues = { contact_work_orders: mirror(25) }

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: { kind: 'relation', relationAttr: 'contact_work_orders' },
          visibleLimit: 5,
        }}
      />
    )

    // The whole point: each row fires its own record/resource/values/field
    // queries, so an unmounted row is the only kind that costs nothing.
    expect(rows()).toHaveLength(5)
    expect(screen.getByText('Show 20 more')).toBeInTheDocument()
  })

  it('reveals the remainder when the show-more row is toggled', async () => {
    h.systemValues = { contact_work_orders: mirror(12) }

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: { kind: 'relation', relationAttr: 'contact_work_orders' },
          visibleLimit: 4,
        }}
      />
    )

    await userEvent.click(screen.getByText('Show 8 more'))
    expect(rows()).toHaveLength(12)
  })

  it('caps at 10 by default, so an uncapped mirror cannot arrive by omission', () => {
    h.systemValues = { contact_work_orders: mirror(40) }

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{ source: { kind: 'relation', relationAttr: 'contact_work_orders' } }}
      />
    )

    expect(rows()).toHaveLength(10)
  })
})

// ── 4. the actions escape hatch ──────────────────────────────────────────────

describe('actionsComponent', () => {
  it('degrades to the pure-read section when the named component is unregistered', () => {
    h.systemValues = { contact_work_orders: mirror(2) }

    render(
      <RecordListBlock
        recordId={HOST_RECORD_ID as never}
        config={{
          source: { kind: 'relation', relationAttr: 'contact_work_orders' },
          actionsComponent: 'retired-action',
        }}
      />
    )

    // A stored layout can outlive the component it names; that must cost the
    // action, never the list.
    expect(rows()).toHaveLength(2)
  })
})
