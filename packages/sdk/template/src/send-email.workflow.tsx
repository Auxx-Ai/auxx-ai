// packages/sdk/template/src/send-email.workflow.tsx

/**
 * Example workflow block demonstrating the Auxx workflow app system.
 *
 * This file shows:
 * 1. Schema definition using the workflow builder API
 * 2. Node component for canvas visualization
 * 3. Panel component for configuration UI
 * 4. Server-side execute function with SDK usage
 *
 * Developers can copy this example and modify it for their own workflow blocks.
 */

import { Workflow, type WorkflowBlock, type WorkflowSchema } from '@auxx/sdk'
import {
  WorkflowNode,
  WorkflowNodeRow,
  WorkflowNodeText,
  WorkflowNodeHandle,
  WorkflowPanel,
  useWorkflow,
  useWorkflowNode,
} from '@auxx/sdk/client'
import sendEmailExecute from './send-email.server'

// ============================================================================
// Schema Definition
// ============================================================================

/**
 * Define input and output schemas using the workflow builder API.
 * The schema drives type inference, validation, and UI generation.
 *
 * IMPORTANT: Both inputs and outputs should include metadata (label, description).
 * This enables rich display in the UI and helps users understand your workflow block.
 */
export const sendEmailSchema = {
  inputs: {
    to: Workflow.string({
      label: 'To Email',
      description: 'Recipient email address',
      placeholder: 'user@example.com',
      acceptsVariables: true,
      minLength: 1,
    }),
    subject: Workflow.string({
      label: 'Subject',
      description: 'Email subject line',
      placeholder: 'Your subject here...',
      acceptsVariables: true,
      minLength: 1,
    }),
    body: Workflow.string({
      label: 'Body',
      description: 'Email body content',
      placeholder: 'Enter your message...',
      acceptsVariables: true,
    }),
    priority: Workflow.select({
      label: 'Priority',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'normal', label: 'Normal' },
        { value: 'high', label: 'High' },
      ],
      default: 'normal',
    }),
    sendCopy: Workflow.boolean({
      label: 'Send Copy to Sender',
      description: 'Send a copy of this email to yourself',
      default: false,
    }),
  },
  outputs: {
    messageId: Workflow.string({
      label: 'Message ID',
      description: 'Unique identifier for the sent email',
    }),
    status: Workflow.string({
      label: 'Status',
      description: 'Email delivery status (sent, failed, pending)',
    }),
    sentAt: Workflow.string({
      label: 'Sent At',
      description: 'Timestamp when the email was sent (ISO 8601 format)',
    }),
  },
} satisfies WorkflowSchema

// ============================================================================
// Node Component (Canvas Visualization)
// ============================================================================

/**
 * Node component rendered on the workflow canvas.
 * Shows a compact preview of the configured email.
 *
 * IMPORTANT: WorkflowNodeHandle components are required for edge connections.
 * - Target handle (input): Allows incoming connections from previous nodes
 * - Source handle (output): Allows outgoing connections to next nodes
 */
function SendEmailNode() {
  const { data, status, lastRun } = useWorkflowNode()

  return (
    <WorkflowNode>
      {/* Input handle - allows connections from previous workflow nodes */}
      <WorkflowNodeHandle type="target" id="target" position="left" />

      <WorkflowNodeRow label="Send Email" />

      {data.to && (
        <WorkflowNodeText className="text-xs text-muted-foreground">
          To: {data.to}
        </WorkflowNodeText>
      )}

      {data.subject && (
        <WorkflowNodeText className="text-xs">
          {data.subject.length > 40 ? `${data.subject.substring(0, 40)}...` : data.subject}
        </WorkflowNodeText>
      )}

      {status === 'error' && lastRun?.error && (
        <WorkflowNodeText className="text-xs text-destructive">
          Error: {lastRun.error.message}
        </WorkflowNodeText>
      )}

      {/* Output handle - allows connections to next workflow nodes */}
      <WorkflowNodeHandle type="source" id="source" position="right" />
    </WorkflowNode>
  )
}

// ============================================================================
// Panel Component (Configuration UI)
// ============================================================================

/**
 * Panel component shown in the side panel when the node is selected.
 * Uses the useWorkflow hook to get type-safe, pre-bound input components.
 */
function SendEmailPanel() {
  const { StringInput, SelectInput, BooleanInput, Section } = useWorkflow<typeof sendEmailSchema>(sendEmailSchema)

  return (
    <WorkflowPanel>
      <Section title="Email Details">
        <StringInput name="to" />
        <StringInput name="subject" />
        <StringInput name="body" multiline rows={6} />
      </Section>

      <Section title="Options">
        <SelectInput name="priority" />
        <BooleanInput name="sendCopy" />
      </Section>
    </WorkflowPanel>
  )
}

// ============================================================================
// Execute Function (Server-Side)
// ============================================================================

/**
 * Server-side execution function is imported from send-email.server.ts
 *
 * IMPORTANT: Server functions (execute, activate, deactivate) MUST be in
 * separate .server.ts files. This enables:
 * - Proper server/client code splitting
 * - Lambda deployment of server functions
 * - Security (keeping server logic out of client bundle)
 *
 * See: ./send-email.server.ts for the implementation
 */

// ============================================================================
// Workflow Block Export
// ============================================================================

/**
 * Complete workflow block definition.
 * This is what gets registered in the workflow system.
 */
export const sendEmailBlock = {
  id: 'send-email',
  label: 'Send Email',
  description: 'Send an email to a recipient',
  category: 'integration',
  icon: '📧',
  color: '#3b82f6',
  schema: sendEmailSchema,
  node: SendEmailNode,
  panel: SendEmailPanel,
  execute: sendEmailExecute,
  config: {
    timeout: 30000, // 30 second timeout
    retries: 2, // Retry twice on failure
    requiresConnection: false, // Set to true if your block requires a connection
  },
} satisfies WorkflowBlock<typeof sendEmailSchema>
