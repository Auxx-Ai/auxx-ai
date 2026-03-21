// apps/web/src/components/workflow/nodes/core/answer/panel.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import type React from 'react'
import { memo, useCallback, useMemo, useState } from 'react'
import { getIntegrationIcon } from '~/components/mail/mail-status-config'
import { IntegrationPicker } from '~/components/pickers/integration-picker'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import Field from '~/components/workflow/ui/field'
import {
  VarEditor,
  VarEditorField,
  VarEditorFieldRow,
} from '~/components/workflow/ui/input-editor/var-editor'
import { VarEditorArray } from '~/components/workflow/ui/input-editor/var-editor-array'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import Section from '~/components/workflow/ui/section'
import { api } from '~/trpc/react'
import { BasePanel } from '../../shared/base/base-panel'
import { AutoResolveBadge } from './components/auto-resolve-badge'
import { validateAnswerConfig } from './schema'
import type { AnswerNodeData } from './types'

interface AnswerPanelProps {
  nodeId: string
  data: AnswerNodeData
}

/**
 * Configuration panel for the Answer node
 */
export const AnswerPanel: React.FC<AnswerPanelProps> = memo(({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<AnswerNodeData>(nodeId, data)
  const [showValidation, setShowValidation] = useState(false)

  // Fetch integrations to display selected integration name
  const { data: integrations } = api.channel.listForPicker.useQuery()

  // Find selected integration
  const selectedIntegration = useMemo(() => {
    if (!nodeData.integrationId || !integrations) return null
    return integrations.find((i) => i.id === nodeData.integrationId)
  }, [nodeData.integrationId, integrations])

  // Validation
  const validationResult = useMemo(() => validateAnswerConfig(nodeData), [nodeData])

  const isReplyMode = nodeData.messageType === 'reply' || nodeData.messageType === 'replyAll'

  // Validation helper functions
  const getFieldErrorMessage = useCallback(
    (field: string): string | undefined => {
      const error = validationResult.errors.find((e) => e.field === field)
      return error?.message
    },
    [validationResult.errors]
  )

  const hasFieldErrorOfType = useCallback(
    (field: string, type: 'error' | 'warning'): boolean => {
      const error = validationResult.errors.find((e) => e.field === field)
      return error?.type === type
    },
    [validationResult.errors]
  )

  // Handler functions
  const handleMessageTypeChange = useCallback(
    (value: 'new' | 'reply' | 'replyAll') => {
      setNodeData({
        ...nodeData,
        messageType: value,
        // Clear type-specific fields when switching
        integrationId: value === 'new' ? nodeData.integrationId : undefined,
        recordId: value !== 'new' ? nodeData.recordId : undefined,
        // Default auto-resolve for reply modes
        ...(value !== 'new' && {
          toIsAuto: nodeData.toIsAuto ?? true,
          ccIsAuto: nodeData.ccIsAuto ?? true,
          bccIsAuto: nodeData.bccIsAuto ?? true,
          subjectIsAuto: nodeData.subjectIsAuto ?? true,
        }),
      })
    },
    [nodeData, setNodeData]
  )

  const handleTextChange = useCallback(
    (value: string) => {
      setNodeData({ ...nodeData, text: value })
    },
    [nodeData, setNodeData]
  )

  return (
    <BasePanel title='Answer Configuration' nodeId={nodeId} data={data} showNextStep={false}>
      {/* Section 1: General Configuration */}
      <Section
        title='General'
        description='Configure message type and recipients'
        isRequired
        actions={
          <Select
            value={nodeData.messageType || 'reply'}
            onValueChange={handleMessageTypeChange}
            disabled={isReadOnly}>
            <SelectTrigger className='w-32' size='xs' variant='ghost'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='new'>New Message</SelectItem>
              <SelectItem value='reply'>Reply</SelectItem>
              <SelectItem value='replyAll'>Reply All</SelectItem>
            </SelectContent>
          </Select>
        }>
        {/* Email Fields and conditional fields */}
        <VarEditorField className='p-0'>
          {nodeData.messageType === 'new' && (
            <VarEditorFieldRow
              className=''
              title='Integration'
              description='Email integration to send from'
              type={BaseType.STRING}
              isRequired
              validationError={showValidation ? getFieldErrorMessage('integrationId') : undefined}
              validationType={hasFieldErrorOfType('integrationId', 'error') ? 'error' : 'warning'}>
              <IntegrationPicker
                selected={nodeData.integrationId ? [nodeData.integrationId] : []}
                onChange={(selected) => {
                  setNodeData({ ...nodeData, integrationId: selected[0] })
                  if (!showValidation) setShowValidation(true)
                }}
                allowMultiple={false}>
                <Button variant='outline' size='xs'>
                  {selectedIntegration ? (
                    <>
                      {getIntegrationIcon(selectedIntegration.provider)}
                      {selectedIntegration.name || selectedIntegration.email || 'Integration'}
                    </>
                  ) : (
                    'Select Integration'
                  )}
                </Button>
              </IntegrationPicker>
            </VarEditorFieldRow>
          )}

          {isReplyMode && (
            <VarEditorFieldRow
              className=''
              title='Reply To'
              description='Select Thread or Message to reply to'
              type={BaseType.RELATION}
              isRequired
              validationError={showValidation ? getFieldErrorMessage('recordId') : undefined}
              validationType={hasFieldErrorOfType('recordId', 'error') ? 'error' : 'warning'}
              onClear={
                nodeData.recordId
                  ? () => {
                      setNodeData({ ...nodeData, recordId: '' })
                      if (!showValidation) setShowValidation(true)
                    }
                  : undefined
              }>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.recordId || ''}
                onChange={(value) => {
                  setNodeData({ ...nodeData, recordId: value })
                  if (!showValidation) setShowValidation(true)
                }}
                varType={BaseType.RELATION}
                allowedTypes={[BaseType.RELATION, BaseType.STRING]}
                mode={VAR_MODE.PICKER}
                placeholder='Select Thread or Message'
                allowConstant={false}
                hideClearButton
              />
            </VarEditorFieldRow>
          )}

          {/* Subject field */}
          <VarEditorFieldRow
            title='Subject'
            description={
              isReplyMode
                ? 'Email subject line (auto-resolves to Re: thread subject)'
                : 'Email subject line (required)'
            }
            type={BaseType.STRING}
            isRequired={nodeData.messageType === 'new'}
            validationError={showValidation ? getFieldErrorMessage('subject') : undefined}
            validationType={hasFieldErrorOfType('subject', 'error') ? 'error' : 'warning'}
            onClear={
              nodeData.subject && (!isReplyMode || nodeData.subjectIsAuto === false)
                ? () => {
                    setNodeData({ ...nodeData, subject: '' })
                    if (!showValidation) setShowValidation(true)
                  }
                : undefined
            }>
            <div className='relative'>
              {isReplyMode && (
                <div className='absolute right-full top-1/2 -translate-y-1/2 me-0.5 z-10'>
                  <AutoResolveBadge
                    isAuto={nodeData.subjectIsAuto ?? true}
                    onChange={(isAuto) => setNodeData({ ...nodeData, subjectIsAuto: isAuto })}
                  />
                </div>
              )}
              {!isReplyMode || nodeData.subjectIsAuto === false ? (
                <VarEditor
                  nodeId={nodeId}
                  value={nodeData.subject || ''}
                  onChange={(value) => {
                    setNodeData({ ...nodeData, subject: value })
                    if (!showValidation) setShowValidation(true)
                  }}
                  varType={BaseType.STRING}
                  allowedTypes={[BaseType.STRING]}
                  mode={VAR_MODE.RICH}
                  placeholder='Enter subject or use variables'
                  allowConstant={true}
                  hideClearButton
                />
              ) : (
                <span className='flex h-8 items-center text-xs text-muted-foreground px-2'>
                  Auto resolved
                </span>
              )}
            </div>
          </VarEditorFieldRow>

          {/* To field */}
          <VarEditorFieldRow
            className=''
            title='To'
            description='Email recipients'
            type={BaseType.EMAIL}
            isRequired={nodeData.messageType === 'new' || nodeData.toIsAuto === false}
            validationError={showValidation ? getFieldErrorMessage('to') : undefined}
            validationType={hasFieldErrorOfType('to', 'error') ? 'error' : 'warning'}>
            <div className='relative'>
              {isReplyMode && (
                <div className='absolute right-full top-1/2 -translate-y-1/2 me-0.5 z-10'>
                  <AutoResolveBadge
                    isAuto={nodeData.toIsAuto ?? true}
                    onChange={(isAuto) => setNodeData({ ...nodeData, toIsAuto: isAuto })}
                  />
                </div>
              )}
              {!isReplyMode || nodeData.toIsAuto === false ? (
                <VarEditorArray
                  value={nodeData.to || []}
                  onChange={(values, modes) => {
                    setNodeData({ ...nodeData, to: values, toModes: modes })
                    if (!showValidation) setShowValidation(true)
                  }}
                  modes={nodeData.toModes}
                  varType={BaseType.EMAIL}
                  nodeId={nodeId}
                  disabled={isReadOnly}
                  allowConstant={true}
                  placeholder='Enter email or select variable'
                  placeholderConstant='Enter email address'
                />
              ) : (
                <span className='flex h-8 items-center text-xs text-muted-foreground px-2'>
                  Auto resolved
                </span>
              )}
            </div>
          </VarEditorFieldRow>

          {/* CC field */}
          <VarEditorFieldRow
            className=''
            title='CC'
            description='Carbon copy recipients'
            type={BaseType.EMAIL}>
            <div className='relative'>
              {isReplyMode && (
                <div className='absolute right-full top-1/2 -translate-y-1/2 me-0.5 z-10'>
                  <AutoResolveBadge
                    isAuto={nodeData.ccIsAuto ?? true}
                    onChange={(isAuto) => setNodeData({ ...nodeData, ccIsAuto: isAuto })}
                  />
                </div>
              )}
              {!isReplyMode || nodeData.ccIsAuto === false ? (
                <VarEditorArray
                  value={nodeData.cc || []}
                  onChange={(values, modes) =>
                    setNodeData({ ...nodeData, cc: values, ccModes: modes })
                  }
                  modes={nodeData.ccModes}
                  varType={BaseType.EMAIL}
                  nodeId={nodeId}
                  disabled={isReadOnly}
                  allowConstant={true}
                  placeholder='Enter email or select variable'
                  placeholderConstant='Enter email address'
                />
              ) : (
                <span className='flex h-8 items-center text-xs text-muted-foreground px-2'>
                  Auto resolved
                </span>
              )}
            </div>
          </VarEditorFieldRow>

          {/* BCC field */}
          <VarEditorFieldRow
            title='BCC'
            description='Blind carbon copy recipients'
            type={BaseType.EMAIL}>
            <div className='relative'>
              {isReplyMode && (
                <div className='absolute right-full top-1/2 -translate-y-1/2 me-0.5 z-10'>
                  <AutoResolveBadge
                    isAuto={nodeData.bccIsAuto ?? true}
                    onChange={(isAuto) => setNodeData({ ...nodeData, bccIsAuto: isAuto })}
                  />
                </div>
              )}
              {!isReplyMode || nodeData.bccIsAuto === false ? (
                <VarEditorArray
                  value={nodeData.bcc || []}
                  onChange={(values, modes) =>
                    setNodeData({ ...nodeData, bcc: values, bccModes: modes })
                  }
                  modes={nodeData.bccModes}
                  varType={BaseType.EMAIL}
                  nodeId={nodeId}
                  disabled={isReadOnly}
                  allowConstant={true}
                  placeholder='Enter email or select variable'
                  placeholderConstant='Enter email address'
                />
              ) : (
                <span className='flex h-8 items-center text-xs text-muted-foreground px-2'>
                  Auto resolved
                </span>
              )}
            </div>
          </VarEditorFieldRow>
        </VarEditorField>
      </Section>

      {/* Section 2: Message Content */}
      <Section title='Message' description='Compose your message' isRequired>
        <Editor
          title={<Label className='text-sm font-medium'>Message</Label>}
          value={nodeData.text || ''}
          onChange={handleTextChange}
          nodeId={nodeId}
          placeholder='Enter message content'
          readOnly={isReadOnly}
          minHeight={200}
        />
        <Field title='Attachments' className='pt-2'>
          <VarEditorField className='rounded-lg min-h-9'>
            <VarEditor
              value={nodeData.attachmentFiles || []}
              onChange={(values, modes) =>
                setNodeData({ ...nodeData, attachmentFiles: values, attachmentFilesModes: modes })
              }
              modes={nodeData.attachmentFilesModes}
              varType={BaseType.FILE}
              nodeId={nodeId}
              disabled={isReadOnly}
              allowConstant={true}
              placeholder='Select files or use variable'
              placeholderConstant='Select files...'
            />
          </VarEditorField>
        </Field>
      </Section>
    </BasePanel>
  )
})
