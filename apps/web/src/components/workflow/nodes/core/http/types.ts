// apps/web/src/components/workflow/nodes/core/http/types.ts

import type { CatalogHttpNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/http`); re-exported here so no web
// import churns. HttpNodeData narrows `type` to the web NodeType enum, same
// as BaseNodeData does over its lib counterpart.
export type {
  Authorization,
  Body,
  BodyPayload,
  BodyPayloadItem,
  DefaultValueItem,
  HttpRetryConfig as RetryConfig,
  HttpTimeout as Timeout,
  KeyValue,
  ValueSelector,
} from '@auxx/lib/workflow-engine/client'
export {
  AuthType,
  BodyPayloadValueType,
  BodyType,
  ErrorStrategy,
  Method,
} from '@auxx/lib/workflow-engine/client'

/**
 * HTTP node data interface with flattened structure
 */
export interface HttpNodeData extends CatalogHttpNodeData {
  type: NodeType
}

/**
 * Full HTTP node type for React Flow
 */
export type HttpNode = SpecificNode<'http', HttpNodeData>
