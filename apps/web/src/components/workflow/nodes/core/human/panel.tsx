// apps/web/src/components/workflow/nodes/core/human/panel.tsx

import { memo, useCallback } from 'react'
import { produce } from 'immer'
import Section from '~/components/workflow/ui/section'
import Field from '~/components/workflow/ui/field'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import { MemberGroupPicker } from '~/components/pickers/member-group-picker'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import { Button } from '@auxx/ui/components/button'
import { Alert, AlertTitle, AlertDescription } from '@auxx/ui/components/alert'
import { useEdgeInteractions, useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { type HumanConfirmationNodeData } from './types'
import { BaseType } from '~/components/workflow/types'
import type { TargetBranch } from '~/components/workflow/types'
import { useUpdateNodeInternals } from '@xyflow/react'

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
          draft.test_delay = isConstant ? parseInt(value) || 5 : 5
        }),
      [updateInputs]
    )

    return (
      <BasePanel nodeId={nodeId} data={data!}>
        {/* Message Section */}
        <Section title="General">
          <div className="space-y-4">
            <Field title="Message" description="Message shown to reviewers">
              <Editor
                title="Message"
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
                placeholder="Enter message for reviewers..."
              />
            </Field>
            {/* Assignees Section */}

            <Field title="Approver" description="Who can approve or deny" isRequired>
              <div className="space-y-1 flex flex-row gap-2 items-center">
                {/* Member/Group picker */}
                <MemberGroupPicker
                  selectedMembers={inputs.assignees?.userIds || []}
                  selectedGroups={inputs.assignees?.groups || []}
                  useUserIds={true}
                  onChange={useCallback(
                    (selection) =>
                      updateInputs((draft) => {
                        if (!draft.assignees) {
                          draft.assignees = {}
                        }
                        draft.assignees.userIds = selection.userIds // User IDs for notifications and approvals
                        draft.assignees.groups = selection.groupIds
                      }),
                    [updateInputs]
                  )}
                  disabled={isReadOnly}>
                  <Button variant="outline" size="sm">
                    Select Users/Groups
                  </Button>
                </MemberGroupPicker>
              </div>
            </Field>
            {/* Notification Methods */}
            <Field title="Notification Methods" description="How to notify assignees">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="in-app">In-app notification</Label>
                  <Switch
                    id="in-app"
                    size="sm"
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="email">Email notification</Label>
                  <Switch
                    id="email"
                    size="sm"
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
          title="Timeout Settings"
          description="How long to wait for confirmation"
          enabled={inputs.timeout?.enabled !== false}
          onEnableChange={handleTimeoutEnable}
          showEnable>
          <Field title="Timeout Duration">
            <VarEditorField className="pe-1">
              <div className="flex flex-row gap-1">
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
                          ? parseInt(value) || 24
                          : ({ id: value } as any)
                      }),
                    [updateInputs]
                  )}
                  varType={BaseType.NUMBER}
                  placeholder="Select variable..."
                  placeholderConstant="Enter duration..."
                  allowConstant
                  disabled={isReadOnly}
                />
                <div className="">
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
                    <SelectTrigger className="w-32 rounded-xl" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutes">Minutes</SelectItem>
                      <SelectItem value="hours">Hours</SelectItem>
                      <SelectItem value="days">Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </VarEditorField>
          </Field>
        </Section>

        {/* Advanced Settings */}
        <Section
          title="Advanced Settings"
          description="Additional configuration options"
          initialOpen={false}>
          <div className="space-y-2">
            <Field
              title="Login to approve"
              actions={
                <Switch
                  id="require-login"
                  size="sm"
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
              <p className="text-sm text-muted-foreground -mt-2">
                Require users to log in before approving
              </p>
            </Field>

            <Field
              title="Include workflow context"
              actions={
                <Switch
                  id="include-context"
                  size="sm"
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
              <p className="text-sm text-muted-foreground -mt-2">
                Include full context of the workflow execution in the approval request
              </p>
            </Field>
          </div>
        </Section>

        {/* Test Mode */}
        <Section
          title="Test Mode"
          description="Behavior during workflow testing"
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
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always_approve">Always Approve</SelectItem>
                <SelectItem value="always_deny">Always Deny</SelectItem>
                <SelectItem value="random">Random</SelectItem>
                <SelectItem value="live">Live Mode (Real Approvals)</SelectItem>
              </SelectContent>
            </Select>
          }>
          {inputs.test_behavior === 'live' && (
            <Alert variant="blue">
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
