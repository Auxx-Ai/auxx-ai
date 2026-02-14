// packages/lib/src/workflow-engine/nodes/action-nodes/http.ts

/**
 * HTTP Node Processor
 *
 * This node has been simplified to work with the new string-based TipTap format.
 * All TipTap content is now stored as simple strings with {{variableId}} syntax.
 *
 * Key changes:
 * - Removed complex TipTap document parsing
 * - All text fields now use simple string interpolation with {{variableId}}
 * - Headers and params use newline-separated key:value format
 * - Added helper method to extract variable IDs for debugging
 *
 * Variable format: {{nodeId_variableName}} where underscore separates node ID and variable path
 */

import { z } from 'zod'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

// Type definitions
// TipTap content is now stored as simple strings with {{variableId}} syntax
// No need for complex TipTap document parsing

interface HttpBodyConfig {
  type: 'none' | 'raw-text' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'binary'
  data: BodyPayloadItem[]
}

interface BodyPayloadItem {
  id: string
  type: 'text' | 'file'
  value?: string // For text type - contains string with {{variableId}} syntax
  file?: string[] // For file type - variable selector path
  key?: string // For form-data and x-www-form-urlencoded
}

interface HttpAuthConfig {
  type: 'none' | 'basic' | 'bearer' | 'custom' | 'api-key'
  username?: string
  password?: string
  token?: string
  header?: string
  api_key?: string
}

interface HttpTimeoutConfig {
  connect?: number
  read?: number
  write?: number
}

interface HttpRetryConfig {
  retry_enabled: boolean
  max_retries: number
  retry_interval: number // in milliseconds
}

interface DefaultValueConfig {
  key: string
  type: string
  value: string // String with {{variableId}} syntax
}

interface HttpNodeConfig {
  title?: string
  desc?: string
  url: string // String with {{variableId}} syntax
  method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head'
  headers: string // Newline-separated key:value pairs with {{variableId}} support
  params: string // Newline-separated key:value pairs with {{variableId}} support
  body: HttpBodyConfig
  authorization: HttpAuthConfig
  timeout: HttpTimeoutConfig
  ssl_verify: boolean
  retry_config: HttpRetryConfig
  error_strategy: 'fail' | 'none' | 'default'
  default_value: DefaultValueConfig[]
}

// Validation schema
const httpNodeConfigSchema = z.object({
  title: z.string().optional().default('Untitled'),
  url: z.string(), // String with {{variableId}} syntax
  method: z.enum(['get', 'post', 'put', 'patch', 'delete', 'head']),
  headers: z.string().optional().default(''),
  params: z.string().optional().default(''),
  body: z.object({
    type: z.enum(['none', 'raw-text', 'json', 'form-data', 'x-www-form-urlencoded', 'binary']),
    data: z.array(z.any()).default([]),
  }),
  authorization: z
    .object({ type: z.enum(['none', 'basic', 'bearer', 'custom', 'api-key']) })
    .passthrough(),
  timeout: z
    .object({
      connect: z.number().optional(),
      read: z.number().optional(),
      write: z.number().optional(),
    })
    .optional()
    .default({}),
  ssl_verify: z.boolean().optional().default(true),
  retry_config: z
    .object({
      retry_enabled: z.boolean(),
      max_retries: z.number().min(1).max(10),
      retry_interval: z.number().min(100).max(5000),
    })
    .optional()
    .default({ retry_enabled: false, max_retries: 1, retry_interval: 100 }),
  error_strategy: z.enum(['fail', 'none', 'default']).optional().default('fail'),
  default_value: z.array(z.any()).optional().default([]),
})

/**
 * HTTP Request node processor
 */
export class HttpProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.HTTP

  /**
   * Preprocess HTTP node - interpolate variables, validate configuration, prepare request data
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const configResult = httpNodeConfigSchema.safeParse(node.data)
    if (!configResult.success) {
      throw this.createProcessingError(
        `Invalid HTTP configuration: ${configResult.error!.issues.map((e) => e.message).join(', ')}`,
        node,
        {
          validationErrors: configResult.error.issues,
          configData: node.data,
        }
      )
    }

    const config = configResult.data as HttpNodeConfig

    // Do all the expensive interpolation and processing once
    const interpolatedUrl = await this.interpolateVariables(config.url, contextManager)
    if (!interpolatedUrl) {
      throw this.createProcessingError('URL is required for HTTP request', node, {
        originalUrl: config.url,
        interpolationContext: 'URL field is empty after variable interpolation',
      })
    }

    // Validate URL format
    try {
      new URL(interpolatedUrl)
    } catch (urlError: unknown) {
      const message = urlError instanceof Error ? urlError.message : ''
      throw this.createProcessingError(
        `Invalid URL format: ${interpolatedUrl}`,
        node,
        {
          originalUrl: config.url,
          interpolatedUrl,
          urlError: message,
        },
        urlError as Error
      )
    }

    // Process headers (reuse existing logic)
    const processedHeaders = await this.processHeaders(config.headers, contextManager)

    // Process params (reuse existing logic)
    const processedParams = await this.processParams(config.params, contextManager)

    // Process body (reuse existing logic)
    const processedBody = await this.processBodyForPreprocessing(config.body, contextManager, node)

    // Process auth (reuse existing logic)
    const processedAuth = await this.processAuthForPreprocessing(
      config.authorization,
      contextManager,
      node
    )

    // Extract variable references for debugging
    const usedVariables = new Set<string>()
    this.extractVariableIds(config.url).forEach((v) => usedVariables.add(v))
    if (config.headers) {
      this.extractVariableIds(config.headers).forEach((v) => usedVariables.add(v))
    }
    if (config.params) {
      this.extractVariableIds(config.params).forEach((v) => usedVariables.add(v))
    }

    return {
      inputs: {
        url: interpolatedUrl,
        method: config.method.toUpperCase(),
        headers: processedHeaders,
        params: processedParams,
        body: processedBody,
        bodyType: config.body.type,
        auth: processedAuth,
        sslVerify: config.ssl_verify,
        timeout: config.timeout,
        retryConfig: config.retry_config,
        errorStrategy: config.error_strategy,
        defaultValues: config.default_value || [],
        variablesUsed: Array.from(usedVariables),
      },
      metadata: {
        nodeType: 'http',
        method: config.method.toUpperCase(),
        hasBody: !!processedBody,
        bodyType: config.body.type,
        headerCount: Object.keys(processedHeaders).length,
        paramCount: Object.keys(processedParams).length,
        authType: processedAuth.type,
        variableCount: usedVariables.size,
        preprocessingComplete: true,
      },
    }
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const startTime = Date.now()

    // Use preprocessed data if available
    if (preprocessedData?.inputs) {
      const inputs = preprocessedData.inputs

      contextManager.log('INFO', node.name, 'Making HTTP request with preprocessed data', {
        method: inputs.method,
        url: inputs.url,
        hasBody: !!inputs.body,
        bodyType: inputs.bodyType,
        headerCount: Object.keys(inputs.headers).length,
        usedPreprocessedData: true,
      })

      try {
        // Convert preprocessed data to request format and execute with existing methods
        const requestOptions = await this.buildRequestFromPreprocessed(inputs)

        // Add query params to URL
        let finalUrl = inputs.url
        if (inputs.params && Object.keys(inputs.params).length > 0) {
          const url = new URL(inputs.url)
          Object.entries(inputs.params).forEach(([key, value]) => {
            url.searchParams.append(key, String(value))
          })
          finalUrl = url.toString()
        }

        // Use existing executeWithRetries method - no duplication!
        const response = await this.executeWithRetries(
          finalUrl,
          requestOptions,
          inputs.retryConfig,
          contextManager,
          node.nodeId
        )

        // Process response
        const result = await this.processResponse(response, node.nodeId, contextManager)

        // Store output variables
        this.storeOutputVariables(node.nodeId, result, contextManager)

        contextManager.log('INFO', node.name, 'HTTP request completed with preprocessed data', {
          statusCode: result.status,
          executionTime: Date.now() - startTime,
          usedPreprocessedData: true,
          preprocessingBenefit: 'Skipped variable interpolation and config processing',
        })

        return {
          status: NodeRunningStatus.Succeeded,
          output: result,
          outputHandle: 'source',
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : ''
        contextManager.log('ERROR', node.name, 'HTTP request failed with preprocessed data', {
          error: message,
          usedPreprocessedData: true,
        })
        throw error
      }
    }

    // Fallback to original implementation
    console.log('Executing HTTP node:', { nodeId: node.nodeId, node })
    try {
      // Parse and validate configuration from node.data
      const configResult = httpNodeConfigSchema.safeParse(node.data)

      if (!configResult.success) {
        contextManager.log('ERROR', node.name, 'Invalid HTTP node configuration', {
          errors: configResult.error!.issues,
        })
        return {
          status: NodeRunningStatus.Failed,
          error: `Invalid configuration: ${configResult.error!.issues.map((e) => e.message).join(', ')}`,
        }
      }

      const config = configResult.data as HttpNodeConfig

      // Extract all variable IDs used in this node for debugging
      const usedVariables = new Set<string>()

      // Check URL for variables
      if (config.url) {
        this.extractVariableIds(config.url).forEach((id) => usedVariables.add(id))
      }

      // Check headers for variables
      if (config.headers) {
        this.extractVariableIds(config.headers).forEach((id) => usedVariables.add(id))
      }

      // Check params for variables
      if (config.params) {
        this.extractVariableIds(config.params).forEach((id) => usedVariables.add(id))
      }

      // Check auth fields for variables
      Object.values(config.authorization).forEach((value) => {
        if (typeof value === 'string') {
          this.extractVariableIds(value).forEach((id) => usedVariables.add(id))
        }
      })

      // Check body data for variables (skip if method is GET or HEAD)
      if (config.method.toLowerCase() !== 'get' && config.method.toLowerCase() !== 'head') {
        config.body.data.forEach((item) => {
          if (item.value) {
            this.extractVariableIds(item.value).forEach((id) => usedVariables.add(id))
          }
          if (item.key) {
            this.extractVariableIds(item.key).forEach((id) => usedVariables.add(id))
          }
        })
      }

      contextManager.log('DEBUG', node.nodeId, 'Starting HTTP request', {
        method: config.method,
        hasAuth: config.authorization.type !== 'none',
        usedVariables: Array.from(usedVariables),
      })

      // Build the request
      const { url, options } = await this.buildRequest(config, contextManager, node)

      // Execute with retries if enabled
      const response = await this.executeWithRetries(
        url,
        options,
        config,
        contextManager,
        node.nodeId
      )

      // Process response
      const result = await this.processResponse(response, node.nodeId, contextManager)

      // Store output variables
      this.storeOutputVariables(node.nodeId, result, contextManager)

      contextManager.log('INFO', node.nodeId, 'HTTP request completed successfully', {
        status: result.status,
        executionTime: Date.now() - startTime,
      })

      return {
        status: NodeRunningStatus.Succeeded,
        output: result,
        outputHandle: 'source', // Standard output for action nodes
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      const errorMessage = this.formatError(error)

      contextManager.log('ERROR', node.nodeId, 'HTTP request failed', {
        error: errorMessage,
        executionTime,
      })

      // Handle error based on strategy
      const config = node.data as unknown as HttpNodeConfig

      if (config.error_strategy === 'none') {
        return {
          status: NodeRunningStatus.Succeeded,
          output: { error: errorMessage, status: 0 },
          outputHandle: 'error', // Error output handle
        }
      } else if (config.error_strategy === 'default' && config.default_value.length > 0) {
        const defaultValues = await this.processDefaultValues(config.default_value, contextManager)
        this.storeOutputVariables(node.nodeId, defaultValues, contextManager)

        return {
          status: NodeRunningStatus.Succeeded,
          output: defaultValues,
          outputHandle: 'source', // Standard output when using default values
        }
      }

      // Default: fail
      return {
        status: NodeRunningStatus.Failed,
        error: errorMessage,
        outputHandle: 'error', // Error output handle
      }
    }
  }

  /**
   * Extract variables from HTTP request configuration
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as HttpNodeConfig
    const variables = new Set<string>()

    // Extract from URL
    if (config.url && typeof config.url === 'string') {
      this.extractVariableIds(config.url).forEach((v) => variables.add(v))
    }

    // Extract from headers (newline-separated key:value format)
    if (config.headers && typeof config.headers === 'string') {
      this.extractVariableIds(config.headers).forEach((v) => variables.add(v))
    }

    // Extract from params (newline-separated key:value format)
    if (config.params && typeof config.params === 'string') {
      this.extractVariableIds(config.params).forEach((v) => variables.add(v))
    }

    // Extract from body data items
    if (config.body?.data && Array.isArray(config.body.data)) {
      config.body.data.forEach((item: BodyPayloadItem) => {
        if (item.value && typeof item.value === 'string') {
          this.extractVariableIds(item.value).forEach((v) => variables.add(v))
        }
        if (item.key && typeof item.key === 'string') {
          this.extractVariableIds(item.key).forEach((v) => variables.add(v))
        }
      })
    }

    // Extract from authorization fields
    if (config.authorization) {
      const auth = config.authorization
      if (auth.username) this.extractVariableIds(auth.username).forEach((v) => variables.add(v))
      if (auth.password) this.extractVariableIds(auth.password).forEach((v) => variables.add(v))
      if (auth.token) this.extractVariableIds(auth.token).forEach((v) => variables.add(v))
      if (auth.header) this.extractVariableIds(auth.header).forEach((v) => variables.add(v))
      if (auth.api_key) this.extractVariableIds(auth.api_key).forEach((v) => variables.add(v))
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // First check if node.data exists
    if (!node.data) {
      errors.push('Node data is required')
      return { valid: false, errors, warnings }
    }

    // Use the same validation schema as executeNode
    const configResult = httpNodeConfigSchema.safeParse(node.data)

    if (!configResult.success) {
      configResult.error!.issues.forEach((error) => {
        errors.push(`${error.path.join('.')}: ${error.message}`)
      })
      return { valid: false, errors, warnings }
    }

    const config = configResult.data

    // Additional validation beyond schema
    if (!config.url) {
      errors.push('URL is required')
    }

    // Validate timeout values
    if (config.timeout) {
      if (config.timeout.connect && config.timeout.connect < 0) {
        errors.push('Connect timeout must be positive')
      }
      if (config.timeout.read && config.timeout.read < 0) {
        errors.push('Read timeout must be positive')
      }
      if (config.timeout.write && config.timeout.write < 0) {
        errors.push('Write timeout must be positive')
      }
    }

    // Validate retry configuration
    if (config.retry_config?.retry_enabled) {
      if (config.retry_config.max_retries < 0 || config.retry_config.max_retries > 10) {
        errors.push('Max retries must be between 0 and 10')
      }
      if (config.retry_config.retry_interval < 0) {
        errors.push('Retry interval must be positive')
      }
    }

    // Validate body configuration
    if (config.body.type !== 'none' && (!config.body.data || config.body.data.length === 0)) {
      warnings.push('Body type is set but no data provided')
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Helper method to process text with variable interpolation
   */
  private async processText(
    value: string | undefined,
    contextManager: ExecutionContextManager
  ): Promise<string> {
    if (!value) return ''
    return await this.interpolateVariables(value, contextManager)
  }

  /**
   * Parse headers/params from newline-separated key:value pairs
   */
  private async parseKeyValuePairs(
    text: string,
    contextManager: ExecutionContextManager
  ): Promise<Record<string, string>> {
    if (!text || text.trim() === '') {
      return {}
    }

    const result: Record<string, string> = {}
    const lines = text.split('\n').filter((line) => line.trim())

    // Process all lines in parallel
    const linePromises = lines.map(async (line) => {
      const colonIndex = line.indexOf(':')
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim()
        const value = line.substring(colonIndex + 1).trim()
        if (key) {
          // Interpolate variables in both key and value in parallel
          const [processedKey, processedValue] = await Promise.all([
            this.processText(key, contextManager),
            this.processText(value, contextManager),
          ])
          return { key: processedKey, value: processedValue }
        }
      }
      return null
    })

    const processedLines = await Promise.all(linePromises)
    processedLines.forEach((item) => {
      if (item) {
        result[item.key] = item.value
      }
    })

    return result
  }

  /**
   * Build fetch request configuration
   */
  private async buildRequest(
    config: HttpNodeConfig,
    contextManager: ExecutionContextManager,
    node: WorkflowNode
  ): Promise<{ url: string; options: RequestInit }> {
    // Extract URL
    const url = await this.processText(config.url, contextManager)

    if (!url) {
      throw this.createExecutionError('URL is required', node, {
        originalUrl: config.url,
        interpolationResult: 'URL field is empty after processing',
      })
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw this.createExecutionError('URL must start with http:// or https://', node, {
        originalUrl: config.url,
        processedUrl: url,
      })
    }

    // Parse headers and params
    const headers = await this.parseKeyValuePairs(config.headers, contextManager)
    const params = await this.parseKeyValuePairs(config.params, contextManager)

    // Build auth headers
    const authHeaders = await this.buildAuthHeaders(config.authorization, contextManager)
    Object.assign(headers, authHeaders)

    // Build request body (skip for GET and HEAD requests)
    let data: any
    let contentType: string | undefined

    if (config.method.toLowerCase() !== 'get' && config.method.toLowerCase() !== 'head') {
      const bodyResult = await this.buildRequestBody(config.body, contextManager, node)
      data = bodyResult.data
      contentType = bodyResult.contentType
      if (contentType) {
        headers['Content-Type'] = contentType
      }
    }

    // Build timeout config
    const timeout = this.buildTimeout(config.timeout)

    // Build URL with query params
    const urlWithParams = new URL(url)
    Object.entries(params).forEach(([key, value]) => {
      urlWithParams.searchParams.append(key, value)
    })

    const options: RequestInit = {
      method: config.method.toUpperCase(),
      headers,
      body: data,
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
    }

    contextManager.log('DEBUG', node.nodeId, 'Built HTTP request', {
      url: urlWithParams.toString(),
      method: options.method,
      hasHeaders: Object.keys(headers).length > 0,
      hasParams: Object.keys(params).length > 0,
      hasBody: !!data,
    })

    return { url: urlWithParams.toString(), options }
  }

  /**
   * Build authentication headers
   */
  private async buildAuthHeaders(
    auth: HttpAuthConfig,
    contextManager: ExecutionContextManager
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}

    switch (auth.type) {
      case 'basic':
        if (auth.username && auth.password) {
          const username = await this.processText(auth.username, contextManager)
          const password = await this.processText(auth.password, contextManager)
          const credentials = Buffer.from(`${username}:${password}`).toString('base64')
          headers['Authorization'] = `Basic ${credentials}`
        }
        break

      case 'bearer':
        if (auth.token) {
          const token = await this.processText(auth.token, contextManager)
          headers['Authorization'] = `Bearer ${token}`
        }
        break

      case 'custom':
        if (auth.header && auth.token) {
          const headerName = await this.processText(auth.header, contextManager)
          const token = await this.processText(auth.token, contextManager)
          headers[headerName] = token
        }
        break

      case 'api-key':
        if (auth.api_key) {
          const apiKey = await this.processText(auth.api_key, contextManager)
          const headerName = auth.header
            ? await this.processText(auth.header, contextManager)
            : 'X-API-Key'
          headers[headerName] = apiKey
        }
        break
    }

    return headers
  }

  /**
   * Build request body based on type
   */
  private async buildRequestBody(
    bodyConfig: HttpBodyConfig,
    contextManager: ExecutionContextManager,
    node: WorkflowNode
  ): Promise<{ data: any; contentType?: string }> {
    switch (bodyConfig.type) {
      case 'none':
        return { data: undefined }

      case 'raw-text':
        if (bodyConfig.data.length > 0 && bodyConfig.data[0]?.value) {
          const text = await this.processText(bodyConfig.data[0].value, contextManager)
          return { data: text, contentType: 'text/plain' }
        }
        return { data: '' }

      case 'json':
        if (bodyConfig.data.length > 0 && bodyConfig.data[0]?.value) {
          const jsonText = await this.processText(bodyConfig.data[0].value, contextManager)
          try {
            const jsonData = JSON.parse(jsonText)
            return { data: JSON.stringify(jsonData), contentType: 'application/json' }
          } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e)
            throw this.createExecutionError(
              `Invalid JSON in request body: ${errorMessage}`,
              node,
              {
                bodyType: bodyConfig.type,
                jsonText: jsonText,
                originalError: errorMessage,
              },
              e as Error
            )
          }
        }
        return { data: '{}', contentType: 'application/json' }

      case 'form-data': {
        // For form-data, we need to use URLSearchParams for now
        // TODO: Implement proper multipart/form-data support
        const formParams = new URLSearchParams()

        // Process all text items in parallel
        const textItems = bodyConfig.data.filter(
          (item) => item.type === 'text' && item.key && item.value
        )
        const processedItems = await Promise.all(
          textItems.map(async (item) => {
            const [key, value] = await Promise.all([
              this.processText(item.key!, contextManager),
              this.processText(item.value!, contextManager),
            ])
            return { key, value }
          })
        )

        processedItems.forEach(({ key, value }) => {
          formParams.append(key, value)
        })

        // Log file uploads
        bodyConfig.data.forEach((item) => {
          if (item.type === 'file' && item.key && item.file) {
            contextManager.log('WARN', node.nodeId, 'File uploads not yet implemented', {
              key: item.key,
            })
          }
        })

        return { data: formParams.toString(), contentType: 'application/x-www-form-urlencoded' }
      }

      case 'x-www-form-urlencoded': {
        const urlParams = new URLSearchParams()

        // Process all items in parallel
        const textItems = bodyConfig.data.filter(
          (item) => item.type === 'text' && item.key && item.value
        )
        const processedItems = await Promise.all(
          textItems.map(async (item) => {
            const [key, value] = await Promise.all([
              this.processText(item.key!, contextManager),
              this.processText(item.value!, contextManager),
            ])
            return { key, value }
          })
        )

        processedItems.forEach(({ key, value }) => {
          urlParams.append(key, value)
        })

        return { data: urlParams.toString(), contentType: 'application/x-www-form-urlencoded' }
      }

      case 'binary':
        // TODO: Handle binary file uploads
        contextManager.log('WARN', node.nodeId, 'Binary uploads not yet implemented')
        return { data: undefined }

      default:
        return { data: undefined }
    }
  }

  /**
   * Build timeout configuration
   * Frontend sends timeout values in seconds, convert to milliseconds
   */
  private buildTimeout(timeoutConfig?: HttpTimeoutConfig): number {
    if (!timeoutConfig) {
      return 30000 // Default 30 seconds
    }

    // Convert seconds to milliseconds and use the maximum of all timeout values
    const timeouts = [
      (timeoutConfig.connect || 10) * 1000, // Default 10 seconds
      (timeoutConfig.read || 30) * 1000, // Default 30 seconds
      (timeoutConfig.write || 30) * 1000, // Default 30 seconds
    ]

    return Math.max(...timeouts)
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetries(
    url: string,
    options: RequestInit,
    config: HttpNodeConfig,
    contextManager: ExecutionContextManager,
    nodeId: string
  ): Promise<Response> {
    const maxRetries = config.retry_config.retry_enabled ? config.retry_config.max_retries : 0
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Convert retry_interval from seconds to milliseconds and apply exponential backoff
          const baseDelay = config.retry_config.retry_interval
          const delay = baseDelay * 2 ** (attempt - 1)
          contextManager.log(
            'INFO',
            nodeId,
            `Retrying HTTP request (attempt ${attempt + 1}/${maxRetries + 1})`,
            { delay }
          )
          await new Promise((resolve) => setTimeout(resolve, delay))
        }

        const response = await fetch(url, options)

        // Check if we should retry based on status code
        if (config.retry_config.retry_enabled && response.status >= 500 && attempt < maxRetries) {
          throw new Error(`Server error: ${response.status} ${response.statusText}`)
        }

        return response
      } catch (error) {
        lastError = error as Error

        // For fetch errors, check if it's a network error
        if (error instanceof TypeError && error.message.includes('fetch')) {
          // Network error, allow retry
        } else {
          // Other errors, don't retry
          throw error
        }

        // If this was the last attempt, throw the error
        if (attempt === maxRetries) {
          throw error
        }
      }
    }

    throw lastError || new Error('Request failed after all retries')
  }

  /**
   * Process HTTP response
   */
  private async processResponse(
    response: Response,
    nodeId: string,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    // Convert headers to plain object
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    const result: any = {
      status: response.status,
      statusText: response.statusText,
      headers,
      success: response.ok,
    }

    // Handle different content types
    const contentType = response.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      try {
        result.body = await response.json()
      } catch (e) {
        result.body = await response.text()
        contextManager.log('WARN', nodeId, 'Failed to parse JSON response', { error: e })
      }
    } else if (contentType.includes('text/') || contentType.includes('application/xml')) {
      result.body = await response.text()
    } else {
      // Binary or other content
      result.body = '[Binary content]'
    }

    return result
  }

  /**
   * Store output variables from response
   */
  private storeOutputVariables(
    nodeId: string,
    result: any,
    contextManager: ExecutionContextManager
  ): void {
    contextManager.setNodeVariable(nodeId, 'status', result.status || 0)
    contextManager.setNodeVariable(nodeId, 'headers', result.headers || {})
    contextManager.setNodeVariable(nodeId, 'body', result.body || '')
    contextManager.setNodeVariable(nodeId, 'success', result.success || false)

    if (result.error) {
      contextManager.setNodeVariable(nodeId, 'error', result.error)
    }

    // Store full response for backward compatibility
    contextManager.setNodeVariable(nodeId, 'response', result)
  }

  /**
   * Process default values when error strategy is 'use-default'
   */
  private async processDefaultValues(
    defaultValues: DefaultValueConfig[],
    contextManager: ExecutionContextManager
  ): Promise<any> {
    const result: any = { status: 200, success: true, body: {} }

    for (const defaultValue of defaultValues) {
      const value = await this.processText(defaultValue.value, contextManager)

      switch (defaultValue.type) {
        case 'string':
          result.body[defaultValue.key] = value
          break
        case 'number':
          result.body[defaultValue.key] = parseFloat(value) || 0
          break
        case 'boolean':
          result.body[defaultValue.key] = value.toLowerCase() === 'true'
          break
        case 'object':
        case 'array':
          try {
            result.body[defaultValue.key] = JSON.parse(value)
          } catch {
            result.body[defaultValue.key] = value
          }
          break
        default:
          result.body[defaultValue.key] = value
      }
    }

    return result
  }

  /**
   * Convert preprocessed data to fetch RequestInit format
   */
  private async buildRequestFromPreprocessed(inputs: any): Promise<RequestInit> {
    const headers: Record<string, string> = { ...inputs.headers }
    const options: RequestInit = { method: inputs.method, headers }

    // Add body if present
    if (inputs.body && inputs.bodyType !== 'none') {
      if (inputs.bodyType === 'json') {
        options.body = JSON.stringify(inputs.body)
        headers['Content-Type'] = 'application/json'
      } else if (inputs.bodyType === 'raw-text') {
        options.body = inputs.body
      } else if (inputs.bodyType === 'x-www-form-urlencoded') {
        const formData = new URLSearchParams()
        Object.entries(inputs.body).forEach(([key, value]) => {
          formData.append(key, String(value))
        })
        options.body = formData.toString()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
    }

    // Add auth if present
    if (inputs.auth.type === 'bearer') {
      headers['Authorization'] = `Bearer ${inputs.auth.token}`
    } else if (inputs.auth.type === 'basic') {
      const credentials = btoa(`${inputs.auth.username}:${inputs.auth.password}`)
      headers['Authorization'] = `Basic ${credentials}`
    } else if (inputs.auth.type === 'api-key') {
      headers[inputs.auth.headerName] = inputs.auth.apiKey
    }

    // Add timeout if specified
    if (inputs.timeout?.connect) {
      options.signal = AbortSignal.timeout(inputs.timeout.connect * 1000)
    }

    return options
  }

  /**
   * Process headers for preprocessing (extract from existing logic)
   */
  private async processHeaders(
    headers: string,
    contextManager: ExecutionContextManager
  ): Promise<Record<string, string>> {
    const processedHeaders: Record<string, string> = {}

    if (headers) {
      const headerLines = headers.split('\n').filter((line) => line.trim())

      // Process all headers in parallel
      const headerPromises = headerLines.map(async (line) => {
        const colonIndex = line.indexOf(':')
        if (colonIndex === -1) return null

        const key = line.substring(0, colonIndex).trim()
        const value = line.substring(colonIndex + 1).trim()

        if (key) {
          const interpolatedValue = await this.interpolateVariables(value, contextManager)
          return { key, value: interpolatedValue }
        }
        return null
      })

      const processedHeaderList = await Promise.all(headerPromises)
      processedHeaderList.forEach((header) => {
        if (header) {
          processedHeaders[header.key] = header.value
        }
      })
    }

    return processedHeaders
  }

  /**
   * Process params for preprocessing (extract from existing logic)
   */
  private async processParams(
    params: string,
    contextManager: ExecutionContextManager
  ): Promise<Record<string, string>> {
    const processedParams: Record<string, string> = {}

    if (params) {
      const paramLines = params.split('\n').filter((line) => line.trim())

      // Process all params in parallel
      const paramPromises = paramLines.map(async (line) => {
        const colonIndex = line.indexOf(':')
        if (colonIndex === -1) return null

        const key = line.substring(0, colonIndex).trim()
        const value = line.substring(colonIndex + 1).trim()

        if (key) {
          const interpolatedValue = await this.interpolateVariables(value, contextManager)
          return { key, value: interpolatedValue }
        }
        return null
      })

      const processedParamList = await Promise.all(paramPromises)
      processedParamList.forEach((param) => {
        if (param) {
          processedParams[param.key] = param.value
        }
      })
    }

    return processedParams
  }

  /**
   * Process body for preprocessing (simplified version of existing logic)
   */
  private async processBodyForPreprocessing(
    bodyConfig: HttpBodyConfig,
    contextManager: ExecutionContextManager,
    node: WorkflowNode
  ): Promise<any> {
    if (bodyConfig.type === 'none' || !bodyConfig.data || bodyConfig.data.length === 0) {
      return null
    }

    switch (bodyConfig.type) {
      case 'json': {
        const jsonData: Record<string, any> = {}
        for (const item of bodyConfig.data) {
          if (item.key && item.value !== undefined) {
            try {
              // Try to parse as JSON first, then interpolate
              let processedValue: any
              try {
                processedValue = JSON.parse(
                  await this.interpolateVariables(item.value, contextManager)
                )
              } catch {
                processedValue = await this.interpolateVariables(item.value, contextManager)
              }
              jsonData[item.key] = processedValue
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : ''

              throw this.createProcessingError(
                `Failed to process JSON field ${item.key}: ${message}`,
                node,
                {
                  bodyType: bodyConfig.type,
                  fieldKey: item.key,
                  fieldValue: item.value,
                  originalError: message,
                },
                error as Error
              )
            }
          }
        }
        return jsonData
      }

      case 'raw-text': {
        const textItem = bodyConfig.data[0]
        return textItem?.value
          ? await this.interpolateVariables(textItem!.value, contextManager)
          : ''
      }

      case 'x-www-form-urlencoded': {
        const formData: Record<string, any> = {}
        for (const item of bodyConfig.data) {
          if (item.key && item.value !== undefined) {
            formData[item.key] = await this.interpolateVariables(item.value, contextManager)
          }
        }
        return formData
      }

      default:
        return null
    }
  }

  /**
   * Process auth for preprocessing (simplified version of existing logic)
   */
  private async processAuthForPreprocessing(
    authConfig: HttpAuthConfig,
    contextManager: ExecutionContextManager,
    node: WorkflowNode
  ): Promise<any> {
    const processedAuth = { type: authConfig.type }

    switch (authConfig.type) {
      case 'basic':
        if (!authConfig.username || !authConfig.password) {
          throw this.createProcessingError('Basic auth requires username and password', node, {
            authType: authConfig.type,
            hasUsername: !!authConfig.username,
            hasPassword: !!authConfig.password,
          })
        }
        return {
          ...processedAuth,
          username: await this.interpolateVariables(authConfig.username, contextManager),
          password: await this.interpolateVariables(authConfig.password, contextManager),
        }

      case 'bearer':
        if (!authConfig.token) {
          throw this.createProcessingError('Bearer auth requires token', node, {
            authType: authConfig.type,
            hasToken: !!authConfig.token,
          })
        }
        return {
          ...processedAuth,
          token: await this.interpolateVariables(authConfig.token, contextManager),
        }

      case 'api-key':
        if (!authConfig.api_key || !authConfig.header) {
          throw this.createProcessingError('API key auth requires api_key and header name', node, {
            authType: authConfig.type,
            hasApiKey: !!authConfig.api_key,
            hasHeader: !!authConfig.header,
          })
        }
        return {
          ...processedAuth,
          apiKey: await this.interpolateVariables(authConfig.api_key, contextManager),
          headerName: authConfig.header,
        }

      default:
        return processedAuth
    }
  }

  /**
   * Format error messages
   */
  private formatError(error: any): string {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return `Network error: ${error.message}`
    }

    if (error.name === 'AbortError') {
      return 'Request timeout'
    }

    return error.message || 'Unknown error'
  }
}
