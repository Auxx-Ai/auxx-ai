// packages/lib/src/workflow-engine/utils/state-serialization.ts

import type { ExecutionState, NodeExecutionResult } from '../core/types'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('state-serialization')

export class StateSerializer {
  /**
   * Serialize execution state for database storage
   */
  static serialize(state: ExecutionState): any {
    try {
      return {
        executionId: state.executionId,
        workflowId: state.workflowId,
        status: state.status,
        currentNodeId: state.currentNodeId,
        visitedNodes: Array.from(state.visitedNodes),
        nodeResults: this.serializeNodeResults(state.nodeResults),
        context: {
          variables: this.serializeVariables(state.context.variables),
          systemVariables: state.context.systemVariables,
          nodeVariables: state.context.nodeVariables,
          logs: state.context.logs,
          executionPath: state.context.executionPath,
        },
        startedAt: state.startedAt.toISOString(),
        pausedAt: state.pausedAt?.toISOString(),
        pauseReason: state.pauseReason,
        resumeData: state.resumeData,
        // Include execution tracking for pause/resume depth tracking
        executionTracking: state.executionTracking,
      }
    } catch (error) {
      logger.error('Failed to serialize execution state', {
        executionId: state.executionId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Deserialize execution state from database
   */
  static deserialize(data: any): ExecutionState {
    try {
      return {
        executionId: data.executionId,
        workflowId: data.workflowId,
        status: data.status,
        currentNodeId: data.currentNodeId,
        visitedNodes: new Set(data.visitedNodes || []),
        nodeResults: this.deserializeNodeResults(data.nodeResults || {}),
        context: {
          variables: data.context?.variables || {},
          systemVariables: data.context?.systemVariables || {},
          nodeVariables: data.context?.nodeVariables || {},
          logs: data.context?.logs || [],
          executionPath: data.context?.executionPath || [],
        },
        startedAt: new Date(data.startedAt),
        pausedAt: data.pausedAt ? new Date(data.pausedAt) : undefined,
        pauseReason: data.pauseReason,
        resumeData: data.resumeData,
        // Restore execution tracking for pause/resume depth tracking
        executionTracking: data.executionTracking,
      }
    } catch (error) {
      logger.error('Failed to deserialize execution state', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Serialize node results, handling circular references and special types
   */
  private static serializeNodeResults(
    nodeResults: Record<string, NodeExecutionResult>
  ): Record<string, any> {
    const serialized: Record<string, any> = {}

    for (const [nodeId, result] of Object.entries(nodeResults)) {
      try {
        serialized[nodeId] = {
          ...result,
          output: this.serializeValue(result.output),
          processData: this.serializeValue(result.processData),
          metadata: this.serializeValue(result.metadata),
        }
      } catch (error) {
        logger.warn('Failed to serialize node result', {
          nodeId,
          error: error instanceof Error ? error.message : String(error),
        })
        // Store basic info if full serialization fails
        serialized[nodeId] = {
          nodeId: result.nodeId,
          status: result.status,
          error: result.error,
          executionTime: result.executionTime,
        }
      }
    }

    return serialized
  }

  /**
   * Deserialize node results
   */
  private static deserializeNodeResults(
    data: Record<string, any>
  ): Record<string, NodeExecutionResult> {
    const deserialized: Record<string, NodeExecutionResult> = {}

    for (const [nodeId, result] of Object.entries(data)) {
      try {
        deserialized[nodeId] = {
          ...result,
          output: this.deserializeValue(result.output),
          processData: this.deserializeValue(result.processData),
          metadata: this.deserializeValue(result.metadata),
        }
      } catch (error) {
        logger.warn('Failed to deserialize node result', {
          nodeId,
          error: error instanceof Error ? error.message : String(error),
        })
        // Use raw data if deserialization fails
        deserialized[nodeId] = result
      }
    }

    return deserialized
  }

  /**
   * Serialize variables, handling circular references
   */
  private static serializeVariables(variables: Record<string, any>): Record<string, any> {
    const serialized: Record<string, any> = {}

    for (const [key, value] of Object.entries(variables)) {
      try {
        serialized[key] = this.serializeValue(value)
      } catch (error) {
        logger.warn('Failed to serialize variable', {
          key,
          error: error instanceof Error ? error.message : String(error),
        })
        // Store as string if serialization fails
        serialized[key] = String(value)
      }
    }

    return serialized
  }

  /**
   * Serialize a single value, handling special types
   */
  private static serializeValue(value: any): any {
    if (value === null || value === undefined) {
      return value
    }

    // Handle dates
    if (value instanceof Date) {
      return {
        __type: 'Date',
        value: value.toISOString(),
      }
    }

    // Handle buffers
    if (Buffer.isBuffer(value)) {
      return {
        __type: 'Buffer',
        value: value.toString('base64'),
      }
    }

    // Handle functions (store as string)
    if (typeof value === 'function') {
      return {
        __type: 'Function',
        value: value.toString(),
      }
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.serializeValue(item))
    }

    // Handle objects
    if (typeof value === 'object') {
      const serialized: any = {}
      for (const [k, v] of Object.entries(value)) {
        serialized[k] = this.serializeValue(v)
      }
      return serialized
    }

    // Primitive values
    return value
  }

  /**
   * Deserialize a single value, restoring special types
   */
  private static deserializeValue(value: any): any {
    if (value === null || value === undefined) {
      return value
    }

    // Check for special types
    if (typeof value === 'object' && value.__type) {
      switch (value.__type) {
        case 'Date':
          return new Date(value.value)
        case 'Buffer':
          return Buffer.from(value.value, 'base64')
        case 'Function':
          // Don't restore functions for security reasons
          return undefined
        default:
          return value
      }
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.deserializeValue(item))
    }

    // Handle objects
    if (typeof value === 'object') {
      const deserialized: any = {}
      for (const [k, v] of Object.entries(value)) {
        deserialized[k] = this.deserializeValue(v)
      }
      return deserialized
    }

    // Primitive values
    return value
  }

  /**
   * Create a minimal state for storage (reduces size)
   */
  static createMinimalState(state: ExecutionState): any {
    return {
      executionId: state.executionId,
      workflowId: state.workflowId,
      status: state.status,
      currentNodeId: state.currentNodeId,
      pauseReason: state.pauseReason,
      // Only store essential context
      context: {
        variables: state.context.variables,
        systemVariables: state.context.systemVariables,
      },
      startedAt: state.startedAt.toISOString(),
      pausedAt: state.pausedAt?.toISOString(),
    }
  }

  /**
   * Validate serialized state structure
   */
  static validateSerializedState(data: any): boolean {
    try {
      // Check required fields
      if (!data.executionId || !data.workflowId || !data.status) {
        return false
      }

      // Check context structure
      if (!data.context || typeof data.context !== 'object') {
        return false
      }

      // Check dates
      if (!data.startedAt || isNaN(Date.parse(data.startedAt))) {
        return false
      }

      return true
    } catch {
      return false
    }
  }
}
