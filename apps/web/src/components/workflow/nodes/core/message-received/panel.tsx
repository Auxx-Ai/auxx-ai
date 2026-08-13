// apps/web/src/components/workflow/nodes/core/message-received/panel.tsx

'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { getMessageConditionFields } from '@auxx/lib/message-trigger-conditions/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { getInstanceId, isRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { produce } from 'immer'
import { Plus } from 'lucide-react'
import type React from 'react'
import { memo, useCallback, useMemo } from 'react'
import { useChannelStore } from '~/components/channels/store/channel-store'
import { ChannelBadge } from '~/components/channels/ui/channel-badge'
import {
  type Condition,
  ConditionContainer,
  ConditionProvider,
  type ConditionSystemConfig,
  useConditionActions,
} from '~/components/conditions'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { INBOX_SELECT_ALL_VALUE, InboxPicker } from '~/components/pickers/inbox-picker'
import {
  INTEGRATION_SELECT_ALL_VALUE,
  IntegrationPicker,
} from '~/components/pickers/integration-picker'
import { RecordBadge } from '~/components/resources/ui'
import { useInboxes } from '~/components/threads/hooks'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '../../../ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { staticOutputVariableContext } from '../output-variable-context'
import { messageReceivedDefinition, UNSCOPED_MESSAGE_TRIGGER_WARNING } from './schema'
import type { MessageReceivedNodeData } from './types'

/**
 * The flush-in-a-FieldPanelRow trigger sizing shared by every panel using this
 * pattern, plus h-auto so the button grows when selection chips wrap to
 * multiple lines instead of clipping them.
 */
const TRIGGER_CLASS = 'w-full ps-0 pe-1 h-auto min-h-8'

/** The provider drives groups here; the flat condition list stays empty (mirrors mail-filter-configure-page). */
const EMPTY_CONDITIONS: Condition[] = []

interface MessageReceivedPanelProps {
  nodeId: string
  data: MessageReceivedNodeData
}

const MessageReceivedPanelComponent: React.FC<MessageReceivedPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()

  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<MessageReceivedNodeData>(
    nodeId,
    data
  )

  const channelIds = nodeData.channelIds ?? []

  const setChannelIds = useCallback(
    (next: string[]) => {
      setNodeData(
        produce(nodeData, (draft) => {
          draft.channelIds = next
        })
      )
    },
    [nodeData, setNodeData]
  )

  // ── Run on: channel/inbox scope (§4) ────────────────────────────────────
  // `channelIds` is the ONLY thing persisted, the inbox picker below is a
  // write-only shortcut that expands to that inbox's channel ids.
  const channels = useChannelStore((s) => s.channels)
  const { inboxes } = useInboxes()
  const nonPersonalInboxes = useMemo(() => inboxes.filter((i) => !i.isPersonal), [inboxes])

  const channelIdsByInboxId = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const channel of channels) {
      if (!channel.inboxId) continue
      const list = map.get(channel.inboxId) ?? []
      list.push(channel.id)
      map.set(channel.inboxId, list)
    }
    return map
  }, [channels])

  const channelIdSet = useMemo(() => new Set(channelIds), [channelIds])

  // An inbox reads as "selected" when every one of its channels is currently
  // in scope. Purely derived; nothing about inbox selection is stored.
  const selectedInboxRecordIds = useMemo(() => {
    if (channelIds.length === 0) return []
    return nonPersonalInboxes
      .filter((inbox) => {
        const ids = channelIdsByInboxId.get(inbox.id) ?? []
        return ids.length > 0 && ids.every((id) => channelIdSet.has(id))
      })
      .map((inbox) => inbox.recordId as string)
  }, [nonPersonalInboxes, channelIdsByInboxId, channelIds.length, channelIdSet])

  // Unscoped (= all channels) must read back as "All shared inboxes" checked,
  // exactly like the Channels row below, without this the select-all row can
  // never appear checked, since clicking it sets the already-current state.
  const displayedInboxSelection = useMemo(
    () => (channelIds.length === 0 ? [INBOX_SELECT_ALL_VALUE] : selectedInboxRecordIds),
    [channelIds.length, selectedInboxRecordIds]
  )

  const selectedChannels = useMemo(
    () => channelIds.map((id) => channels.find((c) => c.id === id)).filter((c) => c != null),
    [channelIds, channels]
  )

  const handleInboxesChange = useCallback(
    (nextSelected: string[]) => {
      if (nextSelected.includes(INBOX_SELECT_ALL_VALUE)) {
        setChannelIds([])
        return
      }
      // InboxPicker emits `inbox.recordId` though typed as bare `string[]`
      // (noted at `components/mail/thread-header.tsx:228`).
      const nextInboxIds = new Set(nextSelected.filter(isRecordId).map(getInstanceId))
      const prevInboxIds = new Set(selectedInboxRecordIds.filter(isRecordId).map(getInstanceId))

      const next = new Set(channelIds)
      for (const inboxId of nextInboxIds) {
        if (prevInboxIds.has(inboxId)) continue
        for (const cid of channelIdsByInboxId.get(inboxId) ?? []) next.add(cid)
      }
      for (const inboxId of prevInboxIds) {
        if (nextInboxIds.has(inboxId)) continue
        for (const cid of channelIdsByInboxId.get(inboxId) ?? []) next.delete(cid)
      }
      setChannelIds(Array.from(next))
    },
    [selectedInboxRecordIds, channelIdsByInboxId, channelIds, setChannelIds]
  )

  const handleChannelsChange = useCallback(
    (selected: string[]) => {
      setChannelIds(selected.includes(INTEGRATION_SELECT_ALL_VALUE) ? [] : selected)
    },
    [setChannelIds]
  )

  // ── Content conditions (§3): shared condition builder, replaces Message Filters ──
  const conditionFields = useMemo(() => getMessageConditionFields(), [])

  const conditionConfig: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource',
      fields: conditionFields,
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
      // Constants only, a trigger fires before any node has run, so there is
      // no workflow variable to reference.
      allowVarEditor: false,
      allowConstantToggle: false,
      allowCurrentUserPlaceholder: false,
      display: 'inline',
      readOnly: isReadOnly,
    }),
    [conditionFields, isReadOnly]
  )

  const conditionGroups = nodeData.conditions ?? []

  const handleGroupsChange = useCallback(
    (groups: ConditionGroup[]) => {
      setNodeData(
        produce(nodeData, (draft) => {
          draft.conditions = groups
        })
      )
    },
    [nodeData, setNodeData]
  )

  const getConditionFieldDefinition = useCallback(
    (id: string | string[]) =>
      Array.isArray(id) ? undefined : conditionFields.find((f) => f.id === id),
    [conditionFields]
  )

  const getAvailableConditionFields = useCallback(() => conditionFields, [conditionFields])

  const setMachineMail = (value: 'exclude' | 'include') => {
    const newData = produce(nodeData, (draft) => {
      draft.machineMail = value
    })
    setNodeData(newData)
  }

  return (
    <BasePanel nodeId={nodeId} data={data}>
      <Section
        title='Run on'
        description='Which channels can start this workflow. Unscoped (the default) means every channel.'
        initialOpen>
        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='message-received-scope'
          className='p-0'>
          <FieldPanelRow
            title='Inboxes'
            description='Shortcut: selects every channel linked to the chosen inbox(es).'>
            <InboxPicker
              allowMultiple
              selectAll
              selectAllLabel='All shared inboxes'
              selected={displayedInboxSelection}
              onChange={handleInboxesChange}>
              <PickerTrigger hasValue className={TRIGGER_CLASS}>
                {channelIds.length === 0 ? (
                  <span className='truncate text-sm'>All shared inboxes</span>
                ) : selectedInboxRecordIds.length > 0 ? (
                  <div className='flex flex-wrap items-center gap-1 py-1'>
                    {selectedInboxRecordIds.map((recordId) => (
                      <RecordBadge key={recordId} recordId={recordId as RecordId} />
                    ))}
                  </div>
                ) : (
                  <span className='truncate text-sm text-muted-foreground'>
                    Custom channel selection
                  </span>
                )}
              </PickerTrigger>
            </InboxPicker>
          </FieldPanelRow>

          <FieldPanelRow
            title='Channels'
            validationError={channelIds.length === 0 ? UNSCOPED_MESSAGE_TRIGGER_WARNING : undefined}
            validationType='warning'>
            <IntegrationPicker
              allowMultiple
              selectAll
              selectAllLabel='All channels'
              selected={channelIds.length === 0 ? [INTEGRATION_SELECT_ALL_VALUE] : channelIds}
              onChange={handleChannelsChange}>
              <PickerTrigger hasValue className={TRIGGER_CLASS}>
                {selectedChannels.length === 0 ? (
                  <span className='truncate text-sm'>All channels</span>
                ) : (
                  <div className='flex flex-wrap items-center gap-1 py-1'>
                    {selectedChannels.map((channel) => (
                      <ChannelBadge key={channel.id} channel={channel} />
                    ))}
                  </div>
                )}
              </PickerTrigger>
            </IntegrationPicker>
          </FieldPanelRow>
        </FieldPanel>
      </Section>

      <ConditionProvider
        conditions={EMPTY_CONDITIONS}
        groups={conditionGroups}
        config={conditionConfig}
        nodeId={nodeId}
        readOnly={isReadOnly}
        onConditionsChange={() => {}}
        onGroupsChange={handleGroupsChange}
        getAvailableFields={getAvailableConditionFields}
        getFieldDefinition={getConditionFieldDefinition}>
        <Section
          title='Conditions'
          description='Match on message content: sender, subject, body, attachments. Channel scope is set above, not here.'
          initialOpen={false}
          actions={<AddConditionGroupButton />}>
          <ConditionContainer
            emptyStateText='No conditions. Runs on every message that matches the channel scope above.'
            showAddButton={false}
            showGrouping
          />
        </Section>
      </ConditionProvider>

      <Section
        title='Automated emails'
        description='Controls whether out-of-office replies, newsletters, and notification emails can start this workflow.'
        initialOpen={false}>
        <div className='space-y-2'>
          <Select
            value={nodeData.machineMail ?? 'exclude'}
            onValueChange={(value: 'exclude' | 'include') => setMachineMail(value)}
            disabled={isReadOnly}>
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='exclude'>
                Skip automated emails (out-of-office replies, newsletters, notification emails)
              </SelectItem>
              <SelectItem value='include'>Also trigger on automated emails</SelectItem>
            </SelectContent>
          </Select>
          <p className='text-xs text-muted-foreground'>
            Bounce and delivery-failure emails never trigger workflows, regardless of this setting.
          </p>
        </div>
      </Section>

      <OutputVariablesDisplay
        outputVariables={
          messageReceivedDefinition.outputVariables?.(
            nodeData,
            nodeId,
            staticOutputVariableContext
          ) || []
        }
        initialOpen={false}
      />
    </BasePanel>
  )
}

/** "Add group" trigger for the conditions header, lives inside the ConditionProvider. */
function AddConditionGroupButton() {
  const { addGroup } = useConditionActions()
  if (!addGroup) return null
  return (
    <Button variant='ghost' size='xs' type='button' onClick={() => addGroup()}>
      <Plus />
      Add group
    </Button>
  )
}

export const MessageReceivedPanel = memo(MessageReceivedPanelComponent)
