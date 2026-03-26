// apps/web/src/components/workflow/nodes/core/human/panel.tsx

import { toActorId } from '@auxx/types/actor'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { useUpdateNodeInternals } from '@xyflow/react'
import { produce } from 'immer'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useEdgeInteractions, useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import type { TargetBranch } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types'
import Field from '~/components/workflow/ui/field'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import Section from '~/components/workflow/ui/section'
import { useUser } from '~/hooks/use-user'
import type { HumanConfirmationNodeData } from './types'

interface HumanConfirmationNodePanelProps {
  nodeId: string
  data: HumanConfirmationNodeData
}

/**
 * Configuration panel for the Human Confirmation node
 */
export const HumanConfirmationNodePanel = memo<HumanConfirmationNodePanelProps>(
  ({ nodeId, data }) => {
    const { isReadOnly } = useReadOnly()
    const { inputs, setInputs } = useNodeCrud<HumanConfirmationNodeData>(nodeId, data!)
    const { handleEdgeDeleteByDeleteBranch } = useEdgeInteractions()
    const updateNodeInternals = useUpdateNodeInternals()
    const { userId } = useUser()

    // Auto-assign current user as default approver when assignees are empty (mount only)
    const didAutoAssign = useRef(false)
    useEffect(() => {
      if (didAutoAssign.current || isReadOnly || !userId) return
      didAutoAssign.current = true
      const hasAssignees = inputs.assignees?.actorIds?.length || inputs.assignees?.variable
      if (!hasAssignees) {
        const newData = produce(inputs, (draft) => {
          if (!draft.assignees) {
            draft.assignees = {}
          }
          draft.assignees.actorIds = [toActorId('user', userId)]
        })
        setInputs(newData)
      }
    }, [inputs, setInputs, userId, isReadOnly])

    /**
     * Update inputs helper using produce for immutable updates
     */
    const updateInputs = useCallback(
      (updater: (draft: HumanConfirmationNodeData) => void) => {
        const newData = produce(inputs, updater)
        setInputs(newData)
      },
      [inputs, setInputs]
    )

    /** Compute VarEditor value from stored actorIds or variable */
    const assigneesValue = useMemo(() => {
      if (inputs.assignees?.variable) return inputs.assignees.variable.id
      const actorIds = inputs.assignees?.actorIds || []
      return actorIds.length > 0 ? JSON.stringify(actorIds) : ''
    }, [inputs.assignees])

    const isAssigneesConstantMode = !inputs.assignees?.variable

    /** Parse VarEditor value back to storage format */
    const handleAssigneesChange = useCallback(
      (value: string, isConstant: boolean) => {
        updateInputs((draft) => {
          if (!draft.assignees) draft.assignees = {}
          if (isConstant) {
            draft.assignees.actorIds = value ? JSON.parse(value) : []
            draft.assignees.variable = undefined
          } else {
            draft.assignees.variable = { id: value } as any
            draft.assignees.actorIds = undefined
          }
        })
      },
      [updateInputs]
    )

    const handleTimeoutEnable = useCallback(
      (enabled: boolean) => {
        updateInputs((draft) => {
          // Update timeout configuration
          if (!draft.timeout) {
            draft.timeout = { duration: 24, unit: 'hours', enabled }
          } else {
            draft.timeout.enabled = enabled
          }

          // Update _targetBranches
          if (!draft._targetBranches) {
            draft._targetBranches = []
          }

          if (enabled) {
            // Add timeout branch if not exists
            const hasTimeoutBranch = draft._targetBranches.some(
              (branch: TargetBranch) => branch.id === 'timeout'
            )
            if (!hasTimeoutBranch) {
              draft._targetBranches.push({ id: 'timeout', name: 'Timeout', type: 'default' })
            }
          } else {
            // Remove timeout branch
            draft._targetBranches = draft._targetBranches.filter(
              (branch: TargetBranch) => branch.id !== 'timeout'
            )
          }
        })

        // Delete edges connected to timeout branch when disabling
        if (!enabled) {
          handleEdgeDeleteByDeleteBranch(nodeId, 'timeout')
        }

        // Update node internals to refresh handles
        updateNodeInternals(nodeId)
      },
      [nodeId, updateInputs, handleEdgeDeleteByDeleteBranch, updateNodeInternals]
    )

    /**
     * Handler for test delay changes
     */
    const handleTestDelayChange = useCallback(
      (value: string, isConstant: boolean) =>
        updateInputs((draft) => {
          draft.test_delay = isConstant ? parseInt(value, 10) || 5 : 5
        }),
      [updateInputs]
    )

    return (
      <BasePanel nodeId={nodeId} data={data!}>
        {/* Message Section */}
        <Section title='General'>
          <div className='space-y-4'>
            <Field title='Message' description='Message shown to reviewers'>
              <Editor
                title='Message'
                value={inputs.message || ''}
                onChange={useCallback(
                  (content) =>
                    updateInputs((draft) => {
                      draft.message = content
                    }),
                  [updateInputs]
                )}
                readOnly={isReadOnly}
                nodeId={nodeId}
                placeholder='Enter message for reviewers...'
              />
            </Field>
            {/* Assignees Section */}

            <Field title='Approver' description='Who can approve or deny' isRequired>
              <VarEditorField className='pe-1'>
                <VarEditor
                  value={assigneesValue}
                  nodeId={nodeId}
                  onChange={handleAssigneesChange}
                  varType={BaseType.ACTOR}
                  fieldOptions={{ actor: { target: 'both', multiple: true } }}
                  allowConstant
                  allowVariable
                  isConstantMode={isAssigneesConstantMode}
                  onConstantModeChange={(isConstant) => {
                    updateInputs((draft) => {
                      if (!draft.assignees) draft.assignees = {}
                      if (isConstant) {
                        draft.assignees.variable = undefined
                      } else {
                        draft.assignees.actorIds = undefined
                      }
                    })
                  }}
                  placeholder='Select variable...'
                  placeholderConstant='Select users or groups...'
                  disabled={isReadOnly}
                />
              </VarEditorField>
            </Field>
            {/* Notification Methods */}
            <Field title='Notification Methods' description='How to notify assignees'>
              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='in-app'>In-app notification</Label>
                  <Switch
                    id='in-app'
                    size='sm'
                    checked={inputs.notification_methods?.in_app ?? true}
                    onCheckedChange={useCallback(
                      (checked) =>
                        updateInputs((draft) => {
                          if (!draft.notification_methods) {
                            draft.notification_methods = { in_app: true, email: true }
                          }
                          draft.notification_methods.in_app = checked
                        }),
                      [updateInputs]
                    )}
                    disabled={isReadOnly}
                  />
                </div>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='email'>Email notification</Label>
                  <Switch
                    id='email'
                    size='sm'
                    checked={inputs.notification_methods?.email ?? true}
                    onCheckedChange={useCallback(
                      (checked) =>
                        updateInputs((draft) => {
                          if (!draft.notification_methods) {
                            draft.notification_methods = { in_app: true, email: true }
                          }
                          draft.notification_methods.email = checked
                        }),
                      [updateInputs]
                    )}
                    disabled={isReadOnly}
                  />
                </div>
              </div>
            </Field>
          </div>
        </Section>
        <Section
          title='Timeout Settings'
          description='How long to wait for confirmation'
          enabled={inputs.timeout?.enabled !== false}
          onEnableChange={handleTimeoutEnable}
          showEnable>
          <Field title='Timeout Duration'>
            <VarEditorField className='pe-1'>
              <div className='flex flex-row gap-1'>
                <VarEditor
                  value={
                    typeof inputs.timeout?.duration === 'number'
                      ? String(inputs.timeout.duration)
                      : inputs.timeout?.duration?.id || '24'
                  }
                  nodeId={nodeId}
                  onChange={useCallback(
                    (value, isConstant) =>
                      updateInputs((draft) => {
                        if (!draft.timeout) {
                          draft.timeout = { duration: 24, unit: 'hours', enabled: true }
                        }
                        draft.timeout.duration = isConstant
                          ? parseInt(value, 10) || 24
                          : ({ id: value } as any)
                      }),
                    [updateInputs]
                  )}
                  varType={BaseType.NUMBER}
                  placeholder='Select variable...'
                  placeholderConstant='Enter duration...'
                  allowConstant
                  disabled={isReadOnly}
                />
                <div className=''>
                  <Select
                    value={inputs.timeout?.unit || 'hours'}
                    onValueChange={useCallback(
                      (value) =>
                        updateInputs((draft) => {
                          if (!draft.timeout) {
                            draft.timeout = { duration: 24, unit: 'hours', enabled: true }
                          }
                          draft.timeout.unit = value as 'minutes' | 'hours' | 'days'
                        }),
                      [updateInputs]
                    )}
                    disabled={isReadOnly}>
                    <SelectTrigger className='w-32 rounded-xl' size='sm'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='minutes'>Minutes</SelectItem>
                      <SelectItem value='hours'>Hours</SelectItem>
                      <SelectItem value='days'>Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </VarEditorField>
          </Field>
        </Section>

        {/* Advanced Settings */}
        <Section
          title='Advanced Settings'
          description='Additional configuration options'
          initialOpen={false}>
          <div className='space-y-2'>
            <Field
              title='Login to approve'
              actions={
                <Switch
                  id='require-login'
                  size='sm'
                  checked={inputs.require_login ?? true}
                  onCheckedChange={useCallback(
                    (checked) =>
                      updateInputs((draft) => {
                        draft.require_login = checked
                      }),
                    [updateInputs]
                  )}
                  disabled={isReadOnly}
                />
              }>
              <p className='text-sm text-muted-foreground -mt-2'>
                Require users to log in before approving
              </p>
            </Field>

            <Field
              title='Include workflow context'
              actions={
                <Switch
                  id='include-context'
                  size='sm'
                  checked={inputs.include_workflow_context ?? true}
                  onCheckedChange={useCallback(
                    (checked) =>
                      updateInputs((draft) => {
                        draft.include_workflow_context = checked
                      }),
                    [updateInputs]
                  )}
                  disabled={isReadOnly}
                />
              }>
              <p className='text-sm text-muted-foreground -mt-2'>
                Include full context of the workflow execution in the approval request
              </p>
            </Field>
          </div>
        </Section>

        {/* Test Mode */}
        <Section
          title='Test Mode'
          description='Behavior during workflow testing'
          initialOpen={false}
          open={inputs.test_behavior === 'live'}
          collapsible={inputs.test_behavior === 'live'}
          actions={
            <Select
              value={inputs.test_behavior || 'always_approve'}
              onValueChange={useCallback(
                (value) =>
                  updateInputs((draft) => {
                    draft.test_behavior = value as any
                  }),
                [updateInputs]
              )}
              disabled={isReadOnly}>
              <SelectTrigger size='sm'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='always_approve'>Always Approve</SelectItem>
                <SelectItem value='always_deny'>Always Deny</SelectItem>
                <SelectItem value='random'>Random</SelectItem>
                <SelectItem value='live'>Live Mode (Real Approvals)</SelectItem>
              </SelectContent>
            </Select>
          }>
          {inputs.test_behavior === 'live' && (
            <Alert variant='blue'>
              <AlertTitle>Live Test Mode</AlertTitle>
              <AlertDescription>
                This will create real approval requests and send notifications, but will be marked
                as test data for tracking purposes.
              </AlertDescription>
            </Alert>
          )}
        </Section>
      </BasePanel>
    )
  }
)

HumanConfirmationNodePanel.displayName = 'HumanConfirmationNodePanel'
