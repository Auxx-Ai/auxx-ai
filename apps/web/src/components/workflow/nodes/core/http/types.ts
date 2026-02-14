// apps/web/src/components/workflow/nodes/core/http/types.ts

import type { TargetBranch } from '~/components/workflow/types'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'
import { NodeType } from '~/components/workflow/types/node-types'

// HTTP methods enum
export enum Method {
  get = 'get',
  post = 'post',
  head = 'head',
  patch = 'patch',
  put = 'put',
  delete = 'delete',
}

// Body types enum
export enum BodyType {
  none = 'none',
  formData = 'form-data',
  xWwwFormUrlencoded = 'x-www-form-urlencoded',
  rawText = 'raw-text',
  json = 'json',
  binary = 'binary',
}

// Body payload value types
export enum BodyPayloadValueType {
  text = 'text',
  file = 'file',
}

// Authorization types
export enum AuthType {
  none = 'none',
  basic = 'basic',
  bearer = 'bearer',
  custom = 'custom',
}
export enum ErrorStrategy {
  none = 'none',
  fail = 'fail',
  default = 'default',
}

// Value selector type (for file references)
export type ValueSelector = string[] // e.g., ["sys", "files"]

// Key-value pair type
export type KeyValue = {
  id?: string
  key: string
  keyEditorContent?: any // TipTap JSON for key editor
  value: string
  valueEditorContent?: any // TipTap JSON for value editor
  type?: string
  file?: ValueSelector
}

// Body payload item type
export type BodyPayloadItem = {
  id?: string
  key?: string
  type: BodyPayloadValueType
  file?: ValueSelector // when type is file
  value?: string // when type is text
}

// Body payload array
export type BodyPayload = BodyPayloadItem[]

// Body configuration
export type Body = { type: BodyType; data: BodyPayload }

// Authorization configuration
export type Authorization = {
  type: AuthType
  // For basic auth
  username?: string
  password?: string
  // For bearer/custom
  token?: string
  // For custom only
  header?: string
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
