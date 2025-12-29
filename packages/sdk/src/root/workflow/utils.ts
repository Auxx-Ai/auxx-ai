// packages/sdk/src/root/workflow/utils.ts

import type { WorkflowBlock, WorkflowTrigger, InferWorkflowInput, InferWorkflowOutput } from './types.js'

/**
 * Extract the schema type from a WorkflowBlock or WorkflowTrigger
 *
 * @example
 * ```typescript
 * import type { SchemaOf } from '@auxx/sdk'
 * import { sendEmailBlock } from './send-email.workflow'
 *
 * type SendEmailSchema = SchemaOf<typeof sendEmailBlock>
 * // Equivalent to: typeof sendEmailBlock.schema
 * ```
 */
export type SchemaOf<T> = T extends WorkflowBlock<infer TSchema>
  ? TSchema
  : T extends WorkflowTrigger<infer TSchema>
    ? TSchema
    : never

/**
 * Extract the input type from a WorkflowBlock or WorkflowTrigger
 *
 * @example
 * ```typescript
 * import type { InputOf } from '@auxx/sdk'
 * import { sendEmailBlock } from './send-email.workflow'
 *
 * type SendEmailInput = InputOf<typeof sendEmailBlock>
 * // Equivalent to: { to: string, subject: string, body: string, ... }
 * ```
 */
export type InputOf<T> = T extends WorkflowBlock<infer TSchema>
  ? InferWorkflowInput<TSchema>
  : T extends WorkflowTrigger<infer TSchema>
    ? InferWorkflowInput<TSchema>
    : never

/**
 * Extract the output type from a WorkflowBlock or WorkflowTrigger
 *
 * @example
 * ```typescript
 * import type { OutputOf } from '@auxx/sdk'
 * import { sendEmailBlock } from './send-email.workflow'
 *
 * type SendEmailOutput = OutputOf<typeof sendEmailBlock>
 * // Equivalent to: { messageId: string, status: string, sentAt: string }
 * ```
 */
export type OutputOf<T> = T extends WorkflowBlock<infer TSchema>
  ? InferWorkflowOutput<TSchema>
  : T extends WorkflowTrigger<infer TSchema>
    ? InferWorkflowOutput<TSchema>
    : never
