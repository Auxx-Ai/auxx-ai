// apps/web/src/components/global/http-request/types.ts

// The pure request-shape enums and types moved to the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/http`, node-catalog Phase 1) so the
// workflow node, this generic http-request UI, and the engine's HttpProcessor
// all read one declaration. Re-exported here so no consumer import churns.
export {
  type Authorization,
  AuthType,
  type Body,
  type BodyPayload,
  type BodyPayloadItem,
  BodyPayloadValueType,
  BodyType,
  type KeyValue,
  Method,
  type ValueSelector,
} from '@auxx/lib/workflow-engine/client'
