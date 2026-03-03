// apps/lambda/src/types.ts

/**
 * Type definitions for Lambda server function executor
 */

import type { ValidatedExecutionContext, ValidatedLambdaEvent } from './validator.ts'

/**
 * Lambda event from API (derived from Zod schema)
 */
export type LambdaEvent = ValidatedLambdaEvent

/**
 * Execution context (org, user, app) (derived from Zod schema)
 */
export type ExecutionContext = ValidatedExecutionContext

/**
 * Lambda response
 */
export interface LambdaResponse {
  statusCode: number
  body: string // JSON-stringified
}

/**
 * Execution options
 */
export interface ExecutionOptions {
  bundleCode: string
  functionIdentifier: string
  functionArgs: string
  context: RuntimeContext
  timeout: number
  memoryLimit: number
}

/**
 * Connection data passed in runtime context
 */
export interface ConnectionData {
  id: string
  type: 'oauth2-code' | 'secret'
  value: string // Decrypted token/key/secret
  metadata?: {
    scope?: string
    externalUserId?: string
    tokenType?: string
    [key: string]: any
  }
  expiresAt?: string // ISO string
}

/**
 * Runtime context available to server functions
 */
export interface RuntimeContext {
  organization: {
    id: string
    handle: string
  }
  user: {
    id: string
    email: string | null | undefined
    name: string | null | undefined
  }
  app: {
    id: string
    installationId: string
  }
  fetch: typeof fetch
  env: string
  apiUrl: string // Platform API URL for SDK functions

  // Connection data (decrypted and passed from API)
  userConnection?: ConnectionData
  organizationConnection?: ConnectionData

  // Scoped callback tokens for SDK → API authentication
  callbackTokens?: {
    webhooks: string
    settings: string
  }
}

/**
 * Console log entry captured during execution
 */
export interface ConsoleLog {
  level: 'log' | 'warn' | 'error'
  message: string
  args: any[]
  timestamp: number
}

/**
 * Structured validation error from a workflow block's execute() function.
 */
export interface BlockValidationErrorData {
  fields: Array<{ field: string; message: string }>
  message: string
}

/**
 * Execution result with metadata
 */
export interface ExecutionResult {
  /** Function execution result */
  result: any

  /** Execution metadata */
  metadata?: {
    /** Registered settings schema (if any) */
    settingsSchema?: any
    /** Console logs captured during execution */
    consoleLogs?: ConsoleLog[]
    /** Structured validation error (replaces throwing for input validation failures) */
    validationError?: BlockValidationErrorData
  }
}
