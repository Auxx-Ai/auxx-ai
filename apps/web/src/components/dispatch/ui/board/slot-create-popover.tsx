// apps/web/src/components/dispatch/ui/board/slot-create-popover.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { addMinutes, differenceInMinutes } from 'date-fns'
import { useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { type RecordId, useResource } from '~/components/resources'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import type { useBoardMutations } from './hooks/use-board-mutations'
import { SlotCreateAssigneePicker } from './slot-create-assignee-picker'
import { UNASSIGNED_RESOURCE_ID } from './types'

/** The board's slot-create target (plan 44) — the create gesture's start/end/resource plus the
 * gesture's viewport anchor (the dblclick position / drag-release point / right-click coords), all
 * carried by the grid's `SlotCreateIntent`, so the popover anchors exactly there. `null` = closed. */
export interface SlotClickTarget {
  startTime: Date
  endTime: Date
  resourceId?: string
  anchor: { x: number; y: number }
}

type SlotCreateTab = 'new' | 'existing'

const DEFAULT_DURATION_MINUTES = 60

interface TimeAssigneeFieldsProps {
  startTime: Date
  onStartTimeChange: (date: Date) => void
  durationMinutes: number
  onDurationChange: (minutes: number) => void
  assigneeUserId: string | null
  onAssigneeChange: (userId: string | null) => void
  disabled: boolean
}

/** Start/Duration/Assignee — identical on both tabs (the slot's time and worker prefill don't
 * depend on which path creates the visit), factored out so the two `TabsContent` panels only
 * differ in their subject picker (contact vs. work order) and submit action. */
function TimeAssigneeFields({
  startTime,
  onStartTimeChange,
  durationMinutes,
  onDurationChange,
  assigneeUserId,
  onAssigneeChange,
  disabled,
}: TimeAssigneeFieldsProps) {
  return (
    <>
      <FieldPanelRow title='Start'>
        <FieldInputAdapter
          fieldType={FieldType.DATETIME}
          value={startTime.toISOString()}
          onChange={(val) => {
            if (val) onStartTimeChange(new Date(val as string))
          }}
          disabled={disabled}
        />
      </FieldPanelRow>
      <FieldPanelRow title='Duration'>
        <FieldInputAdapter
          fieldType={FieldType.NUMBER}
          value={durationMinutes}
          onChange={(val) =>
            onDurationChange(typeof val === 'number' ? val : DEFAULT_DURATION_MINUTES)
          }
          placeholder='60'
          disabled={disabled}
        />
      </FieldPanelRow>
      <FieldPanelRow title='Assignee'>
        <SlotCreateAssigneePicker
          value={assigneeUserId}
          onChange={onAssigneeChange}
          disabled={disabled}
        />
      </FieldPanelRow>
    </>
  )
}

export interface SlotCreatePopoverProps {
  target: SlotClickTarget | null
  onOpenChange: (open: boolean) => void
  /** Selects the newly created/added visit's chip (the board's `selectedVisitIds` setter) —
   * fired from `onSuccess`, matching the plan's "select after settle" wording (the optimistic
   * temp row above has no real id to select yet). */
  onSelectionChange: (ids: string[]) => void
  mutations: Pick<ReturnType<typeof useBoardMutations>, 'createWorkOrder' | 'addVisit'>
}

/**
 * Slot-create popover (plan 44) — opened by `BoardCalendarGrid`'s `onSlotCreate` (double-click /
 * cmd+drag), or by the context menu's "New event here". Anchored at the gesture's viewport point
 * via an invisible virtual anchor (`PopoverAnchor asChild` around a zero-size `position: fixed`
 * span) rather than a real chip element — the grid's `SlotCreateIntent` already carries that point
 * as `anchor`, so no separate click-position capture is needed anymore.
 *
 * Two paths (decision D): **New job** builds a work order from a contact + optional title
 * (`dispatch.createWorkOrder`); **Existing job** finds a work order and adds a visit to it
 * (`dispatch.addVisit`, unchanged). Both share the same Start/Duration/Assignee fields,
 * prefilled from the clicked slot.
 */
export function SlotCreatePopover({
  target,
  onOpenChange,
  onSelectionChange,
  mutations,
}: SlotCreatePopoverProps) {
  const { resource: contactResource } = useResource('contacts')
  const { resource: workOrderResource } = useResource('work-orders')

  const [tab, setTab] = useState<SlotCreateTab>('new')
  const [contactRecordId, setContactRecordId] = useState<RecordId | null>(null)
  const [workOrderRecordId, setWorkOrderRecordId] = useState<RecordId | null>(null)
  const [title, setTitle] = useState('')
  const [startTime, setStartTime] = useState<Date>(() => target?.startTime ?? new Date())
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION_MINUTES)
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null)

  // Re-seed every time a NEW slot is clicked — never while already open for the current target
  // (the `PasteVisitsDialog` reset-on-target-change precedent). Assignee prefills from the
  // clicked resource column (day/timeline); week/month never pass a `resourceId`, so this
  // naturally lands `null` there without a view-specific branch.
  useEffect(() => {
    if (!target) return
    setTab('new')
    setContactRecordId(null)
    setWorkOrderRecordId(null)
    setTitle('')
    setStartTime(target.startTime)
    // Prefill the duration from the gesture's painted range (cmd+drag) — dblclick/menu targets
    // arrive as the 60m default anyway, so this is a no-op there.
    setDurationMinutes(Math.max(15, differenceInMinutes(target.endTime, target.startTime)))
    setAssigneeUserId(
      target.resourceId && target.resourceId !== UNASSIGNED_RESOURCE_ID ? target.resourceId : null
    )
  }, [target])

  const isPending = mutations.createWorkOrder.isPending || mutations.addVisit.isPending

  const handleCreateJob = () => {
    if (!contactRecordId) return
    const endTime = addMinutes(startTime, durationMinutes)
    mutations.createWorkOrder.mutate(
      { contactRecordId, title: title.trim() || undefined, startTime, endTime, assigneeUserId },
      {
        onSuccess: (result) => {
          onSelectionChange([result.visitId])
          onOpenChange(false)
        },
      }
    )
  }

  const handleAddVisit = () => {
    if (!workOrderRecordId) return
    const endTime = addMinutes(startTime, durationMinutes)
    mutations.addVisit.mutate(
      { workOrderRecordId, startTime, endTime, assigneeUserId },
      {
        onSuccess: (visit) => {
          onSelectionChange([visit.id])
          onOpenChange(false)
        },
      }
    )
  }

  return (
    <Popover
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false)
      }}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{
            position: 'fixed',
            left: target?.anchor.x ?? 0,
            top: target?.anchor.y ?? 0,
            width: 0,
            height: 0,
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        side='right'
        align='start'
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className='w-96 rounded-3xl shadow-xl'>
        {target && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as SlotCreateTab)}>
            <TabsList variant='outline' className='w-full justify-start'>
              <TabsTrigger value='new' variant='outline'>
                New job
              </TabsTrigger>
              <TabsTrigger value='existing' variant='outline'>
                Existing job
              </TabsTrigger>
            </TabsList>

            <TabsContent value='new' className='space-y-3 pt-3'>
              <FieldPanel
                orientation='responsive'
                breakpoint='md'
                resizeId='slot-create-form'
                defaultLabelWidth={80}
                className='p-0'>
                <FieldPanelRow title='Contact' isRequired>
                  <MultiRelationInput
                    entityDefinitionId={contactResource?.id}
                    value={contactRecordId ? [contactRecordId] : []}
                    onChange={(ids) => setContactRecordId(ids[0] ?? null)}
                    multi={false}
                    placeholder='Select a contact'
                    disabled={isPending}
                  />
                </FieldPanelRow>
                <FieldPanelRow title='Title'>
                  <FieldInputAdapter
                    fieldType={FieldType.TEXT}
                    value={title}
                    onChange={(val) => setTitle((val as string) ?? '')}
                    placeholder='Defaults to the contact name'
                    disabled={isPending}
                  />
                </FieldPanelRow>
                <TimeAssigneeFields
                  startTime={startTime}
                  onStartTimeChange={setStartTime}
                  durationMinutes={durationMinutes}
                  onDurationChange={setDurationMinutes}
                  assigneeUserId={assigneeUserId}
                  onAssigneeChange={setAssigneeUserId}
                  disabled={isPending}
                />
              </FieldPanel>
              <Button
                className='w-full'
                size='sm'
                variant='outline'
                onClick={handleCreateJob}
                loading={mutations.createWorkOrder.isPending}
                loadingText='Creating...'
                disabled={!contactRecordId || isPending}>
                Create job
              </Button>
            </TabsContent>

            <TabsContent value='existing' className='space-y-3 pt-3'>
              <FieldPanel
                orientation='responsive'
                breakpoint='md'
                resizeId='slot-create-form'
                defaultLabelWidth={80}
                className='p-0'>
                <FieldPanelRow title='Job' isRequired>
                  <MultiRelationInput
                    entityDefinitionId={workOrderResource?.id}
                    value={workOrderRecordId ? [workOrderRecordId] : []}
                    onChange={(ids) => setWorkOrderRecordId(ids[0] ?? null)}
                    multi={false}
                    placeholder='Search jobs...'
                    disabled={isPending}
                  />
                </FieldPanelRow>
                <TimeAssigneeFields
                  startTime={startTime}
                  onStartTimeChange={setStartTime}
                  durationMinutes={durationMinutes}
                  onDurationChange={setDurationMinutes}
                  assigneeUserId={assigneeUserId}
                  onAssigneeChange={setAssigneeUserId}
                  disabled={isPending}
                />
              </FieldPanel>
              <Button
                className='w-full'
                size='sm'
                variant='outline'
                onClick={handleAddVisit}
                loading={mutations.addVisit.isPending}
                loadingText='Adding...'
                disabled={!workOrderRecordId || isPending}>
                Add visit
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </PopoverContent>
    </Popover>
  )
}
