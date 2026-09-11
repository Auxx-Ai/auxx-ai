// apps/web/src/components/accounting/ui/settings/recurring-templates-settings-page.tsx
'use client'

// Accounting > Settings > Recurring templates (task 21 §1.6).
//
// Settings rather than a tab on the ledger page, and the brief says why: a
// template is CONFIGURATION, not a posting. It sits beside Opening balances
// and Payment gateways, which are the other two screens that decide what lands
// in the books without being a book entry themselves.
//
// 🛑 Every write here is `ledgerControl`. A schedule decides what the sweep
// puts in the books every month with nobody pressing anything, which is the
// same authority `setLockedThrough` takes. A bookkeeper with `ledgerPost`
// still reviews and posts each generated draft.

import { weekStartToIndex } from '@auxx/lib/availability/client'
import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import type { RecurrencePattern } from '@auxx/lib/recurrence/client'
import { toastError } from '@auxx/ui/components/toast'
import { Lock } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useRegisterDockedPanels } from '~/components/global/docked-panels-outlet'
import { EmptyState } from '~/components/global/empty-state'
import { MasterDetailSplit } from '~/components/global/master-detail-split'
import SettingsPage from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useSettings } from '~/hooks/use-settings'
import { useRequireCapability } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { JournalEntryDrawer } from '../journal/journal-entry-drawer'
import { RecurringTemplateScheduleEditor } from './recurring-template-schedule-editor'
import { type RecurringTemplateRow, RecurringTemplatesList } from './recurring-templates-list'

const BREADCRUMBS = [
  { title: 'Accounting', href: '/app/accounting' },
  { title: 'Settings' },
  { title: 'Recurring templates' },
]

const PAGE_DESCRIPTION =
  'Entries that repeat - a monthly depreciation figure, an accrual reversal, a prepaid schedule. A template posts nothing itself: a nightly sweep copies it into a draft for each month it owes, and you review and post those. A month that is closed HOLDS the entry rather than skipping it.'

export function RecurringTemplatesSettingsPage() {
  // 🛑 `ledgerControl`, not `ledgerView`. Every control on this page is a
  // write, and the page has no read-only rendering - a lower gate would hand a
  // viewer live controls the server then refuses one by one. Same rung
  // `payment-gateways-settings-page.tsx` argues for its own mapping.
  useRequireCapability(PermissionKey.ledgerControl)
  const { hasAccess } = useFeatureFlags()
  const utils = api.useUtils()

  const [selectedIdParam, setSelectedId] = useQueryState('template')
  // `?edit=new` opens the drawer on a template that does not exist yet;
  // `?edit=<id>` opens it on one that does. The selection stays in the URL for
  // the reason the gateway screen keeps its own there: this is a screen people
  // are sent to, and a pane that vanishes on refresh cannot be linked to.
  const [editParam, setEdit] = useQueryState('edit')
  const [confirm, ConfirmDialog] = useConfirm()
  // Shared with the ledger page's own `JournalEntryDrawer` so a resize on one
  // screen carries to the other.
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  const templates = api.ledger.recurringTemplate.list.useQuery()
  const rows = useMemo(() => (templates.data ?? []) as RecurringTemplateRow[], [templates.data])

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStart =
    (getSetting('organization.weekStart') as string) === 'sunday' ? 'sunday' : 'monday'
  const weekStartIndex = weekStartToIndex(weekStart)

  const selectedId =
    selectedIdParam &&
    (templates.isPending || rows.some((row) => row.template.id === selectedIdParam))
      ? selectedIdParam
      : null
  const selected = useMemo(
    () => rows.find((row) => row.template.id === selectedId) ?? null,
    [rows, selectedId]
  )

  const invalidate = useCallback(async () => {
    await utils.ledger.recurringTemplate.list.invalidate()
  }, [utils])

  // 🛑 Refusals are surfaced VERBATIM. `setRecurringJournalSchedule` says which
  // cross-field rule failed, or that the org has no book time zone; "Could not
  // save" throws that away.
  const setSchedule = api.ledger.recurringTemplate.setSchedule.useMutation({
    onSuccess: invalidate,
    onError: (error) => {
      toastError({ title: 'Error saving the schedule', description: error.message })
    },
  })

  const clearSchedule = api.ledger.recurringTemplate.clearSchedule.useMutation({
    onSuccess: invalidate,
    onError: (error) => {
      toastError({ title: 'Error removing the schedule', description: error.message })
    },
  })

  const handleSave = useCallback(
    (pattern: RecurrencePattern) => {
      if (!selectedId) return
      setSchedule.mutate({ templateId: selectedId, pattern })
    },
    [selectedId, setSchedule]
  )

  const handleClear = useCallback(async () => {
    if (!selected) return
    const confirmed = await confirm({
      title: 'Stop this template repeating?',
      description:
        'Entries it has already generated stay exactly where they are, posted or draft - only the schedule goes. The template itself is kept, so you can start it again later.',
      confirmText: 'Stop repeating',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    clearSchedule.mutate({ templateId: selected.template.id })
  }, [selected, confirm, clearSchedule])

  // The SAME drawer the ledger page uses, in template mode: it hides Preview
  // and Post, because `postJournalEntry` refuses a stencil by name. The
  // schedule is not in it - a rule needs a saved record to hang off and the
  // drawer defers its create to the first edit, so the repeat editor lives in
  // the pane behind this.
  const drawer = useMemo(
    () => (
      <JournalEntryDrawer
        journalEntryId={editParam && editParam !== 'new' ? editParam : null}
        isNew={editParam === 'new'}
        open={!!editParam}
        onOpenChange={(open) => {
          if (!open) void setEdit(null)
        }}
        isDocked={isDocked}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        currencyCode='USD'
        defaultDate={new Date().toISOString().slice(0, 10)}
        kind='recurring_template'
        onCreated={(id) => {
          void setEdit(id)
          void setSelectedId(id)
          void invalidate()
        }}
        onPosted={() => {}}
        onOpenPosting={() => {}}
        onDiscarded={() => {
          void setEdit(null)
          void setSelectedId(null)
          void invalidate()
        }}
      />
    ),
    [editParam, isDocked, dockedWidth, setDockedWidth, setEdit, setSelectedId, invalidate]
  )

  // The Accounting settings LAYOUT owns the one `MainPageContent`, so the
  // docked panel is published to its outlet rather than passed as a prop
  // (`docked-panels-outlet.tsx`) - same recipe `review-queue-page.tsx` uses.
  const panels = useMemo(
    () => [
      {
        key: 'recurring-je',
        open: !!editParam,
        content: drawer,
        width: { value: dockedWidth, set: setDockedWidth, min: 420, max: 800 },
      },
    ],
    [editParam, drawer, dockedWidth, setDockedWidth]
  )
  const { dockedPanels, overlays } = useDockedPanels(panels)
  useRegisterDockedPanels(dockedPanels)

  if (!hasAccess(FeatureKey.accounting)) {
    return (
      <SettingsPage
        title='Recurring templates'
        description={PAGE_DESCRIPTION}
        breadcrumbs={BREADCRUMBS}>
        <EmptyState
          icon={Lock}
          title='Accounting Not Available'
          description='Upgrade your plan to keep books in Auxx.'
          button={<div className='h-12' />}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage
      title='Recurring templates'
      description={PAGE_DESCRIPTION}
      breadcrumbs={BREADCRUMBS}>
      <MasterDetailSplit
        id='accounting-recurring-templates'
        pane={
          <RecurringTemplateScheduleEditor
            row={selected}
            weekStart={weekStart}
            weekStartIndex={weekStartIndex}
            saving={setSchedule.isPending}
            clearing={clearSchedule.isPending}
            onSave={handleSave}
            onClear={handleClear}
            onEditLines={() => selected && void setEdit(selected.template.id)}
          />
        }
        paneTitle='Schedule'
        paneOpen={!!selected}
        onPaneClose={() => setSelectedId(null)}>
        <RecurringTemplatesList
          templates={rows}
          weekStart={weekStart}
          isLoading={templates.isPending}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={() => setEdit('new')}
        />
      </MasterDetailSplit>

      {overlays}

      <ConfirmDialog />
    </SettingsPage>
  )
}
