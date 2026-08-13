// packages/lib/src/workflow-engine/catalog/nodes/http.ts

import { z } from 'zod'
import { HTTP_NODE_CONSTANTS } from '../../constants'
import type { BaseNodeData, TargetBranch } from '../node-base'
import {
  type NodeBranch,
  NodeCategory,
  type NodeManifest,
  type NodeValidationResult,
} from '../types'
import { extractVarIdsFromString } from '../variable-inference'

/**
 * The http node's catalog manifest. The request-shape enums and types below
 * were relocated from `apps/web/src/components/global/http-request/types.ts`
 * (which re-exports them) — they are shared between the workflow node, the
 * generic http-request UI, and the engine's `HttpProcessor`, which previously
 * shadowed them with its own `Http*Config` interfaces.
 *
 * Drift fixed during the move (plan §6): the deprecated duplicate
 * `httpNodeSchema` (zero consumers) was deleted; `httpNodeDataSchema` below is
 * the one schema.
 */

/** HTTP methods */
export enum Method {
  get = 'get',
  post = 'post',
  head = 'head',
  patch = 'patch',
  put = 'put',
  delete = 'delete',
}

/** Request body types */
export enum BodyType {
  none = 'none',
  formData = 'form-data',
  xWwwFormUrlencoded = 'x-www-form-urlencoded',
  rawText = 'raw-text',
  json = 'json',
  binary = 'binary',
}

/** Body payload value types */
export enum BodyPayloadValueType {
  text = 'text',
  file = 'file',
}

/** Authorization types the builder offers */
export enum AuthType {
  none = 'none',
  basic = 'basic',
  bearer = 'bearer',
  custom = 'custom',
  connection = 'connection',
}

/** Value selector type (for file references), e.g. `["sys", "files"]` */
export type ValueSelector = string[]

/** Key-value pair for headers/params editors */
export type KeyValue = {
  id?: string
  key: string
  keyEditorContent?: any // TipTap JSON for key editor
  value: string
  valueEditorContent?: any // TipTap JSON for value editor
  type?: string
  file?: ValueSelector
}

/** One positional body payload item */
export type BodyPayloadItem = {
  id?: string
  key?: string
  type: BodyPayloadValueType
  file?: ValueSelector // when type is file
  value?: string // when type is text
}

export type BodyPayload = BodyPayloadItem[]

/** Body configuration */
export type Body = { type: BodyType; data: BodyPayload }

/** Authorization configuration */
export type Authorization = {
  type: AuthType
  // For basic auth
  username?: string
  password?: string
  // For bearer/custom
  token?: string
  // For custom only
  header?: string
  // For connection — bound Credential id, resolved + applied at execute time
  connectionId?: string
}

/** Error handling strategy (workflow-node only) */
export enum ErrorStrategy {
  none = 'none',
  fail = 'fail',
  default = 'default',
}

/** Timeout configuration (seconds in the builder; the engine converts to ms) */
export type Timeout = { connect?: number; read?: number; write?: number }

/** Retry configuration */
export type RetryConfig = { retry_enabled: boolean; max_retries: number; retry_interval: number }

/** Default value item applied when `error_strategy` is 'default' */
export type DefaultValueItem = { key: string; type: string; value: string }

/** HTTP node data interface with flattened structure */
export interface HttpNodeData extends BaseNodeData {
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
 * Zod schema for HTTP node data (flattened structure)
 */
export const httpNodeDataSchema = z.object({
  // Base fields
  id: z.string(),
  type: z.literal('http'),
  title: z.string().min(1, 'Title is required'),
  desc: z.string().optional(),
  // HTTP-specific fields
  method: z.enum(Method),
  url: z.string(),
  authorization: z.object({
    type: z.enum(AuthType),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    header: z.string().optional(),
    connectionId: z.string().optional(),
  }),
  headers: z.string(),
  params: z.string(),
  body: z.object({
    type: z.enum(BodyType),
    data: z.array(
      z.object({
        id: z.string().optional(),
        key: z.string().optional(),
        type: z.string(),
        file: z.array(z.string()).optional(),
        value: z.string().optional(),
      })
    ),
  }),
  // Timeouts are persisted in SECONDS (the panel's unit; the engine converts
  // to ms at execute time). The old never-parsed schema bounded them with the
  // raw millisecond constants, so it rejected every value the builder actually
  // writes — including its own defaults. Divide like the validator always has.
  timeout: z.object({
    connect: z
      .number()
      .min(HTTP_NODE_CONSTANTS.TIMEOUT.CONNECTION.min / 1000)
      .max(HTTP_NODE_CONSTANTS.TIMEOUT.CONNECTION.max / 1000)
      .optional(),
    read: z
      .number()
      .min(HTTP_NODE_CONSTANTS.TIMEOUT.RESPONSE.min / 1000)
      .max(HTTP_NODE_CONSTANTS.TIMEOUT.RESPONSE.max / 1000)
      .optional(),
    write: z
      .number()
      .min(HTTP_NODE_CONSTANTS.TIMEOUT.TOTAL.min / 1000)
      .max(HTTP_NODE_CONSTANTS.TIMEOUT.TOTAL.max / 1000)
      .optional(),
  }),
  retry_config: z.object({
    retry_enabled: z.boolean(),
    max_retries: z
      .number()
      .min(HTTP_NODE_CONSTANTS.RETRY_CONFIG.MAX_RETRIES.min)
      .max(HTTP_NODE_CONSTANTS.RETRY_CONFIG.MAX_RETRIES.max),
    retry_interval: z
      .number()
      .min(HTTP_NODE_CONSTANTS.RETRY_CONFIG.RETRY_INTERVAL.min)
      .max(HTTP_NODE_CONSTANTS.RETRY_CONFIG.RETRY_INTERVAL.max),
  }),
  ssl_verify: z.boolean(),
  error_strategy: z.string(),
  default_value: z.array(z.object({ key: z.string(), type: z.string(), value: z.string() })),
  _targetBranches: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(['default', 'fail']).default('default'),
    })
  ),
})

/** Data validator for flattened structure */
export function validateHttpNodeData(data: Partial<HttpNodeData>): NodeValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Validate title
  if (!data.title?.trim()) {
    errors.push({ field: 'title', message: 'Title is required', type: 'error' })
  }

  // Validate URL
  if (!data.url?.trim()) {
    errors.push({ field: 'url', message: 'URL is required', type: 'error' })
  }

  // Validate timeout values
  if (data.timeout?.connect !== undefined) {
    const min = HTTP_NODE_CONSTANTS.TIMEOUT.CONNECTION.min / 1000
    const max = HTTP_NODE_CONSTANTS.TIMEOUT.CONNECTION.max / 1000
    if (data.timeout.connect < min || data.timeout.connect > max) {
      errors.push({
        field: 'timeout.connect',
        message: `Connection timeout must be between ${min} and ${max} seconds`,
        type: 'error',
      })
    }
  }

  if (data.timeout?.read !== undefined) {
    const min = HTTP_NODE_CONSTANTS.TIMEOUT.RESPONSE.min / 1000
    const max = HTTP_NODE_CONSTANTS.TIMEOUT.RESPONSE.max / 1000
    if (data.timeout.read < min || data.timeout.read > max) {
      errors.push({
        field: 'timeout.read',
        message: `Read timeout must be between ${min} and ${max} seconds`,
        type: 'error',
      })
    }
  }

  if (data.timeout?.write !== undefined) {
    const min = HTTP_NODE_CONSTANTS.TIMEOUT.TOTAL.min / 1000
    const max = HTTP_NODE_CONSTANTS.TIMEOUT.TOTAL.max / 1000
    if (data.timeout.write < min || data.timeout.write > max) {
      errors.push({
        field: 'timeout.write',
        message: `Write timeout must be between ${min} and ${max} seconds`,
        type: 'error',
      })
    }
  }

  // Validate retry config
  if (data.retry_config?.retry_enabled && data.retry_config?.max_retries !== undefined) {
    const min = HTTP_NODE_CONSTANTS.RETRY_CONFIG.MAX_RETRIES.min
    const max = HTTP_NODE_CONSTANTS.RETRY_CONFIG.MAX_RETRIES.max
    if (data.retry_config.max_retries < min || data.retry_config.max_retries > max) {
      errors.push({
        field: 'retry_config.max_retries',
        message: `Max retries must be between ${min} and ${max}`,
        type: 'error',
      })
    }
  }

  if (data.retry_config?.retry_enabled && data.retry_config?.retry_interval !== undefined) {
    const min = HTTP_NODE_CONSTANTS.RETRY_CONFIG.RETRY_INTERVAL.min
    const max = HTTP_NODE_CONSTANTS.RETRY_CONFIG.RETRY_INTERVAL.max
    if (data.retry_config.retry_interval < min || data.retry_config.retry_interval > max) {
      errors.push({
        field: 'retry_config.retry_interval',
        message: `Retry interval must be between ${min} and ${max} seconds`,
        type: 'error',
      })
    }
  }

  // Add warnings for optional but recommended fields
  if (!data.timeout) {
    errors.push({
      field: 'timeout',
      message: 'No timeout specified, using default values',
      type: 'warning',
    })
  }

  if (data.method === Method.post && !data.body?.data?.length) {
    errors.push({
      field: 'body',
      message: 'POST request has no body data',
      type: 'warning',
    })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/** Extract referenced variable IDs from HTTP node data */
export function extractHttpVariableIds(data: HttpNodeData): string[] {
  const variableIds = new Set<string>()

  // Extract from URL
  if (data.url) {
    extractVarIdsFromString(data.url).forEach((id) => variableIds.add(id))
  }

  // Extract from authorization
  if (data.authorization) {
    switch (data.authorization.type) {
      case AuthType.basic:
        if (data.authorization.username) {
          extractVarIdsFromString(data.authorization.username).forEach((id) => variableIds.add(id))
        }
        if (data.authorization.password) {
          extractVarIdsFromString(data.authorization.password).forEach((id) => variableIds.add(id))
        }
        break
      case AuthType.bearer:
        if (data.authorization.token) {
          extractVarIdsFromString(data.authorization.token).forEach((id) => variableIds.add(id))
        }
        break
      case AuthType.custom:
        if (data.authorization.token) {
          extractVarIdsFromString(data.authorization.token).forEach((id) => variableIds.add(id))
        }
        if (data.authorization.header) {
          extractVarIdsFromString(data.authorization.header).forEach((id) => variableIds.add(id))
        }
        break
    }
  }

  // Extract from headers
  if (data.headers) {
    extractVarIdsFromString(data.headers).forEach((id) => variableIds.add(id))
  }

  // Extract from params
  if (data.params) {
    extractVarIdsFromString(data.params).forEach((id) => variableIds.add(id))
  }

  // Extract from body (skip if method is GET or HEAD)
  if (data.method !== Method.get && data.method !== Method.head && data.body && data.body.data) {
    data.body.data.forEach((item) => {
      if (item.key) {
        extractVarIdsFromString(item.key).forEach((id) => variableIds.add(id))
      }
      if (item.value) {
        extractVarIdsFromString(item.value).forEach((id) => variableIds.add(id))
      }
    })
  }

  // Extract from default values
  if (data.default_value) {
    data.default_value.forEach((item) => {
      if (item.key) {
        extractVarIdsFromString(item.key).forEach((id) => variableIds.add(id))
      }
      if (item.value) {
        extractVarIdsFromString(item.value).forEach((id) => variableIds.add(id))
      }
    })
  }

  return Array.from(variableIds)
}

/**
 * HTTP node manifest
 */
export const httpManifest: NodeManifest<HttpNodeData> = {
  id: 'http',
  category: NodeCategory.UTILITY,
  displayName: 'HTTP Request',
  description: 'Make HTTP requests to external APIs',
  icon: 'globe',
  color: '#3B82F6', // UTILITY category color
  defaultData: () => ({
    title: 'HTTP Request',
    desc: 'Make HTTP requests to external APIs',
    method: Method.get,
    url: '',
    authorization: { type: AuthType.none },
    headers: '',
    params: '',
    body: { type: BodyType.none, data: [] },
    timeout: {
      connect: HTTP_NODE_CONSTANTS.TIMEOUT.CONNECTION.default / 1000, // Convert ms to seconds
      read: HTTP_NODE_CONSTANTS.TIMEOUT.RESPONSE.default / 1000,
      write: HTTP_NODE_CONSTANTS.TIMEOUT.TOTAL.default / 1000,
    },
    retry_config: {
      retry_enabled: false,
      max_retries: HTTP_NODE_CONSTANTS.RETRY_CONFIG.MAX_RETRIES.default,
      retry_interval: HTTP_NODE_CONSTANTS.RETRY_CONFIG.RETRY_INTERVAL.default,
    },
    ssl_verify: true,
    error_strategy: ErrorStrategy.default,
    default_value: [],
    _targetBranches: [{ id: 'source', name: '', type: 'default' }],
  }),
  configSchema: httpNodeDataSchema as unknown as z.ZodType<HttpNodeData>,
  validate: validateHttpNodeData,
  extractVariables: extractHttpVariableIds,
  connection: {
    canRunSingle: true,
    /**
     * Succeeded results leave via 'source'; a 'fail' branch exists only when
     * `error_strategy` is 'fail' — the handles the processor emits (#1560) and
     * `builder-rendered-handles.ts` declares. Mirrors the HTTP arm of the
     * canvas's `calculateTargetBranches` (workflow-initializer.ts), which stays
     * the derived-state writer until the remaining branch-deriving types
     * (text-classifier, crud) migrate and both converge here.
     */
    branches: (config): NodeBranch[] => {
      const branches: NodeBranch[] = [{ id: 'source', name: '', kind: 'default' }]
      if (config.error_strategy === ErrorStrategy.fail) {
        branches.push({ id: 'fail', name: 'Fail', kind: 'fail' })
      }
      return branches
    },
  },
  agent: {
    authorable: true,
    usage:
      '`url`, `headers` and `params` may contain {{…}} refs; headers/params are newline-separated ' +
      '`key: value` lines. `body.type` picks the encoding and `body.data` holds positional payload ' +
      "items ({ key, value }). Set `error_strategy` to 'fail' to expose a wirable 'fail' branch " +
      "handle; successful responses always leave via 'source' with status/headers/body/success outputs.",
    examples: [
      {
        description: 'GET an API with a bearer token from an upstream node',
        config: {
          method: 'get',
          url: 'https://api.example.com/orders/{{trigger-1.ticket.orderId}}',
          authorization: { type: 'bearer', token: '{{env.API_TOKEN}}' },
          headers: 'Accept: application/json',
          error_strategy: 'fail',
        },
      },
    ],
  },
}
