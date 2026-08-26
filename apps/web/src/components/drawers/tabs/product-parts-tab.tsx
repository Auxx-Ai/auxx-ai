// apps/web/src/components/drawers/tabs/product-parts-tab.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { PartKind, type RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { pluralize } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { Link2, MoreHorizontal, Package, Plus, Unlink } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { PartFormDialog } from '~/components/manufacturing/parts/part-form-dialog'
import {
  type RecordMeta,
  toRecordId,
  useRecordLink,
  useRecordList,
  useResource,
  useResourceProperty,
} from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { ProductVariantLinkDialog } from './product-variant-link-dialog'
import { buildVariantSummaryLabel, summarizeVariants, type VariantRow } from './summarize-variants'

/**
 * Hop 1 — the part's OWN values.
 *
 * Four attributes, not seven: `part_title`, `part_sku` and `part_image` are
 * already in the list payload as `displayName` / `secondaryInfo` / `avatarUrl`
 * (`DISPLAY_FIELD_CONFIG.part` maps exactly those three), so fetching them
 * again buys nothing (plans/products/09-variant-ui.md §2 V5b).
 */
const VARIANT_ATTRIBUTES = [
  'part_cost',
  'part_quantity_on_hand',
  'part_kind',
  'part_catalog_items',
] as const

/** Hop 2 — the backing catalog items', for the Price column. */
const CATALOG_ITEM_ATTRIBUTES = ['catalog_item_default_unit_price', 'catalog_item_active'] as const

/** `PartKind.values` keyed by option value, for badge label + colour. */
const PART_KIND_BY_VALUE = Object.fromEntries(PartKind.values.map((v) => [v.value, v]))

/** What one row renders, resolved by the tab. */
interface VariantRowValues extends VariantRow {
  cost: number | null
  kind: string | undefined
  /** Whether hop 2 has actually answered — `—` until it has, never a guessed 0. */
  priceLoaded: boolean
}

/** Collapse a SINGLE_SELECT read (scalar on some paths, array on others). */
function selectValue(raw: unknown): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw
  return typeof first === 'string' && first !== '' ? first : undefined
}

/**
 * Variants tab for the product drawer AND detail page — the product's parts as
 * rows via the single family edge (`part.product` / `product.parts`,
 * plans/products/01-product-family.md §5). Rows are plain `part` records
 * filtered on the belongs_to side (`part:product`), the same read the part
 * drawer's Family card uses for siblings.
 *
 * Writes (plans/products/09-variant-ui.md §3): create a variant into this
 * family, link an existing part in, and detach one. Detach clears
 * `part_product` and never deletes the part — it stays re-linkable from the
 * same header.
 *
 * ⚠️ **Seam for contribute mode.** Once the Shopify product stream contributes
 * (plans/products/02-shopify-mapping.md), the sink writes `part_product` too,
 * and detaching a connector-written part would be undone by the next sync. No
 * ownership guard is built here on purpose — there is no such writer yet, and a
 * guard designed against a hypothetical one is a guard that will be wrong. 02
 * owns closing it, together with the disconnect/undo questions it already has
 * open.
 *
 * Reads are two batched, ALL-DIRECT hops (§4.1) — never a drill path. One
 * `FieldPath` ref in a batch flips `batchGetValues` off its single-query fast
 * path and resolves every ref in that batch sequentially, so the round trip it
 * saves on the client is paid for several times over on the server.
 */
export function ProductPartsTab({ entityInstanceId }: DrawerTabProps) {
  const partDefId = useResourceProperty('part', 'id')
  const { resource: partResource } = useResource(partDefId)

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isLinkOpen, setIsLinkOpen] = useState(false)
  const [confirmDetach, ConfirmDetachDialog] = useConfirm()

  // The tab is gated on READ of part (drawer config `recordResource`); adding,
  // linking and detaching each additionally need WRITE.
  const { canEditEntity } = useAccess()
  const canEdit = !!partDefId && canEditEntity(partDefId)

  // Parts belonging to this product family
  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'product-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'product-match',
            fieldId: 'part:product' as ResourceFieldId,
            operator: 'is' as const,
            value: entityInstanceId,
          },
        ],
      },
    ],
    [entityInstanceId]
  )

  const { records, isLoading, total, hasNextPage, fetchNextPage, isFetchingNextPage, refresh } =
    useRecordList({
      entityDefinitionId: partDefId ?? '',
      filters,
      enabled: !!entityInstanceId && !!partDefId,
    })

  const rowRecordIds = useMemo(
    () => (partDefId ? records.map((record) => toRecordId(partDefId, record.id)) : []),
    [partDefId, records]
  )

  // ── Hop 1: the parts' own values, one batch ───────────────────────
  const { valuesById } = useSystemValuesForRecords(rowRecordIds, VARIANT_ATTRIBUTES, {
    autoFetch: true,
    enabled: rowRecordIds.length > 0,
  })

  // ── Hop 2: the catalog items behind them, one batch ───────────────
  // Serial after hop 1 by necessity — these ids only exist inside hop 1's
  // answer. The guard matters: without it the hook fires with an empty array on
  // first paint.
  const itemRecordIds = useMemo(() => {
    const ids = new Set<RecordId>()
    for (const recordId of rowRecordIds) {
      const items = valuesById[recordId]?.part_catalog_items as RecordId[] | undefined
      for (const item of items ?? []) ids.add(item)
    }
    return [...ids]
  }, [rowRecordIds, valuesById])

  const { valuesById: itemValues, loadedById: itemLoaded } = useSystemValuesForRecords(
    itemRecordIds,
    CATALOG_ITEM_ATTRIBUTES,
    { autoFetch: true, enabled: itemRecordIds.length > 0 }
  )

  const rows: VariantRowValues[] = useMemo(
    () =>
      records.map((record, index) => {
        const recordId = rowRecordIds[index] as RecordId
        const own = valuesById[recordId]
        const items = (own?.part_catalog_items as RecordId[] | undefined) ?? []

        // Exactly one backing item supplies a price. Zero has none; more than
        // one is price tiers, and picking one arbitrarily would be a lie — §4.2
        // renders "n items" for that row instead, the same call
        // `part-pricing-card` makes for the has_many case.
        const soleItem = items.length === 1 ? (items[0] as RecordId) : undefined
        const soleValues = soleItem ? itemValues[soleItem] : undefined
        // A missing `active` reads as the registry default, true — the same
        // collapse `useCatalogItems` applies.
        const active = (soleValues?.catalog_item_active as boolean | null | undefined) ?? true
        const price =
          (soleValues?.catalog_item_default_unit_price as number | null | undefined) ?? null

        return {
          id: record.id,
          quantityOnHand: (own?.part_quantity_on_hand as number | null | undefined) ?? null,
          cost: (own?.part_cost as number | null | undefined) ?? null,
          kind: selectValue(own?.part_kind),
          catalogItemCount: items.length,
          priceCents: soleItem && active ? price : null,
          priceLoaded: !soleItem || itemLoaded[soleItem]?.catalog_item_active === true,
        }
      }),
    [records, rowRecordIds, valuesById, itemValues, itemLoaded]
  )

  const summary = useMemo(
    () => summarizeVariants(rows, { total, hasNextPage }),
    [rows, total, hasNextPage]
  )

  // ── Writes ────────────────────────────────────────────────────────
  const { saveMultipleAsync } = useSaveFieldValue({})

  /** Detach: clear `part_product`. The part itself is never deleted. */
  const handleDetach = useCallback(
    async (partId: string, label: string) => {
      if (!partDefId) return
      const confirmed = await confirmDetach({
        title: 'Remove from product',
        description: `Remove "${label}" from this product family? The part itself is kept, and you can link it back at any time.`,
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: false,
      })
      if (!confirmed) return

      const success = await saveMultipleAsync(toRecordId(partDefId, partId), [
        { fieldId: 'part_product', value: null, fieldType: FieldType.RELATIONSHIP },
      ])
      if (!success) {
        toastError({
          title: 'Error removing variant',
          description: 'The part could not be removed from this product.',
        })
        return
      }
      refresh()
    },
    [partDefId, confirmDetach, saveMultipleAsync, refresh]
  )

  if (isLoading) {
    return (
      <div className='p-4 space-y-4'>
        <Skeleton className='h-6 w-32' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  const actions = canEdit ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='xs'>
          <Plus />
          Add Variant
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onClick={() => setIsCreateOpen(true)}>
          <Plus />
          New variant
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setIsLinkOpen(true)}>
          <Link2 />
          Link existing part
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined

  return (
    <ScrollArea className='flex-1'>
      <Section
        title={`Variants (${total})`}
        actions={actions}
        className='flex flex-col flex-1 min-h-0 w-full [&_[data-slot=section]]:flex-1 [&_[data-slot=section]]:border-b-0 [&_[data-slot=section-content]]:flex-1'
        collapsible={false}
        icon={<Package className='size-4 text-muted-foreground/50' />}>
        {records.length === 0 ? (
          <div className='flex h-28 flex-col items-center justify-center gap-1 text-center border rounded-lg bg-muted/30'>
            <Package className='mb-1 h-6 w-6 text-muted-foreground' />
            <p className='text-sm text-muted-foreground'>No variants yet</p>
            {canEdit ? (
              <div className='flex items-center gap-2 pt-1'>
                <Button variant='outline' size='xs' onClick={() => setIsCreateOpen(true)}>
                  <Plus />
                  New variant
                </Button>
                <Button variant='outline' size='xs' onClick={() => setIsLinkOpen(true)}>
                  <Link2 />
                  Link existing part
                </Button>
              </div>
            ) : (
              <p className='text-xs text-muted-foreground'>
                Parts join a family through their Product field
              </p>
            )}
          </div>
        ) : (
          <div className='space-y-2'>
            <p className='text-xs text-muted-foreground'>
              {buildVariantSummaryLabel(summary, formatCurrency)}
            </p>
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variant</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead className='text-right'>Price</TableHead>
                    <TableHead className='text-right'>Cost</TableHead>
                    <TableHead className='text-right'>On Hand</TableHead>
                    <TableHead className='w-10' />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record, index) => (
                    <ProductPartRow
                      key={record.id}
                      record={record}
                      recordId={rowRecordIds[index] as RecordId}
                      values={rows[index] as VariantRowValues}
                      iconId={partResource?.icon ?? 'package'}
                      color={partResource?.color ?? 'gray'}
                      canEdit={canEdit}
                      onDetach={() =>
                        void handleDetach(record.id, record.displayName ?? 'this part')
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            {hasNextPage && (
              <div className='flex justify-center pt-1'>
                <Button
                  variant='ghost'
                  size='xs'
                  loading={isFetchingNextPage}
                  loadingText='Loading...'
                  onClick={() => fetchNextPage()}>
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Create seeds nothing into this list: `PartFormDialog` owns its own
          `api.record.create` (and chains an optional vendor-part create off the
          result), so the new row arrives via a refetch rather than the
          `useCreateRecord` cache seed §3.5 sketched. Same outcome, one extra
          fetch — converting the shared part editor's write path was out of
          scope here. */}
      <PartFormDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        productId={entityInstanceId}
        onSuccess={refresh}
      />

      <ProductVariantLinkDialog
        open={isLinkOpen}
        onOpenChange={setIsLinkOpen}
        productId={entityInstanceId}
        excludeRecordIds={rowRecordIds}
        onSuccess={refresh}
      />

      <ConfirmDetachDialog />
    </ScrollArea>
  )
}

interface ProductPartRowProps {
  record: RecordMeta
  recordId: RecordId
  values: VariantRowValues
  iconId: string
  color: string
  canEdit: boolean
  onDetach: () => void
}

/**
 * One variant row — presentational.
 *
 * It used to own a `useSystemValues` subscription per row, which meant N queued
 * single fetches for one table and no way for the tab to answer anything about
 * the list as a whole (the summary line is exactly such a question). The tab
 * now reads every row's values in two batched subscriptions and hands them down
 * — the shape `part-vendors-tab-row` already uses.
 *
 * Title, SKU and image come off the list payload (`displayName`,
 * `secondaryInfo`, `avatarUrl`), never a second field-value read.
 */
function ProductPartRow({
  record,
  recordId,
  values,
  iconId,
  color,
  canEdit,
  onDetach,
}: ProductPartRowProps) {
  const href = useRecordLink(recordId)
  const { cost, quantityOnHand, kind, priceCents, catalogItemCount, priceLoaded } = values
  const kindMeta = kind ? PART_KIND_BY_VALUE[kind] : undefined
  const title = record.displayName ?? 'Untitled'

  return (
    <TableRow>
      <TableCell className='font-medium'>
        <div className='flex items-center gap-2'>
          <RecordIcon avatarUrl={record.avatarUrl} iconId={iconId} color={color} size='sm' />
          <div className='flex min-w-0 flex-col'>
            {href ? (
              <Link href={href} className='truncate hover:underline'>
                {title}
              </Link>
            ) : (
              <span className='truncate'>{title}</span>
            )}
            {record.secondaryInfo && (
              <span className='truncate text-xs text-muted-foreground'>{record.secondaryInfo}</span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        {kindMeta ? (
          <Badge variant={(kindMeta.color ?? 'gray') as Variant} size='xs'>
            {kindMeta.label}
          </Badge>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        <VariantPriceCell
          priceCents={priceCents}
          catalogItemCount={catalogItemCount}
          priceLoaded={priceLoaded}
        />
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {cost != null ? formatCurrency(cost) : <span className='text-muted-foreground'>—</span>}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {quantityOnHand != null ? quantityOnHand : <span className='text-muted-foreground'>—</span>}
      </TableCell>
      <TableCell>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon-sm'>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {/* Clears `part_product` only — the part is never deleted. */}
              <DropdownMenuItem onClick={onDetach}>
                <Unlink />
                Remove from product
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  )
}

/**
 * The Price cell's three answers: a price, "n items" when the part carries
 * price tiers, and a dash for everything else — including while hop 2 is still
 * in flight, which must never render as a zero.
 */
function VariantPriceCell({
  priceCents,
  catalogItemCount,
  priceLoaded,
}: Pick<VariantRowValues, 'priceCents' | 'catalogItemCount' | 'priceLoaded'>) {
  if (catalogItemCount > 1) {
    return (
      <span className='text-xs text-muted-foreground'>
        {catalogItemCount} {pluralize(catalogItemCount, 'item')}
      </span>
    )
  }
  if (!priceLoaded || priceCents == null) return <span className='text-muted-foreground'>—</span>
  return <>{formatCurrency(priceCents)}</>
}
