// apps/web/src/components/workflow/nodes/core/answer/schema.ts

import { answerManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { AnswerNodeData } from './types'

// The data half (data interface, zod schema, defaults, validator, variable
// extraction) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/answer`). This file is the merge
// site: manifest + the web-only output resolver.

/**
 * Define output variables for answer node
 */
const getAnswerOutputVariables = (data: AnswerNodeData, nodeId: string): any[] => {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'sent',
      type: BaseType.BOOLEAN,
      description: 'Whether the message was sent successfully',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'message_id',
      type: BaseType.STRING,
      description: 'ID of the sent message',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'thread_id',
      type: BaseType.STRING,
      description: 'ID of the email thread',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'timestamp',
      type: BaseType.DATETIME,
      description: 'Timestamp when the message was sent',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'integration_id',
      type: BaseType.STRING,
      description: 'ID of the integration used to send',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'message_type',
      type: BaseType.STRING,
      description: 'Type of message sent (new, reply, or replyAll)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'is_draft',
      type: BaseType.BOOLEAN,
      description: 'Whether the message was saved as draft',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'draft_id',
      type: BaseType.STRING,
      description: 'Draft ID (empty if sent directly)',
    }),
  ]
}

/** Node definition for answer */
export const answerDefinition: NodeDefinition<AnswerNodeData> = defineFromManifest(
  answerManifest as unknown as NodeManifest<AnswerNodeData>,
  { outputVariables: getAnswerOutputVariables as any }
)

// Back-compat re-exports so no consumer import churns:
export {
  answerNodeDataSchema,
  extractAnswerVariables,
  validateAnswerConfig,
} from '@auxx/lib/workflow-engine/client'

/** Default configuration for new answer nodes */
export const answerDefaultData = answerManifest.defaultData() as Partial<AnswerNodeData>
