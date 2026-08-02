// apps/web/src/components/mail-filters/ui/mail-filter-dialog.tsx

'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import {
  MAIL_FILTER_ACTION_LABELS,
  type MailFilterAction,
  type MailFilterRow,
} from '@auxx/lib/mail-filters/client'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useMemo, useState } from 'react'
import { RuleDialogShell } from '~/components/rules/ui/rule-dialog-shell'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import type { AuthorableInboxOption } from '../hooks/use-mail-filter-lookups'
import { useMailFilterLookups } from '../hooks/use-mail-filter-lookups'
import { useMailFilterPreview } from '../hooks/use-mail-filter-preview'
import { useMailFilters } from '../hooks/use-mail-filters'
import { MailFilterActionsPage } from './mail-filter-actions-page'
import { MailFilterApplySection } from './mail-filter-apply-section'
import { MailFilterConfigurePage } from './mail-filter-configure-page'

interface MailFilterDialogProps {
  open: boolean
  onClose: () => void
  /** Null ⇒ create. */
  filter?: MailFilterRow | null
  /** The caller's authorable inboxes — the picker's whole universe (§5.1). */
  inboxes: AuthorableInboxOption[]
  /** Every filter the caller can see, for the "runs N of M" position line. */
  filters: MailFilterRow[]
  /** Preselected inbox for a create opened from a specific group. */
  defaultInboxId?: string
  /**
   * Seeded name for a create opened from an entry point (§6.3).
   *
   * ⚠️ Read once, when the dialog opens — pass a stable reference.
   */
  defaultName?: string
  /**
   * Seeded conditions for a create opened from the thread menu or the searchbar
   * (§6.3). Ignored on edit, where the stored conditions win.
   *
   * ⚠️ Read once, when the dialog opens — pass a stable reference (the entry
   * points freeze theirs in `useState`), or every render would re-seed the form
   * and wipe what the user just typed.
   */
  defaultConditions?: ConditionGroup[]
  /**
   * Banner rendered above the form — how a prefill differs from what the user
   * was looking at.
   *
   * Deliberately a visible slot rather than a tooltip: the searchbar's
   * `freeText` → `body contains` conversion changes which mail matches, and the
   * filter then MUTATES that mail (§6.3).
   */
  notice?: React.ReactNode
}

/**
 * Create/edit dialog for a mail filter — a two-page `RuleDialogShell` flow:
 * `configure` (name, inbox, conditions, order, stop-processing) → `actions`
 * (the shared ordered action editor over the mail catalog).
 *
 * This dialog owns all form state; the shell owns navigation only, exactly like
 * `RecordRuleDialog`. The preview/apply status bar is mounted as the shell's
 * footer so it persists onto the actions page, where Save lives.
 */
export function MailFilterDialog({
  open,
  onClose,
  filter,
  inboxes,
  filters,
  defaultInboxId,
  defaultName,
  defaultConditions,
  notice,
}: MailFilterDialogProps) {
  const { createFilter, updateFilter } = useMailFilters()
  const { can } = useAccess()
  const canRunAutomation = can('automationRules.manage')

  const [page, setPage] = useState<'configure' | 'actions'>('configure')
  const [name, setName] = useState('')
  const [inboxId, setInboxId] = useState('')
  const [groups, setGroups] = useState<ConditionGroup[]>([])
  const [actions, setActions] = useState<MailFilterAction[]>([])
  const [stopProcessing, setStopProcessing] = useState(false)
  const [selectedActionIndex, setSelectedActionIndex] = useState(0)
  const [applyRetroactively, setApplyRetroactively] = useState(false)

  const applyToExisting = api.mailFilters.applyRetroactively.useMutation({
    onError: (error) =>
      toastError({ title: 'Error applying filter to existing mail', description: error.message }),
  })

  // Re-seed form state whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    setPage('configure')
    setSelectedActionIndex(0)
    setApplyRetroactively(false)
    setName(filter?.name ?? defaultName ?? '')
    setInboxId(filter?.inboxId ?? defaultInboxId ?? '')
    setGroups(Array.isArray(filter?.conditions) ? filter.conditions : (defaultConditions ?? []))
    setActions(Array.isArray(filter?.actions) ? filter.actions : [])
    setStopProcessing(filter?.stopProcessing ?? false)
  }, [open, filter, defaultInboxId, defaultName, defaultConditions])

  const selectedInbox = inboxes.find((inbox) => inbox.id === inboxId)
  const isPersonalInbox = selectedInbox?.isPersonal ?? false

  const { tagOptions, agentOptions, workflowOptions, inboxOptions, resolveName } =
    useMailFilterLookups(inboxes)

  // Evaluation position, 1-based, within the filter's own inbox.
  const { position, totalInInbox } = useMemo(() => {
    const siblings = filters
      .filter((row) => row.inboxId === inboxId)
      .sort((a, b) => a.order - b.order)
    const index = filter ? siblings.findIndex((row) => row.id === filter.id) : -1
    return { position: index >= 0 ? index + 1 : null, totalInInbox: siblings.length }
  }, [filters, inboxId, filter])

  const nonEmptyGroups = useMemo(
    () => groups.filter((group) => (group.conditions?.length ?? 0) > 0),
    [groups]
  )

  const preview = useMailFilterPreview({
    inboxId,
    conditions: nonEmptyGroups,
    enabled: open,
  })

  /**
   * Switching to a SHARED inbox drops any `set-read` action.
   *
   * `set-read` is personal-inbox-only in v1 (§4.3) and the executor skips it on
   * a shared inbox, so leaving one behind saves a filter with an action that can
   * never do anything — the record-rules `stripSignalConditions` precedent.
   */
  const onInboxChange = (nextInboxId: string) => {
    setInboxId(nextInboxId)
    const nextIsPersonal = inboxes.find((inbox) => inbox.id === nextInboxId)?.isPersonal ?? false
    if (!nextIsPersonal) {
      setActions((prev) => {
        const next = prev.filter((action) => action.type !== 'set-read')
        if (next.length !== prev.length) {
          setSelectedActionIndex((cur) => Math.max(0, Math.min(cur, next.length - 1)))
        }
        return next
      })
    }
  }

  const updateAction = (index: number, next: MailFilterAction) =>
    setActions((prev) => prev.map((action, i) => (i === index ? next : action)))
  const removeAction = (index: number) =>
    setActions((prev) => {
      const next = prev.filter((_, i) => i !== index)
      setSelectedActionIndex((cur) => Math.max(0, Math.min(cur, next.length - 1)))
      return next
    })
  const addAction = () =>
    setActions((prev) => {
      const next: MailFilterAction[] = [...prev, { type: 'set-status', status: 'ARCHIVED' }]
      setSelectedActionIndex(next.length - 1)
      return next
    })

  const isPending = createFilter.isPending || updateFilter.isPending || applyToExisting.isPending
  const hasDefinition = name.trim() !== '' && inboxId !== ''
  // A filter with no actions is rejected by `assertFilterShape` ("needs at least
  // one action"), so Save stays disabled until the drill-in row is filled.
  const canSave = hasDefinition && actions.length > 0

  // Shared by both pages so the count + opt-in stay visible wherever Save is.
  const statusBar = (
    <MailFilterApplySection
      preview={preview}
      applyRetroactively={applyRetroactively}
      onApplyRetroactivelyChange={setApplyRetroactively}
      disabled={isPending}
    />
  )

  const actionLabels = useMemo(
    () => actions.map((action) => MAIL_FILTER_ACTION_LABELS[action.type] ?? action.type),
    [actions]
  )

  const handleSave = async () => {
    const payload = {
      name: name.trim(),
      conditions: nonEmptyGroups as unknown as unknown[],
      actions,
      stopProcessing,
    }

    const saved = filter
      ? await updateFilter.mutateAsync({ filterId: filter.id, ...payload })
      : await createFilter.mutateAsync({ ...payload, inboxId, enabled: true })

    // Retroactive apply runs AFTER the write, against the saved row — the job
    // re-reads the filter, so it can only ever apply what was actually stored.
    if (applyRetroactively && saved?.id) {
      await applyToExisting.mutateAsync({ filterId: saved.id })
    }
    onClose()
  }

  return (
    <RuleDialogShell
      open={open}
      onClose={onClose}
      title={filter ? 'Edit filter' : 'New filter'}
      description='Match new mail arriving in an inbox and act on it automatically.'
      rootCrumb={name.trim() || (filter ? 'Filter' : 'New filter')}
      page={page}
      onPageChange={(next) => setPage(next as 'configure' | 'actions')}
      pages={[
        {
          id: 'configure',
          title: 'Configure',
          size: 'lg',
          content: (
            <MailFilterConfigurePage
              notice={notice}
              name={name}
              onNameChange={setName}
              inboxId={inboxId}
              onInboxChange={onInboxChange}
              inboxOptions={inboxOptions}
              isEdit={!!filter}
              isPersonalInbox={isPersonalInbox}
              position={position}
              totalInInbox={totalInInbox}
              stopProcessing={stopProcessing}
              onStopProcessingChange={setStopProcessing}
              groups={groups}
              onGroupsChange={setGroups}
              actionLabels={actionLabels}
              onOpenActions={() => setPage('actions')}
              canSave={canSave}
              isPending={isPending}
              saveLabel={filter ? 'Save changes' : 'Create filter'}
              onSave={() => void handleSave()}
              onCancel={onClose}
              statusBar={statusBar}
            />
          ),
        },
        {
          id: 'actions',
          title: 'Actions',
          size: 'lg',
          content: (
            <MailFilterActionsPage
              actions={actions}
              selectedIndex={selectedActionIndex}
              onSelectedIndexChange={setSelectedActionIndex}
              onAdd={addAction}
              onRemove={removeAction}
              onUpdate={updateAction}
              tagOptions={tagOptions}
              agentOptions={agentOptions}
              workflowOptions={workflowOptions}
              inboxOptions={inboxOptions}
              isPersonalInbox={isPersonalInbox}
              canRunAutomation={canRunAutomation}
              resolveName={resolveName}
              isEdit={!!filter}
              canSave={canSave}
              isPending={isPending}
              onSave={() => void handleSave()}
              onCancel={onClose}
            />
          ),
        },
      ]}
    />
  )
}
