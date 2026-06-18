// apps/web/src/components/workflow/nodes/core/http/types.ts

import type { Authorization, Body, Method } from '~/components/global/http-request/types'
import type { TargetBranch } from '~/components/workflow/types'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

export type {
  Authorization,
  Body,
  BodyPayload,
  BodyPayloadItem,
  KeyValue,
  ValueSelector,
} from '~/components/global/http-request/types'
// Re-export the pure request-shape types/enums from their shared home so
// existing in-node imports (`./types`) keep working after the extraction.
export {
  AuthType,
  BodyPayloadValueType,
  BodyType,
  Method,
} from '~/components/global/http-request/types'

// Error handling strategy (workflow-node only)
export enum ErrorStrategy {
  none = 'none',
  fail = 'fail',
  default = 'default',
}

// Timeout configuration
export type Timeout = { connect?: number; read?: number; write?: number }

// Retry configuration
export type RetryConfig = { retry_enabled: boolean; max_retries: number; retry_interval: number }

// Default value item
export type DefaultValueItem = { key: string; type: string; value: string }

// HTTP node data interface with flattened structure
export interface HttpNodeData extends BaseNodeData {
  // Base fields
  title: string
  desc?: string
  // HTTP-specific fields
  method: Method
  url: string
  authorization: Authorization
  headers: string // newline-separated key:value pairs
  params: string // newline-separated key:value pairs
  body: Body
  timeout: Timeout
  retry_config: RetryConfig
  ssl_verify: boolean
  error_strategy: ErrorStrategy
  default_value: DefaultValueItem[]
  _targetBranches: TargetBranch[]
}

/**
 * Full HTTP node type for React Flow
 */
export type HttpNode = SpecificNode<'http', HttpNodeData>
