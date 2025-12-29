// apps/web/src/components/workflow/nodes/core/http/schema.ts

import { z } from 'zod'
import { HTTP_NODE_CONSTANTS } from '@auxx/lib/workflow-engine/constants'
import { NodeType } from '~/components/workflow/types/node-types'
import { NodeCategory } from '~/components/workflow/types/registry'
import type { NodeDefinition, ValidationResult } from '~/components/workflow/types/registry'
import type { OutputVariable } from '~/components/workflow/types/variable-types'
import { BaseType } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { HttpNodePanel } from './panel'
import { type HttpNodeData } from './types'
import { Method, BodyType, AuthType, ErrorStrategy } from './types'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import _ from 'lodash'

// Zod schema for validation (config - deprecated)
export const httpNodeSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  desc: z.string().optional(),
  method: z.enum(Method),
  url: z.string(),
  authorization: z.object({
    type: z.enum(AuthType),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    header: z.string().optional(),
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
  timeout: z.object({
    connect: z
      .number()
      .min(HTTP_NODE_CONSTANTS.TIMEOUT.CONNECTION.min)
      .max(HTTP_NODE_CONSTANTS.TIMEOUT.CONNECTION.max)
      .optional(),
    read: z
      .number()
      .min(HTTP_NODE_CONSTANTS.TIMEOUT.RESPONSE.min)
      .max(HTTP_NODE_CONSTANTS.TIMEOUT.RESPONSE.max)
      .optional(),
    write: z
      .number()
      .min(HTTP_NODE_CONSTANTS.TIMEOUT.TOTAL.min)
      .max(HTTP_NODE_CONSTANTS.TIMEOUT.TOTAL.max)
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

// Zod schema for HTTP node data (flattened structure)
export const httpNodeDataSchema = z.object({
  // Base fields
  id: z.string(),
  type: z.literal(NodeType.HTTP),
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
  timeout: z.object({
    connect: z
      .number()
      .min(HTTP_NODE_CONSTANTS.TIMEOUT.CONNECTION.min)
      .max(HTTP_NODE_CONSTANTS.TIMEOUT.CONNECTION.max)
      .optional(),
    read: z
      .number()
      .min(HTTP_NODE_CONSTANTS.TIMEOUT.RESPONSE.min)
      .max(HTTP_NODE_CONSTANTS.TIMEOUT.RESPONSE.max)
      .optional(),
    write: z
      .number()
      .min(HTTP_NODE_CONSTANTS.TIMEOUT.TOTAL.min)
      .max(HTTP_NODE_CONSTANTS.TIMEOUT.TOTAL.max)
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

// Default data factory for flattened structure
export function createHttpDefaultData(): Partial<HttpNodeData> {
  return {
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
  }
}

// Data validator for flattened structure
export function validateHttpNodeData(data: Partial<HttpNodeData>): ValidationResult {
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

// Variable extraction - returns empty array as requested
export function extractHttpVariableIds(data: HttpNodeData): string[] {
  // Empty implementation as requested
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

// Output variables for HTTP node
export function getHttpOutputVariables(data: HttpNodeData, nodeId: string): OutputVariable[] {
  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'status', // Changed from 'name' to 'path'
      type: BaseType.NUMBER,
      description: 'HTTP response status code',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'headers', // Changed from 'name' to 'path'
      type: BaseType.OBJECT,
      description: 'HTTP response headers',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'body', // Changed from 'name' to 'path'
      type: BaseType.ANY,
      description: 'HTTP response body',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'success', // Changed from 'name' to 'path'
      type: BaseType.BOOLEAN,
      description: 'Whether the HTTP request was successful',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'error', // Changed from 'name' to 'path'
      type: BaseType.STRING,
      description: 'Error message if the request failed',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'response', // Changed from 'name' to 'path'
      type: BaseType.OBJECT,
      description: 'Full HTTP response object',
    }),
  ]
}

// Node definition
export const httpNodeDefinition: NodeDefinition<HttpNodeData> = {
  id: NodeType.HTTP,
  category: NodeCategory.UTILITY,
  displayName: 'HTTP Request',
  description: 'Make HTTP requests to external APIs',
  icon: 'globe',
  color: '#3B82F6', // UTILITY category color
  defaultData: createHttpDefaultData(),
  schema: httpNodeDataSchema,
  panel: HttpNodePanel,
  validator: validateHttpNodeData,
  canRunSingle: true,
  extractVariables: extractHttpVariableIds,
  outputVariables: getHttpOutputVariables as any,
}
