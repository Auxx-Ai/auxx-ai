// apps/web/src/components/mail-filters/ui/mail-filter-configure-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { getMailFilterFields } from '@auxx/lib/mail-filters/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Section } from '@auxx/ui/components/section'
import { Filter, ListFilter, Plus } from 'lucide-react'
import { useMemo } from 'react'
import {
  type Condition,
  ConditionContainer,
  ConditionProvider,
  type ConditionSystemConfig,
  useConditionActions,
} from '~/components/conditions'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { RuleActionsSummaryRow } from '~/components/rules/ui/rule-actions-summary-row'
import { useInboxIdentifierTypes } from '../hooks/use-inbox-identifier-types'

/** The provider drives groups here; the flat condition list stays empty. */
const EMPTY_CONDITIONS: Condition[] = []

const TRIGGER_COPY = 'When a new message arrives in this inbox'

interface MailFilterConfigurePageProps {
  /**
   * Banner above the form — how a prefilled filter differs from the thread or
   * search it was created from (§6.3). Rendered inline and always visible, never
   * behind a tooltip.
   */
  notice?: React.ReactNode
  name: string
  onNameChange: (value: string) => void
  inboxId: string
  onInboxChange: (inboxId: string) => void
  inboxOptions: SelectOption[]
  /**
   * True on edit. `inboxId` is not patchable — it is the containment boundary
   * AND the namespace `order` is unique within, so moving a filter is
   * delete-and-recreate (the router omits it from `update` on purpose).
   */
  isEdit: boolean
  /** True when the selected inbox is a personal mailbox — drives the `set-read` note. */
  isPersonalInbox: boolean
  /** 1-based evaluation position, and how many filters share this inbox. */
  position: number | null
  totalInInbox: number
  stopProcessing: boolean
  onStopProcessingChange: (value: boolean) => void
  groups: ConditionGroup[]
  onGroupsChange: (groups: ConditionGroup[]) => void
  /** Labels of the configured actions, for the drill-in summary row. */
  actionLabels: string[]
  /** Drill into the actions page. */
  onOpenActions: () => void
  /** Whole filter is complete (name + inbox + at least one action). */
  canSave: boolean
  isPending: boolean
  saveLabel: string
  onSave: () => void
  onCancel: () => void
  /** Preview strip, rendered directly above the Cancel/Save row. */
  statusBar?: React.ReactNode
}

/**
 * The mail-filter definition form: name, inbox, the fixed trigger, evaluation
 * position, the stop-processing switch and the shared condition builder.
 *
 * **No trigger picker.** A filter has exactly one trigger in v1 (D2), so it is
 * stated as copy rather than offered as a one-option select.
 *
 * The condition editor runs `ConditionProvider` over `getMailFilterFields()` —
 * the SAME field catalog and the same components the mail searchbar and mail
 * views use, deliberately. There is one condition language and one evaluator
 * (invariant 5), and a later phase hands a searchbar's `SearchCondition[]`
 * straight into this dialog, which only works while the two produce the same
 * shape.
 */
export function MailFilterConfigurePage({
  notice,
  name,
  onNameChange,
  inboxId,
  onInboxChange,
  inboxOptions,
  isEdit,
  isPersonalInbox,
  position,
  totalInInbox,
  stopProcessing,
  onStopProcessingChange,
  groups,
  onGroupsChange,
  actionLabels,
  onOpenActions,
  canSave,
  isPending,
  saveLabel,
  onSave,
  onCancel,
  statusBar,
}: MailFilterConfigurePageProps) {
  /**
   * The catalog, scoped to what the SELECTED inbox's channels can produce
   * (plan 09 §6). Recomputed on every inbox change — the combobox stays live
   * after a prefill — and never persisted.
   *
   * Fails OPEN by construction: `useInboxIdentifierTypes` returns an empty set
   * while `channel.list` is loading, when the caller may not read it, and when
   * the inbox has no channels, and an empty set means "hide nothing". A hidden
   * field is a convenience; a wrongly hidden one costs the author a condition
   * they cannot re-add.
   *
   * Fields the CURRENT filter already has a condition on are kept regardless,
   * or editing a filter written before a channel moved would silently drop
   * conditions out of the editor.
   */
  const identifierTypes = useInboxIdentifierTypes(inboxId)
  const usedFieldIds = useMemo(
    () => groups.flatMap((group) => group.conditions.map((c) => String(c.fieldId))),
    [groups]
  )
  const fieldDefinitions = useMemo(
    () => getMailFilterFields(identifierTypes, usedFieldIds),
    [identifierTypes, usedFieldIds]
  )

  const conditionConfig: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource',
      fields: fieldDefinitions,
      allowNesting: false,
      allowReordering: true,
      showLogicalOperators: true,
      showGrouping: true,
      allowGroupNaming: false,
      allowGroupCollapse: false,
      allowGroupReordering: true,
      showGroupSubtext: false,
      showGroupName: false,
      defaultGroupName: '',
      allowVarEditor: false,
      allowConstantToggle: false,
      allowCurrentUserPlaceholder: true,
      display: 'inline',
    }),
    [fieldDefinitions]
  )

  const positionText = isEdit
    ? position
      ? `Runs ${position} of ${totalInInbox} in this inbox`
      : 'Position unknown'
    : 'Runs last. New filters are added to the end of this inbox’s list'

  return (
    <form
      className='flex flex-col'
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) onSave()
      }}>
      {notice ? <div className='px-3 pt-3'>{notice}</div> : null}
      <Section title='Filter' icon={<Filter className='size-4' />} collapsible={false}>
        <FieldPanel className='p-0' breakpoint='md' resizeId='mail-filter'>
          <FieldPanelRow title='Name' isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={name}
              onChange={(v) => onNameChange(String(v ?? ''))}
              placeholder='e.g. Newsletters to Done'
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Inbox'
            isRequired
            description={
              isEdit
                ? 'A filter belongs to one inbox for its whole life. To move it, delete it and create it again on the other inbox.'
                : 'Only inboxes you may write filters for are listed.'
            }>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: inboxOptions }}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={inboxId}
              onChange={(v) => onInboxChange((Array.isArray(v) ? v[0] : v) as string)}
              placeholder='Select inbox'
              disabled={isEdit}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Trigger'>
            <p className='px-2 py-2 text-sm text-muted-foreground'>{TRIGGER_COPY}</p>
          </FieldPanelRow>

          <FieldPanelRow
            title='Order'
            description='Filters run top to bottom within their inbox. Change the order from the filter list with Move up / Move down.'>
            <p className='px-2 py-2 text-sm text-muted-foreground'>{positionText}</p>
          </FieldPanelRow>

          <FieldPanelRow
            title='Stop processing'
            description='When this filter matches, later filters in the same inbox are skipped.'>
            <FieldInputAdapter
              fieldType={FieldType.CHECKBOX}
              value={stopProcessing}
              onChange={(v) => onStopProcessingChange(Boolean(v))}
            />
          </FieldPanelRow>

          {inboxId !== '' && !isPersonalInbox && (
            <p className='px-2 py-2 text-xs text-muted-foreground'>
              This is a shared inbox, so “Mark read/unread” is not offered. Read state is per
              person, and there is no single member to mark a shared conversation read for.
            </p>
          )}
        </FieldPanel>
      </Section>

      {inboxId !== '' ? (
        <ConditionProvider
          conditions={EMPTY_CONDITIONS}
          groups={groups}
          config={conditionConfig}
          onConditionsChange={() => {}}
          onGroupsChange={onGroupsChange}
          getAvailableFields={() => fieldDefinitions}
          getFieldDefinition={(id) =>
            Array.isArray(id) ? undefined : fieldDefinitions.find((f) => f.id === id)
          }>
          <Section
            title='Conditions'
            icon={<ListFilter className='size-4' />}
            collapsible={false}
            actions={<AddGroupButton />}>
            <ConditionContainer
              emptyStateText='No conditions. The filter runs on every new message'
              showAddButton={false}
              showGrouping
            />
          </Section>
        </ConditionProvider>
      ) : (
        <Section title='Conditions' icon={<ListFilter className='size-4' />} collapsible={false}>
          <p className='text-sm text-muted-foreground'>Select an inbox first.</p>
        </Section>
      )}

      <RuleActionsSummaryRow
        labels={actionLabels}
        onOpen={onOpenActions}
        emptyText='No actions yet. Add at least one before saving'
      />

      {statusBar}

      <DialogFooter className='border-t p-3'>
        <Button variant='ghost' size='sm' type='button' onClick={onCancel}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button
          variant='outline'
          size='sm'
          type='submit'
          disabled={!canSave}
          loading={isPending}
          loadingText='Saving...'>
          {saveLabel} <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </form>
  )
}

/** "Add group" trigger for the conditions header — lives inside the ConditionProvider. */
function AddGroupButton() {
  const { addGroup } = useConditionActions()
  if (!addGroup) return null
  return (
    <Button variant='ghost' size='xs' type='button' onClick={() => addGroup()}>
      <Plus />
      Add group
    </Button>
  )
}
