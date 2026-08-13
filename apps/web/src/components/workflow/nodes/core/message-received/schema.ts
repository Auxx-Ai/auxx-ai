// apps/web/src/components/workflow/nodes/core/message-received/schema.ts

import { messageReceivedManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { MessageReceivedNodeData } from './types'

// The data half (data interface, zod schema, defaults, validator, the
// unscoped-trigger warning, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/message-received`). This file is
// the merge site: manifest + the React parts.

/** Node definition for message-received */
export const messageReceivedDefinition: NodeDefinition<MessageReceivedNodeData> =
  defineFromManifest(
    messageReceivedManifest as unknown as NodeManifest<MessageReceivedNodeData>,
    {}
  )

// Back-compat re-exports so no panel or consumer import churns:
export {
  messageReceivedNodeDataSchema,
  UNSCOPED_MESSAGE_TRIGGER_WARNING,
  validateMessageReceivedConfig,
} from '@auxx/lib/workflow-engine/client'

/** Default data for new message-received nodes (flattened) */
export const messageReceivedDefaultData =
  messageReceivedManifest.defaultData() as Partial<MessageReceivedNodeData>
