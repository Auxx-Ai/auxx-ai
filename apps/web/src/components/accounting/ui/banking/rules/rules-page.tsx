// apps/web/src/components/accounting/ui/banking/rules/rules-page.tsx
'use client'

// Accounting > Banking > Rules (plans/accounting/ui-plan.md §2.8,
// plans/bank-connection/03-categorization-and-gl.md §4, HANDOFF slot 3C).
//
// ## What this screen is for
//
// Suggest-from-history is the PRIMARY categorisation mechanism - Stripe FC has
// no merchant enrichment and no categories, so "the last N lines matching this
// key were coded to 6100" is the strongest signal available before a single
// rule exists. A `bank_rule` is the opt-in, ORDERED layer a reviewer adds once
// a pattern is confirmed. This page lists them, lets a person add, edit,
// disable or delete one, and runs suggestions over the queue on demand.
//
// ## ⚠️ Departure: a TreeRowList, not `RecordsView`
//
// A rule is not a record a person browses with columns, filters and saved
// views - it is a short, ordered list of sentences ("match key contains
// MONTHLY SVC FEE, money out, code 6100") whose whole value is being readable
// at a glance. The registry table renders one field per column and cannot state
// the match and the action as one line, so this is a `TreeRowList` over
// `bankingRules.list`, the same shape the review queue and the journal's
// entries list use.
//
// 🛑 `autoApply` is off by default and the dialog explains why: a rule that
// silently posts to the ledger is a rule that silently posts a WRONG entry, and
// once a period is locked that is a reversal, not an edit.

import type { BankRuleRecord } from '@auxx/lib/banking/rules/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { ListChecks, Pencil, Plus, Power, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import SettingsPage from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { BankRuleDialog } from './bank-rule-dialog'
import { describeRule } from './bank-rule-options'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Banking' },
  { title: 'Rules' },
]

const PAGE_DESCRIPTION =
  'Repeating categorisation decisions, applied in priority order. Suggest-from-history covers most lines on its own; a rule is for a pattern worth encoding by hand.'

/** The list frame never collapses below this, however short the viewport is. */
const MIN_FRAME_HEIGHT = 200

/**
 * The exact room left under `SettingsPage`'s sticky header, in px.
 *
 * `SettingsPage` publishes `--settings-viewport-h` and `--settings-sticky-top`
 * on its scroll viewport, but the breadcrumb bar sits ABOVE the sticky block and
 * is in neither number - subtracting only the sticky top overshoots by the
 * breadcrumb's height and the page grows a scrollbar it should not have. So the
 * offset is measured from the element itself: its distance from the viewport's
 * scrolled top is breadcrumbs + header, whatever they happen to be on this page.
 */
function useViewportFill(ref: React.RefObject<HTMLDivElement | null>): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const viewport = el.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return

    const measure = () => {
      const offset =
        el.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
      setHeight(Math.max(MIN_FRAME_HEIGHT, viewport.clientHeight - offset))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    // The breadcrumb bar and the sticky header both shift the offset when they
    // reflow (a wrapped description, a narrower window), and neither resizes the
    // viewport when it happens. Observing this element itself would loop.
    for (const sibling of Array.from(viewport.children)) {
      if (!sibling.contains(el)) observer.observe(sibling)
    }
    return () => observer.disconnect()
  }, [ref])

  return height
}

export function BankingRulesPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BankRuleRecord | null>(null)

  const frameRef = useRef<HTMLDivElement>(null)
  const frameHeight = useViewportFill(frameRef)

  const rulesQuery = api.bankingRules.list.useQuery()
  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data])

  const accountsQuery = api.banking.bankAccount.list.useQuery()
  const resolveAccountName = useCallback(
    (id: string) =>
      (accountsQuery.data ?? []).find((account) => account.id === id)?.name ?? undefined,
    [accountsQuery.data]
  )

  const runSuggestions = api.bankingRules.runSuggestions.useMutation({
    onError: (error) => {
      toastError({ title: 'Error running suggestions', description: error.message })
    },
  })

  const updateRule = api.bankingRules.update.useMutation({
    onSuccess: async () => {
      await utils.bankingRules.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error updating rule', description: error.message })
    },
  })

  const deleteRule = api.bankingRules.delete.useMutation({
    onSuccess: async () => {
      await utils.bankingRules.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting rule', description: error.message })
    },
  })

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (rule: BankRuleRecord) => {
    setEditing(rule)
    setDialogOpen(true)
  }

  const handleDelete = async (rule: BankRuleRecord) => {
    const confirmed = await confirm({
      title: 'Delete rule?',
      description: `Remove "${rule.name}"? Lines it already coded stay as they are. This action cannot be undone.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    deleteRule.mutate({ id: rule.id })
  }

  const isEmpty = !rulesQuery.isPending && rules.length === 0

  return (
    <SettingsPage
      title='Rules'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}
      button={
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            loading={runSuggestions.isPending}
            loadingText='Running...'
            onClick={() => runSuggestions.mutate({})}>
            <Sparkles />
            Run suggestions now
          </Button>
          <Button size='sm' onClick={openCreate}>
            <Plus />
            New rule
          </Button>
        </div>
      }>
      <div ref={frameRef} className='p-4' style={{ height: frameHeight }}>
        <div className='flex h-full flex-col overflow-hidden rounded-xl border bg-background'>
          {isEmpty ? (
            <EmptyState
              icon={ListChecks}
              title='No rules yet'
              description='Suggest-from-history already proposes an account for a line it has seen before. Add a rule once a pattern is confirmed and you want it applied every time.'
              button={
                <Button variant='outline' onClick={openCreate}>
                  <Plus />
                  New rule
                </Button>
              }
            />
          ) : (
            <ScrollArea className='min-h-0 flex-1'>
              <div className='flex flex-col p-2'>
                <TreeRowList
                  items={rules}
                  loading={rulesQuery.isPending}
                  skeletonCount={4}
                  getKey={(rule: BankRuleRecord) => rule.id}
                  renderRow={(rule: BankRuleRecord) => (
                    <TreeRow
                      className={TREE_SECONDARY_NOTRUNCATE}
                      icon={<ListChecks className='size-4' />}
                      title={<span className='truncate text-sm'>{rule.name}</span>}
                      secondary={
                        <span className='flex flex-wrap items-center gap-1.5'>
                          <span className='text-muted-foreground text-xs'>
                            {describeRule(rule, resolveAccountName)}
                          </span>
                          {rule.autoApply && (
                            <Badge variant='amber' size='xs'>
                              Auto-apply
                            </Badge>
                          )}
                          {!rule.enabled && (
                            <Badge variant='outline' size='xs'>
                              Disabled
                            </Badge>
                          )}
                          {rule.appliedCount > 0 && (
                            <span className='text-muted-foreground text-xs'>
                              applied {rule.appliedCount} times
                            </span>
                          )}
                        </span>
                      }
                      onToggleOpen={() => openEdit(rule)}
                      actions={
                        <>
                          <TreeRowButton tooltipText='Edit rule' onClick={() => openEdit(rule)}>
                            <Pencil />
                          </TreeRowButton>
                          <TreeRowButton
                            tooltipText={rule.enabled ? 'Disable rule' : 'Enable rule'}
                            onClick={() =>
                              updateRule.mutate({ id: rule.id, enabled: !rule.enabled })
                            }>
                            <Power />
                          </TreeRowButton>
                          <TreeRowButton
                            variant='destructive'
                            tooltipText='Delete rule'
                            onClick={() => void handleDelete(rule)}>
                            <Trash2 />
                          </TreeRowButton>
                        </>
                      }
                    />
                  )}
                />
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      <BankRuleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} rule={editing} />
      <ConfirmDialog />
    </SettingsPage>
  )
}
