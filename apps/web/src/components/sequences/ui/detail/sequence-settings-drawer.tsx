// apps/web/src/components/sequences/ui/detail/sequence-settings-drawer.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { getFieldOperators } from '@auxx/lib/resources/client'
import {
  SEQUENCE_TRIGGER_LABELS,
  SEQUENCE_TRIGGER_TYPES,
  type SequenceTriggerType,
} from '@auxx/lib/sequences/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Drawer, DrawerContent, DrawerHeader } from '@auxx/ui/components/drawer'
import { Input } from '@auxx/ui/components/input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import {
  Building2,
  CalendarClock,
  Clock,
  Filter,
  Globe,
  ListFilter,
  Mail,
  MailX,
  PenLine,
  Plus,
  Power,
  Reply,
  Send,
  Settings,
  Trash2,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  type Condition,
  ConditionContainer,
  ConditionProvider,
  type ConditionSystemConfig,
  useConditionActions,
} from '~/components/conditions'
import { ChannelPicker } from '~/components/pickers/channel-picker'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { useResourceFields } from '~/components/resources/hooks/use-resource-fields'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { useSignature } from '~/components/signatures/hooks/use-signature'
import { SignaturePicker } from '~/components/signatures/ui/signature-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
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
 * Right-side settings drawer: Sending (mailbox + signature), Delivery window
 * (start/end time, timezone, business days), Status (pause/enable), and the
 * Danger zone (delete). Every edit saves immediately via `sequence.update`,
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
      toastError({ title: 'Failed to update sequence', description: error.message })
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
      toastError({ title: 'Failed to delete sequence', description: error.message }),
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

  const { signature } = useSignature(sequence.signatureEntityInstanceId)

  const isEnabled = sequence.status === 'enabled'
  const canEnable = !!sequence.publishedAt && !!sequence.integrationId
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
    <Drawer direction='right' open={open} onOpenChange={onOpenChange} defaultWidth={440}>
      <DrawerContent>
        <ConfirmDialog />
        <DrawerHeader
          icon={<Settings className='size-5 text-muted-foreground' />}
          title='Sequence settings'
          onClose={() => onOpenChange(false)}
        />

        <ScrollArea className='flex-1' scrollbarClassName='w-1.5'>
          <Section
            title='Trigger'
            icon={<Zap className='size-4' />}
            description='When this sequence automatically enrolls a subject. Manual sequences only enroll from the Recipients tab.'
            initialOpen
            collapsible={false}>
            <TreeRow
              icon={<Zap className='size-4 text-muted-foreground' />}
              title='Event'
              secondary={
                isSeededTrigger ? (
                  <Badge variant='outline' size='sm'>
                    {SEQUENCE_TRIGGER_LABELS[sequence.triggerType as SequenceTriggerType] ??
                      sequence.triggerType}
                  </Badge>
                ) : (
                  <Select
                    value={sequence.triggerType}
                    onValueChange={(v) => save({ triggerType: v as SequenceTriggerType })}>
                    <SelectTrigger size='xs' className='w-44'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEQUENCE_TRIGGER_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {SEQUENCE_TRIGGER_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              }
            />
            {isSeededTrigger && (
              <div className='ps-9 pb-1 text-xs text-muted-foreground'>
                Built-in template — the trigger can't be changed.
              </div>
            )}
          </Section>

          <Section
            title='Sending'
            icon={<Send className='size-4' />}
            initialOpen
            collapsible={false}>
            <div className='flex flex-col'>
              <TreeRow
                icon={<Mail className='size-4 text-muted-foreground' />}
                title='Mailbox'
                description='All steps send from this connected email account.'
                secondaryFill
                secondary={
                  <ChannelPicker
                    value={sequence.integrationId ?? ''}
                    onChange={(integrationId) => save({ integrationId })}
                  />
                }
              />
              {!sequence.integrationId && (
                <div className='ps-9 pb-1 text-xs text-amber-600'>
                  Choose a mailbox — publishing requires one.
                </div>
              )}
              <TreeRow
                icon={<PenLine className='size-4 text-muted-foreground' />}
                title='Signature'
                description='Appended to every step. Optional.'
                secondaryFill
                secondary={
                  <SignaturePicker
                    selected={sequence.signatureEntityInstanceId}
                    onChange={(signatureId) => save({ signatureEntityInstanceId: signatureId })}>
                    <Button variant='outline' size='xs'>
                      {signature?.name ?? 'No signature'}
                    </Button>
                  </SignaturePicker>
                }
              />
            </div>
          </Section>

          <Section
            title='Delivery window'
            icon={<CalendarClock className='size-4' />}
            description='Emails only send inside this window; out-of-window sends wait for the next opening.'
            initialOpen
            collapsible={false}>
            <div className='flex flex-col'>
              <TreeRow
                icon={<Clock className='size-4 text-muted-foreground' />}
                title='Start time'
                secondary={
                  <Input
                    type='time'
                    className='h-7 w-28'
                    defaultValue={sequence.deliveryStartTime ?? ''}
                    onBlur={(e) => save({ deliveryStartTime: e.target.value || null })}
                  />
                }
              />
              <TreeRow
                icon={<Clock className='size-4 text-muted-foreground' />}
                title='End time'
                secondary={
                  <Input
                    type='time'
                    className='h-7 w-28'
                    defaultValue={sequence.deliveryEndTime ?? ''}
                    onBlur={(e) => save({ deliveryEndTime: e.target.value || null })}
                  />
                }
              />
              <TreeRow
                icon={<Globe className='size-4 text-muted-foreground' />}
                title='Timezone'
                secondary={
                  <TimeZonePicker
                    selected={sequence.deliveryTimezone ?? undefined}
                    onChange={(tz) => save({ deliveryTimezone: tz || null })}
                    triggerProps={{ size: 'xs' }}
                  />
                }
              />
              <TreeRow
                icon={<Building2 className='size-4 text-muted-foreground' />}
                title='Business days only'
                description='Skip Saturday and Sunday.'
                secondary={
                  <Switch
                    checked={sequence.deliveryBusinessDaysOnly}
                    onCheckedChange={(checked) => save({ deliveryBusinessDaysOnly: checked })}
                  />
                }
              />
            </div>
          </Section>

          <Section
            title='Behavior'
            icon={<Reply className='size-4' />}
            initialOpen
            collapsible={false}>
            <div className='flex flex-col'>
              <TreeRow
                icon={<Reply className='size-4 text-muted-foreground' />}
                title='Exit when the recipient replies'
                secondary={
                  <Switch
                    checked={sequence.exitOnReply}
                    onCheckedChange={(checked) => save({ exitOnReply: checked })}
                  />
                }
              />
              <TreeRow
                icon={<MailX className='size-4 text-muted-foreground' />}
                title='Respect unsubscribe / suppression list'
                secondary={
                  <Switch
                    checked={sequence.respectSuppression}
                    onCheckedChange={(checked) => save({ respectSuppression: checked })}
                  />
                }
              />
              <TreeRow
                icon={<Filter className='size-4 text-muted-foreground' />}
                title='Include unsubscribe footer'
                secondary={
                  <Switch
                    checked={sequence.includeUnsubscribeFooter}
                    onCheckedChange={(checked) => save({ includeUnsubscribeFooter: checked })}
                  />
                }
              />
            </div>
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

          <Section
            title='Status'
            icon={<Power className='size-4' />}
            initialOpen
            collapsible={false}>
            <TreeRow
              icon={<Power className='size-4 text-muted-foreground' />}
              title={isEnabled ? 'Enabled' : 'Paused'}
              description='Pausing blocks new enrollments; in-flight runs finish on their own.'
              secondary={
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) => save({ status: checked ? 'enabled' : 'disabled' })}
                  disabled={!isEnabled && !canEnable}
                />
              }
            />
            {!canEnable && (
              <div className='ps-9 text-xs text-muted-foreground'>
                {!sequence.publishedAt
                  ? 'Publish the sequence before enabling it.'
                  : 'Choose a sending mailbox before enabling it.'}
              </div>
            )}
          </Section>

          <Section
            title='Danger zone'
            icon={<TriangleAlert className='size-4' />}
            initialOpen
            collapsible={false}>
            <TreeRow
              icon={<Trash2 className='size-4 text-bad-500' />}
              title='Delete sequence'
              description='Removes the sequence, its steps, and its run history.'
              secondary={
                <Button
                  variant='destructive-hover'
                  size='xs'
                  loading={deleteSequence.isPending}
                  loadingText='Deleting…'
                  onClick={() => void handleDelete()}>
                  Delete
                </Button>
              }
            />
          </Section>

          <div className='h-8' />
        </ScrollArea>
      </DrawerContent>
    </Drawer>
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
