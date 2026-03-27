// apps/web/src/components/workflow/nodes/shared/message-received-trigger-input.tsx

'use client'

import { buildConditionGroups } from '@auxx/lib/mail-query/client'
import { Combobox } from '@auxx/ui/components/combobox'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { getIntegrationIconClass } from '~/components/mail/mail-status-config'
import { IntegrationPicker } from '~/components/pickers/integration-picker'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import {
  useMessageParticipants,
  useMessages,
  useThread,
  useThreadList,
} from '~/components/threads/hooks'
import type { TriggerInputProps } from '~/components/workflow/nodes/trigger-registry'
import { BaseType } from '~/components/workflow/types'
import {
  VarEditor,
  VarEditorField,
  VarEditorFieldRow,
} from '~/components/workflow/ui/input-editor/var-editor'
import Section from '~/components/workflow/ui/section'
import { api } from '~/trpc/react'
import { AutoResolveBadge } from '../core/answer/components/auto-resolve-badge'
import { transformThreadToWorkflowInput } from './node-inputs/thread-input'

/**
 * Message Received trigger input for test mode.
 * Supports auto mode (select thread) and manual mode (fill fields).
 */
export function MessageReceivedTriggerInput({ inputs, errors, onChange }: TriggerInputProps) {
  const isAutoMode = inputs._isAutoMode ?? true
  const selectedThreadId = inputs._threadId as string | undefined

  // --- Auto mode: fetch thread data ---
  const { thread, isLoading: threadLoading } = useThread({
    threadId: selectedThreadId,
    enabled: !!selectedThreadId && isAutoMode,
  })

  const { messages, isLoading: messagesLoading } = useMessages({
    threadId: selectedThreadId,
    enabled: !!selectedThreadId && isAutoMode,
  })

  const latestMessage = messages[0]
  const participantIds = latestMessage?.participants ?? []
  const {
    from,
    to,
    cc,
    bcc,
    isLoading: participantsLoading,
  } = useMessageParticipants(participantIds)

  const threadDataLoading = threadLoading || messagesLoading || participantsLoading

  // Auto-fill form fields when thread data loads (auto mode only)
  useEffect(() => {
    if (!isAutoMode || !thread || !latestMessage || threadDataLoading) return

    // Build the transformed workflow input (backend-compatible shape)
    const transformed = transformThreadToWorkflowInput({
      thread,
      latestMessage,
      from,
      to,
      cc,
    })

    // Set the message object directly — this is what the backend trigger node reads
    onChange('message', transformed.message)

    // Also set individual form field values for display / manual edit on mode switch
    onChange('integrationId', thread.integrationId ?? '')
    onChange('fromEmail', from?.identifier ?? '')
    onChange('fromName', from?.name ?? from?.displayName ?? '')
    onChange('ccEmails', cc.map((p) => p.identifier).join(', '))
    onChange('bccEmails', bcc.map((p) => p.identifier).join(', '))
    onChange('subject', latestMessage.subject ?? thread.subject ?? '')
    onChange('body', latestMessage.textPlain ?? '')
    onChange('isInbound', latestMessage.isInbound ?? true)
  }, [isAutoMode, thread, latestMessage, from, to, cc, bcc, threadDataLoading, onChange])

  // --- Mode toggle ---
  const handleModeChange = useCallback(
    (isAuto: boolean) => {
      onChange('_isAutoMode', isAuto)
    },
    [onChange]
  )

  // --- Manual mode: build transformed data on field change ---
  const buildManualTransform = useCallback(
    (field: string, value: any) => {
      // First update the field
      onChange(field, value)

      // Get current values, applying the new change
      const vals = { ...inputs, [field]: value }
      const messageId = `test-message-${Date.now()}`
      const body = vals.body || ''

      // Build message in backend-compatible shape (ProcessedMessage)
      // No threadId in manual mode — backend handles missing threadId gracefully
      onChange('message', {
        id: messageId,
        integrationId: vals.integrationId || '',
        subject: vals.subject || '',
        textPlain: body,
        textHtml: body,
        snippet: body.substring(0, 200),
        isInbound: vals.isInbound ?? true,
        hasAttachments: false,
        receivedAt: new Date().toISOString(),
        from: { identifier: vals.fromEmail || '', name: vals.fromName || '' },
        to: [],
        cc: (vals.ccEmails || '')
          .split(',')
          .map((e: string) => e.trim())
          .filter(Boolean)
          .map((identifier: string) => ({ identifier, name: '' })),
      })
    },
    [inputs, onChange]
  )

  const handleManualFieldChange = useCallback(
    (field: string, value: any) => {
      if (isAutoMode) return
      buildManualTransform(field, value)
    },
    [isAutoMode, buildManualTransform]
  )

  return (
    <Section title='Message Received' initialOpen>
      <VarEditorField className='p-0'>
        {/* Thread row with auto/manual toggle */}
        <VarEditorFieldRow
          title='Thread'
          description='Select a thread to auto-fill or enter info manually'
          validationError={errors._threadId}>
          <div className='relative'>
            <div className='absolute right-full top-1/2 -translate-y-1/2 me-0.5 z-10'>
              <AutoResolveBadge isAuto={isAutoMode} onChange={handleModeChange} />
            </div>
            {isAutoMode ? (
              <ThreadCombobox
                selectedThreadId={selectedThreadId}
                onChange={(threadId) => {
                  onChange('_threadId', threadId)
                  if (!threadId) {
                    // Clear all auto-filled values
                    onChange('message', undefined)
                    onChange('integrationId', '')
                    onChange('fromEmail', '')
                    onChange('fromName', '')
                    onChange('ccEmails', '')
                    onChange('bccEmails', '')
                    onChange('subject', '')
                    onChange('body', '')
                    onChange('isInbound', true)
                  }
                }}
                isLoading={threadDataLoading && !!selectedThreadId}
              />
            ) : (
              <span className='flex h-8 items-center text-sm text-muted-foreground/50 ps-1'>
                Enter info below
              </span>
            )}
          </div>
        </VarEditorFieldRow>

        {/* Integration (determines receiving email / "To" address) */}
        <VarEditorFieldRow
          title='Integration'
          description='The email integration that received this message (determines To address)'
          type={BaseType.STRING}
          isRequired={!isAutoMode}
          validationError={errors.integrationId}>
          {isAutoMode ? (
            <AutoResolvedValue value={inputs.integrationId} type='integration' />
          ) : (
            <IntegrationPicker
              selected={inputs.integrationId ? [inputs.integrationId] : []}
              onChange={(selected) => handleManualFieldChange('integrationId', selected[0] || '')}
              allowMultiple={false}>
              <div className='h-8 w-full items-center flex flex-row justify-start cursor-default'>
                {inputs.integrationId ? (
                  <IntegrationBadge integrationId={inputs.integrationId} />
                ) : (
                  <span className='text-primary-400 text-sm'>Select integration...</span>
                )}
                <ChevronDown className='ms-auto me-2 size-4 opacity-50' />
              </div>
            </IntegrationPicker>
          )}
        </VarEditorFieldRow>

        {/* From Email */}
        <VarEditorFieldRow
          title='From Email'
          description='Sender email address'
          type={BaseType.EMAIL}
          isRequired={!isAutoMode}
          validationError={errors.fromEmail}>
          {isAutoMode ? (
            <AutoResolvedValue value={inputs.fromEmail} />
          ) : (
            <VarEditor
              value={inputs.fromEmail || ''}
              onChange={(value) => handleManualFieldChange('fromEmail', value)}
              varType={BaseType.EMAIL}
              allowConstant={true}
              allowVariable={false}
              placeholderConstant='sender@example.com'
            />
          )}
        </VarEditorFieldRow>

        {/* From Name */}
        <VarEditorFieldRow
          title='From Name'
          description='Sender display name'
          type={BaseType.STRING}>
          {isAutoMode ? (
            <AutoResolvedValue value={inputs.fromName} />
          ) : (
            <VarEditor
              value={inputs.fromName || ''}
              onChange={(value) => handleManualFieldChange('fromName', value)}
              varType={BaseType.STRING}
              allowConstant={true}
              allowVariable={false}
              placeholderConstant='John Doe'
            />
          )}
        </VarEditorFieldRow>

        {/* CC */}
        <VarEditorFieldRow
          title='CC'
          description='Carbon copy recipients (comma-separated)'
          type={BaseType.EMAIL}>
          {isAutoMode ? (
            <AutoResolvedValue value={inputs.ccEmails} />
          ) : (
            <VarEditor
              value={inputs.ccEmails || ''}
              onChange={(value) => handleManualFieldChange('ccEmails', value)}
              varType={BaseType.EMAIL}
              allowConstant={true}
              allowVariable={false}
              placeholderConstant='cc@example.com'
            />
          )}
        </VarEditorFieldRow>

        {/* BCC */}
        <VarEditorFieldRow
          title='BCC'
          description='Blind carbon copy recipients (comma-separated)'
          type={BaseType.EMAIL}>
          {isAutoMode ? (
            <AutoResolvedValue value={inputs.bccEmails} />
          ) : (
            <VarEditor
              value={inputs.bccEmails || ''}
              onChange={(value) => handleManualFieldChange('bccEmails', value)}
              varType={BaseType.EMAIL}
              allowConstant={true}
              allowVariable={false}
              placeholderConstant='bcc@example.com'
            />
          )}
        </VarEditorFieldRow>

        {/* Subject */}
        <VarEditorFieldRow title='Subject' description='Email subject line' type={BaseType.STRING}>
          {isAutoMode ? (
            <AutoResolvedValue value={inputs.subject} />
          ) : (
            <VarEditor
              value={inputs.subject || ''}
              onChange={(value) => handleManualFieldChange('subject', value)}
              varType={BaseType.STRING}
              allowConstant={true}
              allowVariable={false}
              placeholderConstant='Email subject'
            />
          )}
        </VarEditorFieldRow>

        {/* Body */}
        <VarEditorFieldRow
          title='Body'
          description='Email body (plain text)'
          className='min-h-[36px]'
          type={BaseType.STRING}>
          {isAutoMode ? (
            <AutoResolvedValue value={inputs.body} />
          ) : (
            <VarEditor
              value={inputs.body || ''}
              onChange={(value) => handleManualFieldChange('body', value)}
              varType={BaseType.STRING}
              allowConstant={true}
              allowVariable={false}
              placeholderConstant='Email body content'
              fieldOptions={{ string: { multiline: true } }}
              hideClearButton
            />
          )}
        </VarEditorFieldRow>

        {/* Is Inbound */}
        <VarEditorFieldRow
          title='Is Inbound'
          description='Whether the message was received (true) or sent (false)'
          type={BaseType.BOOLEAN}>
          {isAutoMode ? (
            <AutoResolvedValue value={inputs.isInbound != null ? String(inputs.isInbound) : ''} />
          ) : (
            <VarEditor
              value={inputs.isInbound ?? true}
              onChange={(value) => handleManualFieldChange('isInbound', value)}
              varType={BaseType.BOOLEAN}
              allowConstant={true}
              allowVariable={false}
            />
          )}
        </VarEditorFieldRow>
      </VarEditorField>
    </Section>
  )
}

// --- Sub-components ---

/** Displays "Auto resolved" or the auto-filled value */
function AutoResolvedValue({ value, type }: { value?: string | boolean; type?: 'integration' }) {
  if (type === 'integration' && value) {
    return (
      <span className='flex h-8 items-center text-sm pe-2 opacity-60'>
        <IntegrationBadge integrationId={value as string} />
      </span>
    )
  }

  if (value != null && value !== '') {
    return (
      <span className='flex h-8 items-center text-sm text-muted-foreground/50 pe-2 truncate'>
        {String(value)}
      </span>
    )
  }

  return (
    <span className='flex h-8 items-center text-sm text-muted-foreground/50 pe-2'>
      Auto resolved
    </span>
  )
}

/** Renders an integration as a badge with icon, name, and email */
function IntegrationBadge({ integrationId }: { integrationId: string }) {
  const { data: integrations } = api.channel.listForPicker.useQuery()
  const integration = integrations?.find((i) => i.id === integrationId)
  if (!integration) return <>{integrationId}</>
  const Icon = getIntegrationIconClass(integration.provider)
  return (
    <span className={cn(recordBadgeVariants(), 'ps-2')}>
      <Icon className='size-3' />
      <span data-slot='record-display'>
        {integration.name || integration.email || 'Integration'}
      </span>
    </span>
  )
}

/** Thread combobox using the shared Combobox component */
function ThreadCombobox({
  selectedThreadId,
  onChange,
  isLoading,
}: {
  selectedThreadId?: string
  onChange: (threadId: string) => void
  isLoading: boolean
}) {
  const filter = useMemo(() => buildConditionGroups({ contextType: 'all' }), [])
  const { threads, isLoading: threadsLoading } = useThreadList({
    filter,
    sort: { field: 'lastMessageAt', direction: 'desc' },
  })

  const options = useMemo(
    () => threads.map((t) => ({ value: t.id, label: t.subject || 'No subject' })),
    [threads]
  )

  const trigger = isLoading ? (
    <div className='h-8 w-full justify-start text-xs font-normal'>
      <Loader2 className='size-3 animate-spin' />
      <span className='text-muted-foreground'>Loading thread...</span>
    </div>
  ) : undefined

  return (
    <Combobox
      options={options}
      value={selectedThreadId || ''}
      onChangeValue={onChange}
      placeholder='Select a thread...'
      emptyText={threadsLoading ? 'Loading threads...' : 'No threads found.'}
      loading={threadsLoading}
      trigger={trigger}
      variant='ghost'
      size='sm'
      className='h-8 w-full text-xs font-normal truncate'
      align='start'
    />
  )
}
