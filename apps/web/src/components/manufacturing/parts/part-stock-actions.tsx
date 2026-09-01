// apps/web/src/components/manufacturing/parts/part-stock-actions.tsx
'use client'

// The three ways a part drawer moves stock, behind one `Actions` button
// (plans/money/tasks/23-build-from-the-part.md §2).
//
// 🛑 **This is ONE popover with two panes, and it is not a dropdown menu.** The
// first cut was a `DropdownMenu` whose items opened three separate popovers
// anchored on the menu's trigger. It opened and closed in the same tick, and
// after the anchoring was fixed it worked only *sometimes* — which is the shape
// of a race, not of a layout bug. Two Radix dismissable layers were tearing down
// and standing up on the same click: the menu's close, the popover's open, and a
// pointer event that belonged to both.
//
// So there is one layer. The `Actions` button opens a popover whose content is a
// three-item list; choosing one swaps that SAME popover's content for the form,
// with a back arrow. Nothing unmounts under the pointer, there is no second
// layer to race, and the anchor never moves.
//
// The three forms are mounted as panes rather than wrapped in popovers of their
// own — `ReceiveStockForm`, `StockAdjustmentForm`, `BuildPartForm`. Each resets
// by unmounting, which a pane swap gives for free.

import { resolvePartKind } from '@auxx/lib/builds/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { menuItemStyles } from '@auxx/ui/components/menu-styles'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CompleteBuildDialog } from '~/components/manufacturing/builds/complete-build-dialog'
import { useRecordList, useResourceProperty } from '~/components/resources'
import { useAccess } from '~/providers/capabilities-provider'
import { BuildPartForm, type PlannedBuild, useBuildRefresh } from './build-part-form'
import { ReceiveStockForm } from './receive-stock-popover'
import { StockAdjustmentForm } from './stock-adjustment-popover'

/** Which of the three write forms the Actions popover is showing. */
type StockAction = 'receive' | 'adjust' | 'build'

const PANE_TITLE: Record<StockAction, string> = {
  receive: 'Receive Stock',
  adjust: 'Adjust Stock',
  build: 'Build',
}

interface PartStockActionsProps {
  /** The part's entityInstanceId. */
  partId: string
  /** Current quantity on hand, for the adjustment form's "Set to" mode. */
  currentQoH: number
  /** The part's stored `part_kind`, read once by the card that owns this. */
  partKind: string | undefined
  /** Called after anything that moved this part's stock. */
  onSuccess: () => void
}

/**
 * `Receive` / `Adjust` / `Build` in one dropdown-shaped popover.
 *
 * 🛑 **One popover, not a button row** (§2.1). `Receive` and `Adjust` lose one
 * click; `Build` gains one it never had — it did not exist on this surface at
 * all, and `builds.create` had no caller in the browser anywhere. The trigger
 * reads the word `Actions` rather than a bare ellipsis because the whole point of
 * the change is that Build was undiscoverable, and an icon with no word is how it
 * stays that way.
 */
export function PartStockActions({
  partId,
  currentQoH,
  partKind,
  onSuccess,
}: PartStockActionsProps) {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<StockAction | null>(null)
  /** The run `Plan and open...` raised, waiting for the completion dialog. */
  const [completing, setCompleting] = useState<PlannedBuild | null>(null)

  const stockMovementDefId = useResourceProperty('stock_movement', 'id')
  const buildDefId = useResourceProperty('build', 'id')
  const subpartDefId = useResourceProperty('subpart', 'id')

  // The client mirror of what `routers/builds.ts` asserts, so the item the UI
  // hides and the door the server closes are the same door. `Plan` needs `build`
  // alone (B2 — planning is not moving stock); `Build now` also needs
  // `stock_movement`, which is where the rest of manufacturing puts that
  // authority.
  const { canEditEntity } = useAccess()
  const canPlanBuild = !!buildDefId && canEditEntity(buildDefId)
  const canPostLedger = canPlanBuild && !!stockMovementDefId && canEditEntity(stockMovementDefId)

  // Whether the part has a bill of materials at all. Same filter shape as
  // `part-costing-card.tsx`'s `hasSubparts` check, deliberately — same read,
  // same question.
  const subpartFilters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'parent-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'parent-match',
            fieldId: 'subpart:parentPart' as ResourceFieldId,
            operator: 'is' as const,
            value: partId,
          },
        ],
      },
    ],
    [partId]
  )
  const { records: subpartRecords } = useRecordList({
    entityDefinitionId: subpartDefId ?? '',
    filters: subpartFilters,
    limit: 1,
    enabled: !!partId && !!subpartDefId,
  })

  const hasSubparts = subpartRecords.length > 0
  const isPurchased = resolvePartKind(partKind) === 'component'
  const canBuild = hasSubparts && !isPurchased && canPlanBuild

  const refreshBuilds = useBuildRefresh(onSuccess)

  /**
   * Reset to the menu on OPEN rather than on close.
   *
   * `PopoverContent` animates out, so clearing the pane as it closes would show
   * the person the menu sliding away instead of the form they were just in.
   */
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) setPane(null)
  }

  const close = () => setOpen(false)

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button variant='outline' size='xs'>
            Actions
            <ChevronDown />
          </Button>
        </PopoverTrigger>
        {/* 🛑 `p-0`, and the padding pushed inward onto the header and the
            scroll viewport's own content. That is what puts the scrollbar on
            the popover's EDGE instead of floating it inside a padded box, and
            what lets the menu pane match `DropdownMenuContent` exactly — which
            is `p-1` with `px-2 py-1` items, not the popover's default `p-4`. */}
        <PopoverContent className={cn(pane ? 'w-96 p-0' : 'w-52 p-1')} align='end'>
          {pane === null ? (
            <div className='flex flex-col'>
              <ActionItem onSelect={() => setPane('receive')}>Receive</ActionItem>
              <ActionItem onSelect={() => setPane('adjust')}>Adjust</ActionItem>
              {/* 🛑 The two inputs are keyed in the OPPOSITE order to the
                  server's, deliberately. `createBuild` checks `part_kind` first
                  and the BOM second; this checks the BOM first, because BOM
                  presence is a structural fact while `part_kind` is a field
                  somebody has to remember. Hidden rather than disabled with no
                  BOM, because 82% of parts are components with no BOM and a
                  permanently dead item on four parts in five is noise.
                  Shown-but-disabled when the part HAS a BOM and still reads
                  `component`, because since the derivation landed that state
                  means somebody overrode the rule — a real answer the person is
                  entitled to see, not an accident. */}
              {hasSubparts && (
                <ActionItem
                  disabled={isPurchased || !canPlanBuild}
                  hint={isPurchased ? 'This part is classified as purchased' : undefined}
                  onSelect={() => setPane('build')}>
                  Build
                </ActionItem>
              )}
            </div>
          ) : (
            <div className='flex flex-col'>
              <div className='flex shrink-0 items-center gap-1 px-2 pt-2'>
                <Button
                  variant='ghost'
                  size='xs'
                  aria-label='Back to actions'
                  onClick={() => setPane(null)}>
                  <ChevronLeft />
                </Button>
                <h4 className='font-semibold text-sm'>{PANE_TITLE[pane]}</h4>
              </div>

              {/* The header stays put and the FORM scrolls. `Build` is the pane
                  that needs it — fields, then a line per component, then the
                  shortage and missing-cost warnings, then the cost summary, then
                  four buttons — but a receipt with six rows overflows a short
                  viewport too, so the cap is on the pane rather than on one of
                  them.
                  🛑 The cap is the popover's OWN available height minus the
                  header, on the viewport, and both halves of that matter.

                  A fixed `60vh` was wrong because it is a second, independent
                  limit inside `PopoverContent`'s
                  `max-h-[var(--radix-popover-content-available-height)]`: when
                  the window got short the popover clipped at its limit while the
                  viewport still claimed 60vh, so the buttons at the bottom could
                  be neither seen nor scrolled to.

                  `flex-1 min-h-0` was wrong too, and less obviously: it makes
                  the scroll height depend on the flex column resolving a
                  definite height from a `max-height`-only parent, which holds
                  while there is room and stops holding at exactly the sizes that
                  need it. Radix sets the var on this element and CSS variables
                  inherit, so `calc(...)` gives the viewport ONE definite cap
                  that tracks the real space and needs nothing from the layout.
                  `2.75rem` is the header row above it.

                  `noFade` because the default mask dissolves the top field and
                  the buttons at the bottom, which on a form reads as a rendering
                  fault rather than as an affordance. */}
              <ScrollArea
                noFade
                viewportClassName='max-h-[calc(var(--radix-popover-content-available-height,60vh)-2.75rem)]'
                scrollbarClassName='w-1'
                allowScrollChaining>
                <div className='space-y-3 px-3 pt-1 pb-3'>
                  {pane === 'receive' && (
                    <ReceiveStockForm partId={partId} onSuccess={onSuccess} onDone={close} />
                  )}
                  {pane === 'adjust' && (
                    <StockAdjustmentForm
                      partId={partId}
                      currentQoH={currentQoH}
                      onSuccess={onSuccess}
                      onDone={close}
                    />
                  )}
                  {pane === 'build' && canBuild && (
                    <BuildPartForm
                      partId={partId}
                      canPostLedger={canPostLedger}
                      onSuccess={onSuccess}
                      onDone={close}
                      onPlanAndOpen={setCompleting}
                    />
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* 🛑 Mounted HERE, outside the popover, because `Plan and open...` closes
          the popover as it raises the run — a dialog rendered inside the pane
          would unmount before it was ever seen. */}
      {completing && (
        <CompleteBuildDialog
          open
          onOpenChange={(next) => {
            if (!next) setCompleting(null)
          }}
          buildId={completing.buildId}
          partId={partId}
          quantityPlanned={completing.quantityPlanned}
          number={completing.number}
          onCompleted={refreshBuilds}
        />
      )}
    </>
  )
}

/**
 * One row of the menu pane.
 *
 * A plain button rather than a `DropdownMenuItem`: the whole reason this surface
 * is a popover is that it must not stack a menu layer on a popover layer.
 */
function ActionItem({
  children,
  hint,
  disabled,
  onSelect,
}: {
  children: React.ReactNode
  /** Why the item is disabled, shown under it. */
  hint?: string
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        menuItemStyles,
        'w-full text-start hover:bg-accent/50 focus-visible:bg-accent/50',
        hint && 'flex-col items-start gap-0'
      )}>
      {children}
      {hint && <span className='text-[10px] text-muted-foreground'>{hint}</span>}
    </button>
  )
}
