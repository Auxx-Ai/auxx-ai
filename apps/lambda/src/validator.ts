// apps/lambda/src/validator.ts

/**
 * Input validation for Lambda events using Zod
 * Uses composable schema hierarchy for type-safe validation
 */

import { z } from 'zod'

/** Connection data schema */
const ConnectionDataSchema = z.object({
  id: z.string(),
  type: z.enum(['oauth2-code', 'secret']),
  value: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  expiresAt: z.string().optional(), // ISO date string
})

/** Execution context schema - used for app-based executions */
export const ExecutionContextSchema = z.object({
  organizationId: z.string().min(1),
  organizationHandle: z.string().min(1),
  userId: z.string().min(1),
  userEmail: z.email().nullish(),
  userName: z.string().nullish(),
  appId: z.string().min(1),
  apiUrl: z.url(),
  appInstallationId: z.string().min(1),
  userConnection: ConnectionDataSchema.optional(),
  organizationConnection: ConnectionDataSchema.optional(),
  callbackTokens: z
    .object({
      webhooks: z.string(),
      settings: z.string(),
    })
    .optional(),
})

// ============================================================================
// SCHEMA COMPOSITION HIERARCHY
// ============================================================================

/** Base schema - common fields for all execution types */
const BaseLambdaEventSchema = z.object({
  // Execution type (discriminator)
  type: z.enum(['function', 'event', 'webhook', 'workflow-block', 'polling-trigger', 'code']),

  // Common limits with defaults
  timeout: z.number().min(1000).max(30000).default(30000),
  memoryLimit: z.number().min(128).max(1024).default(512),
})

/** App event schema - extends base with app-specific fields */
const AppEventSchema = BaseLambdaEventSchema.extend({
  // Content-addressed bundle SHA (required for all app executions)
  serverBundleSha: z.string().min(1),

  // Execution context (required for all app executions)
  context: ExecutionContextSchema,
})

// ============================================================================
// TYPE-SPECIFIC SCHEMAS
// ============================================================================

/** Code execution schema - extends base (NOT AppEventSchema) */
const CodeExecutionSchema = BaseLambdaEventSchema.extend({
  type: z.literal('code'),

  // Code fields
  code: z.string().min(1),
  codeLanguage: z.enum(['javascript', 'python3']),
  codeInput: z.record(z.string(), z.any()).optional(),
  inputsConfig: z
    .array(
      z.object({
        name: z.string(),
        variableId: z.string(),
      })
    )
    .optional(),

  // ALL workflow variables (sys.*, env.*, node.*)
  variables: z.record(z.string(), z.any()),
})

/** Function execution schema - extends AppEventSchema */
const FunctionExecutionSchema = AppEventSchema.extend({
  type: z.literal('function'),
  functionIdentifier: z.string().regex(/^[\w/-]+\.server$/),
  functionArgs: z.string(),
})

/** Event execution schema - extends AppEventSchema */
const EventExecutionSchema = AppEventSchema.extend({
  type: z.literal('event'),
  eventType: z.string(),
  eventPayload: z.unknown().optional(),
})

/** Webhook execution schema - extends AppEventSchema */
const WebhookExecutionSchema = AppEventSchema.extend({
  type: z.literal('webhook'),
  handlerId: z.string(),
  request: z.object({
    method: z.string(),
    url: z.url(),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
  }),
})

/** Workflow block execution schema - extends AppEventSchema */
const WorkflowBlockExecutionSchema = AppEventSchema.extend({
  type: z.literal('workflow-block'),
  blockId: z.string(),
  workflowContext: z.object({
    workflowId: z.string(),
    executionId: z.string(),
    nodeId: z.string(),
    variables: z.record(z.string(), z.any()),
    user: z.object({
      id: z.string(),
      email: z.string().nullish(),
      name: z.string(),
    }),
    organization: z.object({
      id: z.string(),
      handle: z.string(),
      name: z.string(),
    }),
  }),
  workflowInput: z.record(z.string(), z.any()),
})

/** Polling trigger execution schema - extends AppEventSchema */
const PollingTriggerExecutionSchema = AppEventSchema.extend({
  type: z.literal('polling-trigger'),
  triggerId: z.string(),
  triggerInput: z.record(z.string(), z.any()),
  pollingState: z.record(z.string(), z.unknown()),
})

// ============================================================================
// EXPORTED TYPES
// ============================================================================

/** Individual event types for direct use */
export type CodeExecutionEvent = z.infer<typeof CodeExecutionSchema>
export type FunctionExecutionEvent = z.infer<typeof FunctionExecutionSchema>
export type EventExecutionEvent = z.infer<typeof EventExecutionSchema>
export type WebhookExecutionEvent = z.infer<typeof WebhookExecutionSchema>
export type WorkflowBlockExecutionEvent = z.infer<typeof WorkflowBlockExecutionSchema>
export type PollingTriggerExecutionEvent = z.infer<typeof PollingTriggerExecutionSchema>

/** Type-safe union of all validated events */
export type ValidatedLambdaEvent =
  | CodeExecutionEvent
  | FunctionExecutionEvent
  | EventExecutionEvent
  | WebhookExecutionEvent
  | WorkflowBlockExecutionEvent
  | PollingTriggerExecutionEvent

/** Keep existing exports */
export type ValidatedExecutionContext = z.infer<typeof ExecutionContextSchema>

// ============================================================================
// VALIDATION FUNCTION
// ============================================================================

/**
 * Validate Lambda event based on its type
 * Returns Zod's native safeParse result with full type inference
 */
export function validateLambdaEvent(event: unknown) {
  // Step 1: Parse to get the type field
  const typeCheck = z.object({ type: z.string() }).safeParse(event)

  if (!typeCheck.success) {
    return typeCheck // Return Zod's native error format
  }

  const eventType = typeCheck.data.type

  // Step 2: Validate with type-specific schema - just return the result
  switch (eventType) {
    case 'code':
      return CodeExecutionSchema.safeParse(event)
    case 'function':
      return FunctionExecutionSchema.safeParse(event)
    case 'event':
      return EventExecutionSchema.safeParse(event)
    case 'webhook':
      return WebhookExecutionSchema.safeParse(event)
    case 'workflow-block':
      return WorkflowBlockExecutionSchema.safeParse(event)
    case 'polling-trigger':
      return PollingTriggerExecutionSchema.safeParse(event)
    default:
      // Return error in Zod format for unknown type
      return {
        success: false as const,
        error: {
          issues: [
            {
              path: ['type'],
              message: `Unknown event type: ${eventType}`,
              code: 'custom' as const,
            },
          ],
        },
      }
  }
}
