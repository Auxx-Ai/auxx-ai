// apps/web/src/components/drawers/cards/part-pricing-card.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { pluralize } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useRecord, useRecordList, useResourceProperty } from '~/components/resources'
import { useCreateRecord } from '~/components/resources/hooks/use-create-record'
import { useSaveSystemValues } from '~/components/resources/hooks/use-save-system-values'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { deriveSellableCardState, type SellableCatalogItem } from './part-sellable-state'

/** The part's own card-relevant field — drives only the nudge, never the derivation. */
const PART_ATTRIBUTES = ['part_kind'] as const

/** The backing catalog item's card-relevant fields, batched per record. */
const ITEM_ATTRIBUTES = [
  'catalog_item_name',
  'catalog_item_active',
  'catalog_item_default_unit_price',
  'catalog_item_cost',
  'catalog_item_markup',
] as const

/** The catalog surface the compact list links to (has_many case). */
const CATALOG_SETTINGS_HREF = '/app/dispatch/settings/products'

/**
 * Sellable toggle / pricing row for the part drawer's overview
 * (plans/products/01-product-family.md §6.1).
 *
 * "Sellable" is DERIVED, never stored: checked iff an ACTIVE `catalog_item`
 * backs this part. The states, decided in review (the earlier "Sell this"
 * button was rejected):
 *
 * - **No catalog item**: renders nothing — UNLESS `part_kind` is
 *   `finished_good`, where the empty state renders prominently ("no price
 *   set") and checking the toggle reveals a price input whose save CREATES the
 *   backing item inline (name defaulted from the part, linked via
 *   `catalog_item_part`). The merchant never learns the catalog is a separate
 *   table.
 * - **One item**: the toggle. Unchecking writes `catalog_item_active = false`
 *   (never a delete — quotes and line items reference it; and never
 *   `archivedAt`, which vanishes the item from `useCatalogItems` and breaks
 *   catalog-group resolution). Re-checking flips it back, price preserved —
 *   reversible, so no confirm dialog. While active, the price row edits
 *   `catalog_item_default_unit_price` through the same field-save path the
 *   catalog settings editor uses; cost/markup ride along read-only.
 * - **Multiple items** (the edge is has_many — price tiers): no toggle, a
 *   compact list with links. That merchant opted into catalog complexity.
 *
 * Reads: `useRecordList` on `catalog_item` filtered by `catalog_item:part`,
 * item fields via the batched `useSystemValuesForRecords`, `part_kind` via
 * `useSystemValues`. Writes: `useSaveSystemValues` on the ITEM's record for
 * active/price, `useCreateRecord` (the unified record-create, seeding this
 * card's own list via `appendCreated`) for the inline create.
 *
 * Registered as the `part:pricing` overview card (`drawer-config.ts` +
 * `drawer-tab-registry.tsx`) — `TabCardSection` owns the "Pricing" section
 * header and hides it when this renders nothing.
 */
export function PartPricingCard({ recordId }: DrawerTabProps) {
  const { entityInstanceId: partId } = parseRecordId(recordId)

  const { values } = useSystemValues(recordId, PART_ATTRIBUTES, { autoFetch: true })
  const partKind = values.part_kind

  // Every catalog item whose `catalog_item:part` relation names this part.
  const catalogDefId = useResourceProperty('catalog_item', 'id')
  const itemFilters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'part-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'part-match',
            fieldId: 'catalog_item:part' as ResourceFieldId,
            operator: 'is' as const,
            value: partId,
          },
        ],
      },
    ],
    [partId]
  )
  const {
    records,
    isLoading: isLoadingList,
    isLoadingRecords,
    appendCreated,
  } = useRecordList({
    entityDefinitionId: catalogDefId ?? '',
    filters: itemFilters,
    enabled: !!partId && !!catalogDefId,
  })

  const itemRecordIds = useMemo(
    () =>
      catalogDefId
        ? records.map((record) => toRecordId(catalogDefId, record.id))
        : ([] as RecordId[]),
    [catalogDefId, records]
  )
  const { valuesById, loadedById } = useSystemValuesForRecords(itemRecordIds, ITEM_ATTRIBUTES, {
    autoFetch: true,
    enabled: itemRecordIds.length > 0,
  })

  const items: SellableCatalogItem[] = useMemo(
    () =>
      records.map((record, index) => {
        const itemValues = valuesById[itemRecordIds[index] as string]
        return {
          id: record.id,
          name:
            (itemValues?.catalog_item_name as string | undefined) ??
            record.displayName ??
            undefined,
          // Missing value reads as the registry default (true) — same collapse
          // `useCatalogItems` applies.
          active: (itemValues?.catalog_item_active as boolean | null | undefined) ?? true,
          priceCents:
            (itemValues?.catalog_item_default_unit_price as number | null | undefined) ?? null,
        }
      }),
    [records, valuesById, itemRecordIds]
  )

  // The derived state may not render until every item's `active` has actually
  // been READ — undefined means not-yet-fetched, and a toggle guessed off
  // unfetched values flashes the wrong answer.
  const activeLoaded = itemRecordIds.every((id) => loadedById[id]?.catalog_item_active === true)
  const loaded = !!catalogDefId && !isLoadingList && !isLoadingRecords && activeLoaded

  const state = deriveSellableCardState({ loaded, items, partKind })

  // ── Writes ────────────────────────────────────────────────────────
  // Toggle + price save on the single backing item (the toggle state).
  const singleItemRecordId =
    state.kind === 'toggle' && catalogDefId ? toRecordId(catalogDefId, state.item.id) : undefined
  const { save: saveItem, isPending: isSavingItem } = useSaveSystemValues(singleItemRecordId)

  // Inline create for the finished-good offer state — the unified record
  // creation path (same `api.record.create` seam the catalog settings' phantom
  // draft uses). `appendCreated` seeds the new item straight into this card's
  // own list — both caches it is served from — so the derived toggle flips to
  // checked with zero refetch, and stays checked across a remount.
  const { record: partRecord } = useRecord({ recordId })
  const { create, isPending: isCreating } = useCreateRecord({
    entityDefinitionId: catalogDefId ?? '',
    appendCreated,
  })
  const [armed, setArmed] = useState(false)
  const [draftPriceCents, setDraftPriceCents] = useState<number | null>(null)

  const handleCreate = async () => {
    const name = partRecord?.displayName?.trim()
    if (!name || !catalogDefId) return
    await create({
      values: {
        catalog_item_name: name,
        catalog_item_category: 'material',
        catalog_item_active: true,
        catalog_item_taxable: true,
        catalog_item_part: recordId,
        ...(draftPriceCents !== null ? { catalog_item_default_unit_price: draftPriceCents } : {}),
      },
    })
    setArmed(false)
    setDraftPriceCents(null)
  }

  if (state.kind === 'hidden') return null

  // ── Multiple items: the compact list, no toggle ───────────────────
  if (state.kind === 'list') {
    return (
      <FieldPanel resizeId='part-pricing' defaultLabelWidth={130}>
        <FieldPanelRow title='Catalog items'>
          <div className='flex min-h-8 flex-col justify-center gap-0.5 py-1.5 text-sm'>
            <span className='text-xs text-muted-foreground'>
              {state.items.length} catalog {pluralize(state.items.length, 'item')} price this part —
              manage them in Dispatch Settings.
            </span>
            {state.items.map((item) => (
              <div key={item.id} className='flex items-center gap-2'>
                <Link href={CATALOG_SETTINGS_HREF} className='truncate hover:underline'>
                  {item.name ?? 'Untitled'}
                </Link>
                <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                  {item.priceCents !== null ? formatCurrency(item.priceCents) : 'No price'}
                </span>
                {!item.active && (
                  <Badge variant='gray' size='xs'>
                    Inactive
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </FieldPanelRow>
      </FieldPanel>
    )
  }

  // ── Offer (finished good, no item yet) + toggle states ────────────
  const toggleItem = state.kind === 'toggle' ? state.item : undefined
  const itemValues = singleItemRecordId ? valuesById[singleItemRecordId] : undefined
  const itemCost = (itemValues?.catalog_item_cost as number | null | undefined) ?? null
  const itemMarkup = (itemValues?.catalog_item_markup as number | null | undefined) ?? null

  const checked = toggleItem ? toggleItem.active : armed
  const showOfferNudge = state.kind === 'offer' && !armed
  const showInactiveNudge = state.kind === 'toggle' && state.showNudge

  return (
    <div className='space-y-2'>
      <FieldPanel resizeId='part-pricing' defaultLabelWidth={130}>
        <FieldPanelRow title='Sellable'>
          <div className='flex min-h-8 flex-wrap items-center gap-2'>
            <FieldInputAdapter
              fieldType={FieldType.CHECKBOX}
              fieldOptions={{ variant: 'switch' }}
              value={checked}
              disabled={isSavingItem || isCreating}
              onChange={(value) => {
                const next = value as boolean
                if (toggleItem) {
                  // Standard field save — never a delete: inactive items stay
                  // out of the picker but keep historical lines, and re-check
                  // flips them back with the price preserved.
                  void saveItem({ catalog_item_active: next })
                } else {
                  setArmed(next)
                }
              }}
            />
            {toggleItem && !toggleItem.active && (
              <span className='text-xs text-muted-foreground'>
                Hidden from the catalog picker — re-check to sell again, price preserved.
              </span>
            )}
          </div>
        </FieldPanelRow>

        {/* Offer state, armed: the price input whose save creates the backing
            catalog item inline. */}
        {state.kind === 'offer' && armed && (
          <FieldPanelRow title='Price'>
            <div className='flex flex-1 items-center gap-2'>
              <FieldInputAdapter
                fieldType={FieldType.CURRENCY}
                value={draftPriceCents}
                onChange={(value) => setDraftPriceCents((value as number | undefined) ?? null)}
                placeholder='0.00'
              />
              <Button
                variant='outline'
                size='xs'
                loading={isCreating}
                loadingText='Saving...'
                disabled={!partRecord?.displayName?.trim()}
                onClick={() => void handleCreate()}>
                Save
              </Button>
            </div>
          </FieldPanelRow>
        )}

        {/* Checked: the price row, editing the backing item through the same
            field-save path the catalog settings editor uses. */}
        {toggleItem?.active && (
          <>
            {itemCost !== null && (
              <FieldPanelRow title='Cost'>
                <div className='flex min-h-8 items-center gap-2 text-sm tabular-nums'>
                  {formatCurrency(itemCost)}
                  <span className='text-xs font-normal text-muted-foreground'>
                    Synced from the part
                  </span>
                </div>
              </FieldPanelRow>
            )}
            {/* 02 §5.1 follow model: for a Shopify-backed part the "follows
                Shopify" badge and the price-override control attach on this
                row (and the toggle above locks ON as "Listed on Shopify").
                Not built yet — the connector sink doesn't own catalog items
                until plans/products/02-shopify-mapping.md lands. */}
            <FieldPanelRow title='Price'>
              <div className='flex flex-1 items-center gap-2'>
                <FieldInputAdapter
                  fieldType={FieldType.CURRENCY}
                  value={toggleItem.priceCents}
                  onChange={(value) =>
                    void saveItem({
                      catalog_item_default_unit_price: (value as number | undefined) ?? null,
                    })
                  }
                  placeholder='0.00'
                />
                {itemMarkup !== null && (
                  <Badge variant='blue' size='xs'>
                    Auto
                  </Badge>
                )}
              </div>
            </FieldPanelRow>
          </>
        )}
      </FieldPanel>

      {/* The partKind nudge — the ONLY kind interplay (§6.1): for a finished
          good, no active catalog item is almost certainly an omission. */}
      {(showOfferNudge || showInactiveNudge) && (
        <div className='flex items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-2.5'>
          <Sparkles className='size-4 shrink-0 text-amber-600' />
          <p className='flex-1 text-xs text-muted-foreground'>
            <span className='font-medium text-foreground'>
              {showOfferNudge ? 'No price set' : 'Not sellable'}
            </span>{' '}
            {showOfferNudge
              ? "— this finished good isn't sellable yet. Check Sellable to set a price."
              : "— this finished good's catalog item is inactive. Re-check Sellable to sell it again."}
          </p>
        </div>
      )}
    </div>
  )
}
