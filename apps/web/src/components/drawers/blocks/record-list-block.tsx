// apps/web/src/components/drawers/blocks/record-list-block.tsx
'use client'

// The config-driven `records` block (plans/drawer/record-layout-system.md §4).
//
// Seven files currently hand-write this read (`order-work-orders-card`,
// `quote-jobs-card`, `quote-origin-card`, `work-order-origin-card`,
// `service-request-related-cards` x2, `purchase-order-bills-card`).
// `OrderWorkOrdersCard` is the whole shape in 41 lines; this is that body with
// the relation attribute, status attribute and empty label as config.
//
// The two source variants are NOT interchangeable and that is the point:
// `relation` is one cheap read of an inverse mirror that is unordered and
// uncapped, `query` is a server-ordered, server-paged read that costs a request.
// Which one a section uses is a per-section decision driven by expected list
// length (§10).

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type {
  RecordsBlockConfig,
  RecordsQuerySource,
  RecordsRelationSource,
} from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import Loader from '@auxx/ui/components/loader'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { type ComponentType, useEffect, useMemo, useState } from 'react'
import {
  parseRecordId,
  toRecordId,
  useRecordList,
  useResourceProperty,
} from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import {
  EmptyRow,
  RelatedRecordRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from '../cards/related-record-row'
import { type BlockActionsProps, getBlockActionsComponent } from './block-actions-registry'

/**
 * Rows rendered before the "Show N more" toggle when the block does not set one.
 *
 * Not merely cosmetic. Every `RelatedRecordRow` fires its OWN
 * `useRecord` + `useResource` + `useSystemValues` + `useSystemField`, and an
 * inverse relationship mirror is uncapped. `contact_work_orders` has been
 * measured at 475 entries from 5 records
 * (`packages/lib/src/field-values/sweep-entity-references.ts`). Rendering that
 * unbounded is four figures of queries from one drawer open, so the cap is the
 * default rather than an opt-in a block has to remember.
 */
export const DEFAULT_VISIBLE_LIMIT = 10

/** Default page size for a {@link RecordsQuerySource} that names none. */
const DEFAULT_PAGE_SIZE = 20

/** Muted line rendered when the list resolves to nothing and the block names no label. */
const DEFAULT_EMPTY_LABEL = 'Nothing yet'

/**
 * `RelatedRecordRow` takes a required `statusAttr` because every hand-written
 * caller had one. A `records` block may legitimately have no status column, and
 * the empty string is the value that component tolerates: the attribute
 * resolver returns `undefined` for it, so no badge renders and no field lookup
 * resolves. Kept here as a named constant so the intent is not mistaken for a
 * missing value.
 */
const NO_STATUS_ATTR = ''

export interface RecordListBlockProps {
  /** The block's config. `source` decides which of the two reads runs. */
  config: RecordsBlockConfig
  /** Full recordId of the HOST record the block is placed on. */
  recordId: RecordId
}

/**
 * A list of related records, one `TreeRow` per row, driven entirely by config.
 *
 * Branches on `config.source.kind` into two sibling components rather than
 * running both reads: the discriminant is fixed for the lifetime of a block, so
 * the two hook trees never have to reconcile with each other.
 */
export function RecordListBlock({ config, recordId }: RecordListBlockProps) {
  return config.source.kind === 'relation' ? (
    <RelationRecordList source={config.source} config={config} recordId={recordId} />
  ) : (
    <QueryRecordList source={config.source} config={config} recordId={recordId} />
  )
}

/**
 * `kind: 'relation'`: read the host's inverse relationship mirror.
 *
 * One value read, always current, no server round trip of its own. Unordered
 * and uncapped, which is why {@link DEFAULT_VISIBLE_LIMIT} applies.
 */
function RelationRecordList({
  source,
  config,
  recordId,
}: {
  source: RecordsRelationSource
  config: RecordsBlockConfig
  recordId: RecordId
}) {
  const { values, isLoading } = useSystemValues(recordId, [source.relationAttr], {
    autoFetch: true,
  })

  const rowRecordIds = useMemo(
    () => extractRelationshipRecordIds(values[source.relationAttr]),
    [values, source.relationAttr]
  )

  return (
    <RecordListBody
      config={config}
      recordId={recordId}
      rowRecordIds={rowRecordIds}
      isLoading={isLoading}
    />
  )
}

/**
 * `kind: 'query'`: read the target definition with a filter, sort and page size.
 *
 * The only option when the list needs an order or a bounded page, because
 * inverse relationship fields are declared `sortable: false`. Mirrors
 * `contact-tickets-tab.tsx`: one AND `ConditionGroup` whose single condition is
 * `hostFieldId is <host instance id>`.
 */
function QueryRecordList({
  source,
  config,
  recordId,
}: {
  source: RecordsQuerySource
  config: RecordsBlockConfig
  recordId: RecordId
}) {
  const { entityInstanceId } = parseRecordId(recordId)
  const targetDefinitionId = useResourceProperty(source.definition, 'id')

  const filters = useMemo<ConditionGroup[]>(
    () => [
      {
        id: `block-host-${source.hostFieldId}`,
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: `block-host-${source.hostFieldId}-match`,
            fieldId: source.hostFieldId as ResourceFieldId,
            operator: 'is' as const,
            value: entityInstanceId,
          },
        ],
      },
    ],
    [source.hostFieldId, entityInstanceId]
  )

  // `useRecordList` must never receive `[]` for either of these. A fresh empty
  // array is a new identity every render and re-keys the list. `undefined` is
  // the documented "no sort" value and resolves to the shared EMPTY_SORTING.
  const sorting = useMemo(
    () =>
      source.sort ? [{ id: source.sort.fieldId, desc: source.sort.desc ?? false }] : undefined,
    [source.sort]
  )

  const { recordIds, isLoading } = useRecordList({
    entityDefinitionId: targetDefinitionId ?? '',
    filters,
    sorting,
    // A page size, NOT a cap on what exists. The visible cap is `visibleLimit`.
    limit: source.pageSize ?? DEFAULT_PAGE_SIZE,
    enabled: !!targetDefinitionId && !!entityInstanceId,
  })

  const rowRecordIds = useMemo(
    () => (targetDefinitionId ? recordIds.map((id) => toRecordId(targetDefinitionId, id)) : []),
    [recordIds, targetDefinitionId]
  )

  return (
    <RecordListBody
      config={config}
      recordId={recordId}
      rowRecordIds={rowRecordIds}
      isLoading={isLoading || !targetDefinitionId}
    />
  )
}

/**
 * The rendering half both sources share: skeleton, empty row, capped row list
 * and the optional actions component.
 */
function RecordListBody({
  config,
  recordId,
  rowRecordIds,
  isLoading,
}: {
  config: RecordsBlockConfig
  recordId: RecordId
  rowRecordIds: RecordId[]
  isLoading: boolean
}) {
  const statusAttr = config.statusAttr ?? NO_STATUS_ATTR
  const visibleLimit = config.visibleLimit ?? DEFAULT_VISIBLE_LIMIT
  const actions = config.actionsComponent ? (
    <BlockActions name={config.actionsComponent} recordId={recordId} />
  ) : null

  if (isLoading) return <RowSkeleton />

  if (rowRecordIds.length === 0) {
    return (
      <>
        <EmptyRow label={config.emptyLabel ?? DEFAULT_EMPTY_LABEL} />
        {actions}
      </>
    )
  }

  return (
    <div className={cn('space-y-0.5', TREE_SECONDARY_NOTRUNCATE)}>
      <TreeRowList
        items={rowRecordIds}
        getKey={(id) => id}
        visibleLimit={visibleLimit}
        className='gap-0.5'
        renderRow={(id) => <RelatedRecordRow recordId={id} statusAttr={statusAttr} />}
      />
      {actions}
    </div>
  )
}

/**
 * Lazily mounts the named actions component. Mirrors the drawer's own lazy card
 * loader; an unknown name renders nothing rather than failing the section.
 */
function BlockActions({ name, recordId }: { name: string; recordId: RecordId }) {
  const loader = getBlockActionsComponent(name)
  const [Component, setComponent] = useState<ComponentType<BlockActionsProps> | null>(null)

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

  const { entityInstanceId } = parseRecordId(recordId)
  return <Component recordId={recordId} entityInstanceId={entityInstanceId} />
}
