// apps/web/src/components/workflow/nodes/shared/base/base-executor.ts

import { ExecutionContext, ExecutionResult, ServiceContainer } from '~/components/workflow/types'

/**
 * Base executor class that provides common functionality for node execution
 */
export abstract class BaseExecutor<TConfig = any, TOutput = any> {
  protected config: TConfig
  protected context: ExecutionContext
  protected services: ServiceContainer

  constructor(config: TConfig, context: ExecutionContext, services: ServiceContainer) {
    this.config = config
    this.context = context
    this.services = services
  }

  /**
   * Abstract method that subclasses must implement
   */
  abstract execute(): Promise<ExecutionResult<TOutput>>

  /**
   * Helper method to create a successful result
   */
  protected success(outputs: TOutput, metadata?: Record<string, any>): ExecutionResult<TOutput> {
    return {
      status: 'success',
      outputs,
      metadata,
      duration: 0, // This would be calculated by the execution engine
    }
  }

  /**
   * Helper method to create an error result
   */
  protected error(error: Error | string, metadata?: Record<string, any>): ExecutionResult<TOutput> {
    return {
      status: 'error',
      error: typeof error === 'string' ? new Error(error) : error,
      metadata,
      duration: 0,
    }
  }

  /**
   * Helper method to create a skip result
   */
  protected skip(metadata?: Record<string, any>): ExecutionResult<TOutput> {
    return { status: 'skip', metadata, duration: 0 }
  }

  /**
   * Helper method to resolve variable selectors
   */
  protected resolveVariable(selector: string[]): any {
    let value = this.context.variables

    for (const key of selector) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key]
      } else {
        return undefined
      }
    }

    return value
  }

  /**
   * Helper method to log execution info
   */
  protected log(message: string, data?: any): void {
    console.log(`[${this.context.nodeId}] ${message}`, data)
  }
}
