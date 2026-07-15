// apps/web/src/components/sequences/ui/detail/sequence-settings-drawer.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { getFieldOperators } from '@auxx/lib/resources/client'
import {
  SEQUENCE_TRIGGER_LABELS,
  SEQUENCE_TRIGGER_TYPES,
  type SequenceTriggerType,
} from '@auxx/lib/sequences/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { formatTimeOfDay, parseTimeOfDay } from '@auxx/utils/date'
import { CalendarClock, ListFilter, Plus, Reply, Send, Settings, Trash2, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  type Condition,
  ConditionContainer,
  ConditionProvider,
  type ConditionSystemConfig,
  useConditionActions,
} from '~/components/conditions'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { ChannelPicker } from '~/components/pickers/channel-picker'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { useResourceFields } from '~/components/resources/hooks/use-resource-fields'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { SignaturePicker } from '~/components/signatures/ui/signature-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { api, type RouterOutputs } from '~/trpc/react'

type Sequence = RouterOutputs['sequence']['get']['sequence']

interface SequenceSettingsDrawerProps {
  sequence: Sequence
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Fields patchable via `sequence.update`. */
type UpdateFields = Parameters<
  ReturnType<typeof api.sequence.update.useMutation>['mutate']
>[0]['fields']

/** Filterable subject entity per §4.3 — visit-subject sequences filter on the linked work
 * order (visit plain-table fields aren't filterable in v1); work_order subjects filter
 * directly; invoice subjects filter on the invoice. */
function filterEntityTypeForSubject(subjectKind: string | null): 'work_order' | 'invoice' | null {
  if (subjectKind === 'visit' || subjectKind === 'work_order') return 'work_order'
  if (subjectKind === 'invoice') return 'invoice'
  return null
}

/**
 * Dockable sequence settings drawer: Sending (mailbox + signature), Delivery window
 * (start/end time, timezone, business days), and behavior controls. Header
 * actions handle deletion. Every edit saves immediately via `sequence.update`,
 * optimistically patched into the `sequence.get` cache (no invalidate — the
 * server row reconciles on success, rollback on error).
 */
export function SequenceSettingsDrawer({
  sequence,
  open,
  onOpenChange,
}: SequenceSettingsDrawerProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  const update = api.sequence.update.useMutation({
    onMutate: async ({ fields }) => {
      await utils.sequence.get.cancel({ id: sequence.id })
      const previous = utils.sequence.get.getData({ id: sequence.id })
      utils.sequence.get.setData({ id: sequence.id }, (old) =>
        old ? { ...old, sequence: { ...old.sequence, ...fields } } : old
      )
      return { previous }
    },
    // Server truth (e.g. the hasUnpublishedChanges flip) replaces the patch.
    onSuccess: (updated) =>
      utils.sequence.get.setData({ id: sequence.id }, (old) =>
        old ? { ...old, sequence: updated } : old
      ),
    onError: (error, _variables, context) => {
      if (context?.previous) utils.sequence.get.setData({ id: sequence.id }, context.previous)
      toastError({
        title: 'Failed to update sequence',
        description: error.message,
      })
    },
  })
  const save = (fields: UpdateFields) => update.mutate({ id: sequence.id, fields })

  const deleteSequence = api.sequence.delete.useMutation({
    onSuccess: () => {
      onOpenChange(false)
      utils.sequence.list.invalidate()
      router.push('/app/workflows?t=sequences')
    },
    onError: (error) =>
      toastError({
        title: 'Failed to delete sequence',
        description: error.message,
      }),
  })

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete sequence?',
      description:
        'The sequence, its steps, and its run history will be permanently deleted. Active runs must finish or be removed first.',
      confirmText: 'Delete sequence',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deleteSequence.mutate({ id: sequence.id })
  }

  const isSeededTrigger = !!sequence.templateKey
  const isEventTriggered = sequence.triggerType !== 'manual'

  // Enrollment-filter condition builder (§4.7/§4.3) — shown only on event-triggered sequences.
  // Local buffer + 750ms debounced save mirrors the step autosave pattern: instant UI feedback,
  // no mutation storm while a condition's value input is mid-edit.
  const filterEntityType = filterEntityTypeForSubject(sequence.subjectKind)
  const { fields: subjectFields } = useResourceFields(isEventTriggered ? filterEntityType : null)
  const subjectEntityDefinitionId = useResourceStore((s) =>
    filterEntityType ? s.resourceMap.get(filterEntityType)?.entityDefinitionId : undefined
  )

  const [filterGroups, setFilterGroups] = useState<ConditionGroup[]>(() =>
    Array.isArray(sequence.enrollmentFilter) ? (sequence.enrollmentFilter as ConditionGroup[]) : []
  )
  const saveEnrollmentFilter = useDebouncedCallback((groups: ConditionGroup[]) => {
    save({ enrollmentFilter: groups.length > 0 ? groups : null })
  }, 750)
  const handleFilterGroupsChange = (groups: ConditionGroup[]) => {
    setFilterGroups(groups)
    saveEnrollmentFilter(groups)
  }

  const filterFieldDefinitions = useMemo(
    () =>
      subjectFields.map((field) => ({
        id: field.resourceFieldId ?? String(field.id),
        label: field.label,
        type: field.type,
        fieldType: field.fieldType,
        fieldKey: field.key,
        operators: field.operatorOverrides || getFieldOperators(field),
        options: field.options,
      })),
    [subjectFields]
  )

  const filterConditionConfig: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource',
      entityDefinitionId: subjectEntityDefinitionId,
      fields: filterFieldDefinitions,
      allowNesting: false,
      allowReordering: true,
      showLogicalOperators: true,
      showGrouping: true,
      allowGroupNaming: false,
      allowGroupCollapse: false,
      allowGroupReordering: true,
      showGroupSubtext: false,
      allowVarEditor: false,
      allowConstantToggle: false,
      allowCurrentUserPlaceholder: false,
    }),
    [subjectEntityDefinitionId, filterFieldDefinitions]
  )

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={minWidth}
      maxWidth={maxWidth}
      title='Sequence settings'>
      <ConfirmDialog />
      <DrawerHeader
        icon={<Settings className='size-5 text-muted-foreground' />}
        title='Sequence settings'
        actions={
          <>
            {!isSeededTrigger && (
              <Button
                variant='destructive-hover'
                size='icon-xs'
                loading={deleteSequence.isPending}
                loadingText='Deleting…'
                aria-label='Delete sequence'
                onClick={() => void handleDelete()}>
                <Trash2 />
              </Button>
            )}
            <DockToggleButton />
          </>
        }
        onClose={() => onOpenChange(false)}
      />

      <ScrollArea className='flex-1' scrollbarClassName='w-1.5'>
        <Section
          title='Trigger'
          icon={<Zap className='size-4' />}
          description='When this sequence automatically enrolls a subject. Manual sequences only enroll from the Recipients tab.'
          initialOpen
          collapsible={false}>
          <FieldPanel className='p-0'>
            <FieldPanelRow title='Event'>
              {isSeededTrigger ? (
                <div className='flex h-8 items-center'>
                  <Badge variant='outline' size='sm'>
                    {SEQUENCE_TRIGGER_LABELS[sequence.triggerType as SequenceTriggerType] ??
                      sequence.triggerType}
                  </Badge>
                </div>
              ) : (
                <FieldInputAdapter
                  fieldType={FieldType.SINGLE_SELECT}
                  fieldOptions={{
                    options: SEQUENCE_TRIGGER_TYPES.map((triggerType) => ({
                      value: triggerType,
                      label: SEQUENCE_TRIGGER_LABELS[triggerType],
                    })),
                  }}
                  triggerProps={{
                    variant: 'transparent',
                    className: 'w-full ps-0 pe-1',
                  }}
                  value={[sequence.triggerType]}
                  onChange={(value) => {
                    const triggerType = (value as string[])[0] as SequenceTriggerType | undefined
                    if (triggerType) save({ triggerType })
                  }}
                />
              )}
            </FieldPanelRow>
          </FieldPanel>
          {isSeededTrigger && (
            <div className='pt-1 text-xs text-muted-foreground'>
              Built-in template — the trigger can't be changed.
            </div>
          )}
        </Section>

        <Section title='Sending' icon={<Send className='size-4' />} initialOpen collapsible={false}>
          <FieldPanel className='p-0'>
            <FieldPanelRow
              title='Mailbox'
              description='All steps send from this connected email account.'>
              <div className='flex h-8 items-center'>
                <ChannelPicker
                  value={sequence.integrationId ?? ''}
                  onChange={(integrationId) => save({ integrationId })}
                  triggerProps={{ variant: 'transparent', className: 'w-full ps-0 pe-1' }}
                />
              </div>
            </FieldPanelRow>
            {!sequence.integrationId && (
              <div className='px-2 pb-1 text-xs text-amber-600'>
                Choose a mailbox — publishing requires one.
              </div>
            )}
            <FieldPanelRow title='Signature' description='Appended to every step. Optional.'>
              <SignaturePicker
                selected={sequence.signatureEntityInstanceId}
                onChange={(signatureId) => save({ signatureEntityInstanceId: signatureId })}
                triggerProps={{ variant: 'transparent', className: 'w-full ps-0 pe-1' }}
              />
            </FieldPanelRow>
          </FieldPanel>
        </Section>

        <Section
          title='Delivery window'
          icon={<CalendarClock className='size-4' />}
          description='Emails only send inside this window; out-of-window sends wait for the next opening.'
          initialOpen
          collapsible={false}>
          <FieldPanel className='p-0'>
            <FieldPanelRow title='Start time'>
              <FieldInputAdapter
                fieldType={FieldType.TIME}
                triggerProps={{
                  variant: 'transparent',
                  className: 'w-full ps-0 pe-1',
                }}
                value={parseTimeOfDay(sequence.deliveryStartTime)?.toISOString()}
                onChange={(value) =>
                  save({
                    deliveryStartTime:
                      typeof value === 'string' ? formatTimeOfDay(new Date(value)) : null,
                  })
                }
              />
            </FieldPanelRow>
            <FieldPanelRow title='End time'>
              <FieldInputAdapter
                fieldType={FieldType.TIME}
                triggerProps={{
                  variant: 'transparent',
                  className: 'w-full ps-0 pe-1',
                }}
                value={parseTimeOfDay(sequence.deliveryEndTime)?.toISOString()}
                onChange={(value) =>
                  save({
                    deliveryEndTime:
                      typeof value === 'string' ? formatTimeOfDay(new Date(value)) : null,
                  })
                }
              />
            </FieldPanelRow>
            <FieldPanelRow title='Timezone'>
              <TimeZonePicker
                selected={sequence.deliveryTimezone ?? undefined}
                onChange={(timezone) => save({ deliveryTimezone: timezone || null })}
                triggerProps={{
                  variant: 'transparent',
                  className: 'w-full ps-0 pe-1',
                }}
              />
            </FieldPanelRow>
            <FieldPanelRow title='Business days only' description='Skip Saturday and Sunday.'>
              <FieldInputAdapter
                fieldType={FieldType.CHECKBOX}
                fieldOptions={{ variant: 'switch' }}
                value={sequence.deliveryBusinessDaysOnly}
                onChange={(value) => save({ deliveryBusinessDaysOnly: value as boolean })}
              />
            </FieldPanelRow>
          </FieldPanel>
        </Section>

        <Section
          title='Behavior'
          icon={<Reply className='size-4' />}
          initialOpen
          collapsible={false}>
          <FieldPanel className='p-0'>
            <FieldPanelRow
              title='Exit when the recipient replies'
              description='Stop the sequence after an inbound reply.'>
              <FieldInputAdapter
                fieldType={FieldType.CHECKBOX}
                fieldOptions={{ variant: 'switch' }}
                value={sequence.exitOnReply}
                onChange={(value) => save({ exitOnReply: value as boolean })}
              />
            </FieldPanelRow>
            <FieldPanelRow title='Respect unsubscribe / suppression list'>
              <FieldInputAdapter
                fieldType={FieldType.CHECKBOX}
                fieldOptions={{ variant: 'switch' }}
                value={sequence.respectSuppression}
                onChange={(value) => save({ respectSuppression: value as boolean })}
              />
            </FieldPanelRow>
            <FieldPanelRow title='Include unsubscribe footer'>
              <FieldInputAdapter
                fieldType={FieldType.CHECKBOX}
                fieldOptions={{ variant: 'switch' }}
                value={sequence.includeUnsubscribeFooter}
                onChange={(value) => save({ includeUnsubscribeFooter: value as boolean })}
              />
            </FieldPanelRow>
          </FieldPanel>
        </Section>

        {isEventTriggered && (
          <ConditionProvider
            conditions={EMPTY_CONDITIONS}
            groups={filterGroups}
            config={filterConditionConfig}
            onConditionsChange={() => {}}
            onGroupsChange={handleFilterGroupsChange}
            getAvailableFields={() => filterFieldDefinitions}
            getFieldDefinition={(id) => filterFieldDefinitions.find((f) => f.id === id)}>
            <Section
              title='Enrollment filter'
              icon={<ListFilter className='size-4' />}
              description='Only enroll subjects that match these conditions. Evaluated once, at enrollment — leave empty to enroll everything.'
              initialOpen
              collapsible={false}
              actions={<AddFilterGroupButton />}>
              <ConditionContainer
                emptyStateText='No conditions — every match enrolls'
                showAddButton={false}
                showGrouping
              />
            </Section>
          </ConditionProvider>
        )}

        <div className='h-8' />
      </ScrollArea>
    </DockableDrawer>
  )
}

/** Stable empty array — this drawer only uses grouped conditions (`ConditionGroup[]`). */
const EMPTY_CONDITIONS: Condition[] = []

/** "Add group" trigger for the enrollment-filter section header — must live inside the
 * `ConditionProvider` to reach `useConditionActions`. */
function AddFilterGroupButton() {
  const { addGroup } = useConditionActions()
  if (!addGroup) return null
  return (
    <Button variant='ghost' size='xs' type='button' onClick={() => addGroup()}>
      <Plus />
      Add group
    </Button>
  )
}
