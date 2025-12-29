// apps/web/src/components/workflow/nodes/core/answer/panel.tsx

'use client'

import React, { useCallback, memo, useMemo, useState } from 'react'
import { BasePanel } from '../../shared/base/base-panel'
import Section from '~/components/workflow/ui/section'
import {
  VarEditor,
  VarEditorField,
  VarEditorFieldRow,
} from '~/components/workflow/ui/input-editor/var-editor'
import { VarEditorArray } from '~/components/workflow/ui/input-editor/var-editor-array'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import { IntegrationPicker } from '~/components/pickers/integration-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Label } from '@auxx/ui/components/label'
import { useReadOnly, useNodeCrud, useAvailableVariables } from '~/components/workflow/hooks'
import { type AnswerNodeData } from './types'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import { validateAnswerConfig } from './schema'
import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import { getIntegrationIcon } from '~/components/mail/mail-status-config'
import Field from '~/components/workflow/ui/field'

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
  const { data: integrations } = api.integration.getIntegrationsForPicker.useQuery()

  // Get available variables to auto-detect resource type
  const { allVariables } = useAvailableVariables({
    nodeId,
    expectedTypes: [BaseType.RELATION],
  })

  // Find selected integration
  const selectedIntegration = useMemo(() => {
    if (!nodeData.integrationId || !integrations) return null
    return integrations.find((i) => i.id === nodeData.integrationId)
  }, [nodeData.integrationId, integrations])

  // Validation
  const validationResult = useMemo(() => validateAnswerConfig(nodeData), [nodeData])

  // Helper function to detect resource type from variable ID
  const detectResourceType = useCallback(
    (variableId: string): 'thread' | 'message' | null => {
      // Find the variable in available variables
      const variable = allVariables.find((v) => v.id === variableId)

      if (!variable) return null

      // Check if it's a RELATION type with thread or message reference
      if (variable.type === BaseType.RELATION) {
        if (variable.reference === 'thread') return 'thread'
        if (variable.reference === 'message') return 'message'
      }

      return null
    },
    [allVariables]
  )

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
    (value: 'new' | 'reply') => {
      setNodeData({
        ...nodeData,
        messageType: value,
        // Clear type-specific fields when switching
        integrationId: value === 'new' ? nodeData.integrationId : undefined,
        resourceId: value === 'reply' ? nodeData.resourceId : undefined,
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
    <BasePanel title="Answer Configuration" nodeId={nodeId} data={data} showNextStep={false}>
      {/* Section 1: General Configuration */}
      <Section
        title="General"
        description="Configure message type and recipients"
        isRequired
        actions={
          <Select
            value={nodeData.messageType || 'reply'}
            onValueChange={handleMessageTypeChange}
            disabled={isReadOnly}>
            <SelectTrigger className="w-32" size="xs" variant="ghost">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New Message</SelectItem>
              <SelectItem value="reply">Reply</SelectItem>
            </SelectContent>
          </Select>
        }>
        {/* Email Fields and conditional fields */}
        <VarEditorField className="p-0">
          {nodeData.messageType !== 'reply' && (
            <VarEditorFieldRow
              className=""
              title="Integration"
              description="Email integration to send from"
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
                <Button variant="outline" size="xs">
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

          {nodeData.messageType === 'reply' && (
            <VarEditorFieldRow
              className=""
              title="Reply To"
              description="Select Thread or Message to reply to"
              type={BaseType.RELATION}
              isRequired
              validationError={showValidation ? getFieldErrorMessage('resourceId') : undefined}
              validationType={hasFieldErrorOfType('resourceId', 'error') ? 'error' : 'warning'}>
              <VarEditor
                nodeId={nodeId}
                value={nodeData.resourceId || ''}
                onChange={(value) => {
                  // Auto-detect resource type from selected variable
                  const resourceType = detectResourceType(value)

                  setNodeData({
                    ...nodeData,
                    resourceId: value,
                    resourceType: resourceType || undefined,
                  })
                  if (!showValidation) setShowValidation(true)
                }}
                varType={BaseType.RELATION}
                allowedTypes={[BaseType.RELATION, BaseType.STRING]}
                mode={VAR_MODE.PICKER}
                placeholder="Select Thread or Message"
                allowConstant={false}
              />
              {/* Show detected resource type for user feedback */}
              {nodeData.resourceType && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Replying to: {nodeData.resourceType === 'thread' ? 'Thread' : 'Message'}
                </div>
              )}
            </VarEditorFieldRow>
          )}

          <VarEditorFieldRow
            title="Subject"
            description={
              nodeData.messageType === 'new'
                ? 'Email subject line (required)'
                : 'Email subject line (optional, defaults to Re: thread subject)'
            }
            type={BaseType.STRING}
            isRequired={nodeData.messageType === 'new'}
            validationError={showValidation ? getFieldErrorMessage('subject') : undefined}
            validationType={hasFieldErrorOfType('subject', 'error') ? 'error' : 'warning'}>
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
              placeholder="Enter subject or use variables"
              allowConstant={true}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            className=""
            title="To"
            description="Email recipients"
            type={BaseType.EMAIL}
            isRequired
            validationError={showValidation ? getFieldErrorMessage('to') : undefined}
            validationType={hasFieldErrorOfType('to', 'error') ? 'error' : 'warning'}>
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
              placeholder="Enter email or select variable"
              placeholderConstant="Enter email address"
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            className=""
            title="CC"
            description="Carbon copy recipients"
            type={BaseType.EMAIL}>
            <VarEditorArray
              value={nodeData.cc || []}
              onChange={(values, modes) => setNodeData({ ...nodeData, cc: values, ccModes: modes })}
              modes={nodeData.ccModes}
              varType={BaseType.EMAIL}
              nodeId={nodeId}
              disabled={isReadOnly}
              allowConstant={true}
              placeholder="Enter email or select variable"
              placeholderConstant="Enter email address"
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title="BCC"
            description="Blind carbon copy recipients"
            type={BaseType.EMAIL}>
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
              placeholder="Enter email or select variable"
              placeholderConstant="Enter email address"
            />
          </VarEditorFieldRow>
        </VarEditorField>
      </Section>

      {/* Section 2: Message Content */}
      <Section title="Message" description="Compose your message" isRequired>
        <Editor
          title={<Label className="text-sm font-medium">Message</Label>}
          value={nodeData.text || ''}
          onChange={handleTextChange}
          nodeId={nodeId}
          placeholder="Enter message content"
          readOnly={isReadOnly}
          minHeight={200}
        />
        <Field title="Attachments" className="pt-2">
          <VarEditorField className="rounded-lg min-h-9">
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
              placeholder="Select files or use variable"
              placeholderConstant="Select files..."
            />
          </VarEditorField>
        </Field>
      </Section>
    </BasePanel>
  )
})
