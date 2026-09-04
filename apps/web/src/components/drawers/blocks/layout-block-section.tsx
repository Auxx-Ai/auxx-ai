// apps/web/src/components/drawers/blocks/layout-block-section.tsx
'use client'

// The block dispatcher (plans/drawer/record-layout-system.md §4).
//
// One Section's worth of chrome, and a switch on `block.kind`. Everything a
// record surface places goes through here, so a `card` renders identically
// whether it was mounted by `TabCardSection` in `base-entity-drawer.tsx` or by
// this component, and `fields` / `records` blocks inherit that same chrome for
// free.
//
// The gate chain itself lives in `~/components/records/layout/use-block-visibility`;
// `useIsBlockVisible` here is the single-block adapter over it. Either way the
// gates are read off the BLOCK DEFINITION the registry produced. The stored
// layout governs placement and visibility only; it never declares capability,
// so moving a block cannot widen who may see it (§5, "the hard invariant").

import type { LayoutBlock } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import Loader from '@auxx/ui/components/loader'
import { Section } from '@auxx/ui/components/section'
import { cn } from '@auxx/ui/lib/utils'
import { Box } from 'lucide-react'
import { type ComponentType, createElement, useEffect, useState } from 'react'
import { resolveLayoutIcon } from '~/components/records/layout/layout-icon'
import { useBlockVisibility } from '~/components/records/layout/use-block-visibility'
import { DrawerCardActionsProvider } from '../drawer-card-actions'
import { type DrawerTabProps, getTabCardComponent } from '../drawer-tab-registry'
import { FieldsBlock } from './fields-block'
import { RecordListBlock } from './record-list-block'

/**
 * A block that rendered NOTHING hides its whole Section, header included.
 *
 * Verbatim from `base-entity-drawer.tsx`, where it is a module-private constant.
 * The header lives outside the block, so a block that returns `null` (a card
 * with nothing to show, a promoted field group whose fields were all deleted)
 * would otherwise strand its title above blank space. `:empty` is exactly the
 * question ("did this block put any node on the page?"), it needs no cooperation
 * from the block, and a deliberate empty state (`EmptyRow`) is not empty and
 * still shows its header. `collapsible={false}` keeps `section-content` mounted,
 * so the match is stable rather than a side effect of the open state.
 */
const HIDE_WHEN_BLOCK_RENDERS_NOTHING = '[&:has([data-slot=section-content]:empty)]:hidden'

/** Context a block's gates are evaluated against. */
export interface BlockVisibilityContext {
  /** The frame's entity type, e.g. `contact`, `work_order`. */
  entityType: string
  /** True in restricted (read-only) drawer mode. */
  readOnly?: boolean
}

/**
 * Whether this viewer may see this block.
 *
 * A thin adapter over {@link useBlockVisibility}, which owns the gate chain.
 * One implementation, so the drawer, the detail view and the layout editor can
 * never disagree about who sees what: this form is the convenient one when a
 * component already holds the single block it is about to render, while the
 * predicate form is the one derived tab visibility needs (it must evaluate
 * every block of every tab, and the block count changes between renders).
 *
 * Every gate is read from `block`, which the registry produced. Passing a block
 * reconstructed from stored layout data would defeat the invariant in §5.
 */
export function useIsBlockVisible(
  block: LayoutBlock,
  { entityType, readOnly }: BlockVisibilityContext
): boolean {
  return useBlockVisibility({ entityType, readOnly })(block)
}

export interface LayoutBlockSectionProps {
  /** The block to render, as the registry produced it. */
  block: LayoutBlock
  /** The frame's entity type, used to resolve `card` blocks in the registry. */
  entityType: string
  /** Instance half of {@link LayoutBlockSectionProps.recordId}. */
  entityInstanceId: string
  /** Full recordId of the record this surface is showing. */
  recordId: RecordId
  /** Record row data, forwarded to `card` blocks unchanged. */
  record?: Record<string, unknown>
  /** Restricted (read-only) drawer mode. */
  readOnly?: boolean
}

/**
 * One block wrapped in its Section.
 *
 * Owns the Section header's actions-slot element and exposes it through
 * `DrawerCardActionsProvider`, so a lazily-loaded card can portal buttons into a
 * header it does not itself render. This is the same contract `TabCardSection` gives
 * today, which is what lets an existing card move onto a block-driven tab
 * without being touched.
 *
 * Gates are NOT evaluated here. Call {@link useIsBlockVisible} in the list that
 * renders these, so a hidden block never mounts a Section at all.
 */
export function LayoutBlockSection({
  block,
  entityType,
  entityInstanceId,
  recordId,
  record,
  readOnly,
}: LayoutBlockSectionProps) {
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null)

  return (
    // `display: contents`, so this marker adds a queryable node without adding a
    // box. It says which block the section below IS, and the layout editor reads
    // it to ask the live surface whether that block currently shows anything.
    // A card's emptiness is only knowable by rendering it, which is why
    // `HIDE_WHEN_BLOCK_RENDERS_NOTHING` is a CSS `:empty` match in the first
    // place, so there is nothing cheaper to consult. Used to ANNOTATE rows and
    // never to build the tree: the layout is per definition while the dialog is
    // opened from one record, and a tree built from what rendered would drop
    // blocks that exist for every other record.
    <div className='contents' data-layout-block-id={block.id}>
      <Section
        title={block.label}
        icon={
          block.icon
            ? createElement(resolveLayoutIcon(block.icon) ?? Box, { className: 'size-4' })
            : undefined
        }
        initialOpen
        collapsible={false}
        actions={<span ref={setActionsEl} className='contents' />}
        className={cn(
          HIDE_WHEN_BLOCK_RENDERS_NOTHING,
          block.fullBleed &&
            '[&>[data-slot=section]>[data-slot=section-content]]:-mx-3 [&>[data-slot=section]>[data-slot=section-content]]:-mb-4'
        )}>
        <DrawerCardActionsProvider value={actionsEl}>
          <LayoutBlockContent
            block={block}
            entityType={entityType}
            entityInstanceId={entityInstanceId}
            recordId={recordId}
            record={record}
            readOnly={readOnly}
          />
        </DrawerCardActionsProvider>
      </Section>
    </div>
  )
}

/** The kind switch, without the chrome. */
function LayoutBlockContent({
  block,
  entityType,
  entityInstanceId,
  recordId,
  record,
  readOnly,
}: LayoutBlockSectionProps) {
  switch (block.kind) {
    case 'card':
      return (
        <LazyCardBlock
          entityType={entityType}
          cardValue={block.cardValue}
          entityInstanceId={entityInstanceId}
          recordId={recordId}
          record={record}
        />
      )
    case 'fields':
      return <FieldsBlock config={block.config} recordId={recordId} readOnly={readOnly} />
    case 'records':
      return <RecordListBlock config={block.config} recordId={recordId} />
  }
}

/**
 * Lazily loads and renders a registry card, exactly as the drawer's own
 * `LazyTabCard` does. An unregistered `cardValue` renders nothing, so a stored
 * layout naming a retired card degrades to a missing section rather than a
 * broken tab.
 */
function LazyCardBlock({
  entityType,
  cardValue,
  entityInstanceId,
  recordId,
  record,
}: {
  entityType: string
  cardValue: string
  entityInstanceId: string
  recordId: RecordId
  record?: Record<string, unknown>
}) {
  const loader = getTabCardComponent(entityType, cardValue)
  const [Component, setComponent] = useState<ComponentType<DrawerTabProps> | null>(null)

  useEffect(() => {
    if (!loader) return
    let cancelled = false
    loader().then((mod) => {
      if (!cancelled) setComponent(() => mod.default)
    })
    return () => {
      cancelled = true
    }
  }, [loader])

  if (!loader) return null
  if (!Component) {
    return (
      <div className='flex items-center justify-center p-2'>
        <Loader size='sm' />
      </div>
    )
  }

  return <Component entityInstanceId={entityInstanceId} recordId={recordId} record={record} />
}
