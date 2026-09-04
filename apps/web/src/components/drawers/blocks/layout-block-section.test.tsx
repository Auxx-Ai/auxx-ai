// apps/web/src/components/drawers/blocks/layout-block-section.test.tsx
//
// Two contracts live in this file, and the first one is a security property.
//
// `useIsBlockVisible` is the single place the four gates are evaluated, and the
// hard invariant of the record layout system (§5) is that gates come from the
// registry's block definition and never from stored layout data, so moving a
// block cannot widen who may see it. The cases below pin each gate
// independently, plus the one detail that is easy to get wrong and silent when
// it is: restricted mode is keyed by CARD VALUE, so a `card` block must present
// `cardValue` and not its `card:`-prefixed block id.
//
// `LayoutBlockSection` is the chrome and the kind switch. It has to be
// interchangeable with `TabCardSection`, so the assertions are on the things a
// card actually depends on: the header, and the `:empty` rule that hides a
// section whose block rendered nothing.

import { render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const RECORD_ID = 'edf_workorder000000000000000:ein_row000000000000000000000'

const h = vi.hoisted(() => ({
  /** Permission keys the viewer holds. */
  granted: new Set<string>(),
  /** Feature keys the org has. */
  features: new Set<string>(),
  /** Record resources (definition slugs) the viewer may read. */
  readableResources: new Set<string>(),
  /** Loaders `getTabCardComponent` answers with, keyed `entityType:value`. */
  cardLoaders: {} as Record<string, () => Promise<{ default: () => JSX.Element }>>,
}))

vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ can: (key: string) => h.granted.has(key) }),
}))

vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: (key: string) => h.features.has(key) }),
}))

vi.mock('~/components/resources', () => ({
  useCanViewRecordResource: () => (slug?: string) => !slug || h.readableResources.has(slug),
}))

// The restricted-mode set is the REAL one. The point of the check is that a
// block agrees with the drawer about which values are hidden, so a local copy
// would test nothing. Only the card lookup is swapped, so the dispatcher test
// does not dynamically import a real card and everything behind it.
vi.mock('../drawer-tab-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../drawer-tab-registry')>()
  return {
    ...actual,
    getTabCardComponent: (entityType: string, cardValue: string) =>
      h.cardLoaders[`${entityType}:${cardValue}`],
  }
})

vi.mock('./fields-block', () => ({
  FieldsBlock: ({ config }: { config?: { fieldGroupId?: string } }) => (
    <div data-testid='fields-block' data-group={config?.fieldGroupId ?? ''} />
  ),
}))

vi.mock('./record-list-block', () => ({
  RecordListBlock: ({ config }: { config: { source: { kind: string } } }) => (
    <div data-testid='records-block' data-source-kind={config.source.kind} />
  ),
}))

import type { CardBlock, FieldsBlock, RecordsBlock } from '@auxx/lib/resources/client'
import { LayoutBlockSection, useIsBlockVisible } from './layout-block-section'

const cardBlock = (over: Partial<CardBlock> = {}): CardBlock => ({
  id: 'card:communications',
  kind: 'card',
  label: 'Communications',
  cardValue: 'communications',
  ...over,
})

const recordsBlock = (over: Partial<RecordsBlock> = {}): RecordsBlock => ({
  id: 'blk_workorders',
  kind: 'records',
  label: 'Work orders',
  config: { source: { kind: 'relation', relationAttr: 'contact_work_orders' } },
  ...over,
})

const fieldsBlock = (over: Partial<FieldsBlock> = {}): FieldsBlock => ({
  id: 'core:details',
  kind: 'fields',
  label: 'Details',
  ...over,
})

function visible(block: Parameters<typeof useIsBlockVisible>[0], readOnly = false) {
  return renderHook(() => useIsBlockVisible(block, { entityType: 'work_order', readOnly })).result
    .current
}

beforeEach(() => {
  h.granted = new Set()
  h.features = new Set()
  h.readableResources = new Set()
  h.cardLoaders = {}
})

// ── the gate chain ───────────────────────────────────────────────────────────

describe('useIsBlockVisible', () => {
  it('shows an ungated block', () => {
    expect(visible(recordsBlock())).toBe(true)
  })

  it('hides a block whose org feature is absent, and shows it once present', () => {
    const block = recordsBlock({ featureGate: 'manufacturing' })
    expect(visible(block)).toBe(false)
    h.features.add('manufacturing')
    expect(visible(block)).toBe(true)
  })

  it('hides a block whose permission key the viewer lacks', () => {
    const block = recordsBlock({ permissionKey: 'money.view' })
    expect(visible(block)).toBe(false)
    h.granted.add('money.view')
    expect(visible(block)).toBe(true)
  })

  it('hides a block listing a definition the viewer cannot read', () => {
    const block = recordsBlock({ recordResource: 'work_order' })
    expect(visible(block)).toBe(false)
    h.readableResources.add('work_order')
    expect(visible(block)).toBe(true)
  })

  it('applies restricted mode to a card block by its CARD VALUE, not its block id', () => {
    // `work_order:communications` is in the real restricted set. The block id is
    // `card:communications`, which is NOT. Reading the gate off the id would
    // leave a communications card visible to a restricted viewer and look fine.
    const block = cardBlock()
    expect(visible(block, false)).toBe(true)
    expect(visible(block, true)).toBe(false)
  })

  it('leaves an unrestricted card visible in restricted mode', () => {
    expect(visible(cardBlock({ id: 'card:metrics', cardValue: 'metrics' }), true)).toBe(true)
  })

  it('requires every gate at once', () => {
    const block = recordsBlock({ permissionKey: 'money.view', recordResource: 'work_order' })
    h.granted.add('money.view')
    expect(visible(block)).toBe(false)
    h.readableResources.add('work_order')
    expect(visible(block)).toBe(true)
  })
})

// ── chrome and dispatch ──────────────────────────────────────────────────────

describe('LayoutBlockSection', () => {
  function renderBlock(block: Parameters<typeof LayoutBlockSection>[0]['block']) {
    return render(
      <LayoutBlockSection
        block={block}
        entityType='work_order'
        entityInstanceId='ein_row000000000000000000000'
        recordId={RECORD_ID as never}
      />
    )
  }

  it('renders the block label as the section header', () => {
    renderBlock(recordsBlock({ label: 'Purchase orders' }))
    expect(screen.getByText('Purchase orders')).toBeInTheDocument()
  })

  it('carries the hide-when-empty rule and keeps the section content mounted', () => {
    const { container } = renderBlock(recordsBlock())
    expect(container.querySelector('[data-slot=section-content]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot=section-wrapper]')?.className).toContain(
      '[&:has([data-slot=section-content]:empty)]:hidden'
    )
  })

  it('cancels the section padding for a fullBleed block', () => {
    const { container } = renderBlock(recordsBlock({ fullBleed: true }))
    expect(container.querySelector('[data-slot=section-wrapper]')?.className).toContain('-mx-3')
  })

  // The editor asks the LIVE surface whether a card rendered anything, since a
  // card's emptiness is only knowable by rendering it. That question is asked
  // through this attribute, so losing it silently stops "Empty for this record"
  // from ever appearing.
  it('tags the rendered section with its block id, without adding a box', () => {
    const { container } = renderBlock(recordsBlock({ id: 'card:interactions' }))
    const marker = container.querySelector("[data-layout-block-id='card:interactions']")

    expect(marker).toBeInTheDocument()
    expect(marker?.className).toContain('contents')
    expect(marker?.querySelector('[data-slot=section-content]')).toBeInTheDocument()
  })

  it('dispatches kind "records" to the record list block', () => {
    renderBlock(recordsBlock())
    expect(screen.getByTestId('records-block')).toHaveAttribute('data-source-kind', 'relation')
  })

  it('dispatches kind "fields" to the fields block, forwarding the group', () => {
    renderBlock(fieldsBlock({ id: 'grp_shipping', config: { fieldGroupId: 'grp_shipping' } }))
    expect(screen.getByTestId('fields-block')).toHaveAttribute('data-group', 'grp_shipping')
  })

  it('dispatches kind "card" through the registry', async () => {
    h.cardLoaders['work_order:metrics'] = async () => ({
      default: () => <div data-testid='card-body' />,
    })

    renderBlock(cardBlock({ id: 'card:metrics', cardValue: 'metrics', label: 'Metrics' }))
    expect(await screen.findByTestId('card-body')).toBeInTheDocument()
  })

  it('renders nothing for a card value the registry no longer knows', () => {
    const { container } = renderBlock(cardBlock({ id: 'card:retired', cardValue: 'retired' }))
    // A stored layout outlives the code that backed it; that must cost the
    // section, not the tab.
    expect(container.querySelector('[data-slot=section-content]')?.children).toHaveLength(0)
  })
})
