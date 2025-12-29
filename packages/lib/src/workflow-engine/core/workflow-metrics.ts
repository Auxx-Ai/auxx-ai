// packages/lib/src/workflow-engine/core/workflow-metrics.ts

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('workflow-metrics')

/**
 * Metrics for workflow execution
 */
interface ExecutionMetrics {
  workflowId: string
  executionId: string
  startTime: number
  endTime?: number
  duration?: number
  nodeCount: number
  parallelBranches: number
  joinPoints: number
  errors: number
  pauses: number
}

/**
 * Metrics for parallel execution
 */
interface ParallelMetrics {
  forkNodeId: string
  branchCount: number
  startTime: number
  completionTimes: Map<string, number>
  slowestBranch?: string
  fastestBranch?: string
  averageBranchTime?: number
}

/**
 * Collects and reports workflow execution metrics
 */
export class WorkflowMetricsCollector {
  private executionMetrics = new Map<string, ExecutionMetrics>()
  private parallelMetrics = new Map<string, ParallelMetrics[]>()
  private nodeTimings = new Map<string, Map<string, { start: number; end?: number }>>()

  /**
   * Start tracking a workflow execution
   */
  startExecution(workflowId: string, executionId: string): void {
    this.executionMetrics.set(executionId, {
      workflowId,
      executionId,
      startTime: Date.now(),
      nodeCount: 0,
      parallelBranches: 0,
      joinPoints: 0,
      errors: 0,
      pauses: 0,
    })
  }

  /**
   * End tracking a workflow execution
   */
  endExecution(executionId: string): ExecutionMetrics | undefined {
    const metrics = this.executionMetrics.get(executionId)
    if (!metrics) return undefined

    metrics.endTime = Date.now()
    metrics.duration = metrics.endTime - metrics.startTime

    logger.info('Workflow execution completed', {
      executionId,
      duration: `${metrics.duration}ms`,
      nodeCount: metrics.nodeCount,
      parallelBranches: metrics.parallelBranches,
      errors: metrics.errors,
    })

    return metrics
  }

  /**
   * Track node execution start
   */
  nodeStart(executionId: string, nodeId: string): void {
    const metrics = this.executionMetrics.get(executionId)
    if (metrics) {
      metrics.nodeCount++
    }

    if (!this.nodeTimings.has(executionId)) {
      this.nodeTimings.set(executionId, new Map())
    }

    this.nodeTimings.get(executionId)!.set(nodeId, {
      start: Date.now(),
    })
  }

  /**
   * Track node execution end
   */
  nodeEnd(executionId: string, nodeId: string): void {
    const timings = this.nodeTimings.get(executionId)?.get(nodeId)
    if (timings) {
      timings.end = Date.now()
    }
  }

  /**
   * Track parallel branch start
   */
  parallelStart(executionId: string, forkNodeId: string, branchCount: number): void {
    const metrics = this.executionMetrics.get(executionId)
    if (metrics) {
      metrics.parallelBranches += branchCount
    }

    if (!this.parallelMetrics.has(executionId)) {
      this.parallelMetrics.set(executionId, [])
    }

    this.parallelMetrics.get(executionId)!.push({
      forkNodeId,
      branchCount,
      startTime: Date.now(),
      completionTimes: new Map(),
    })
  }

  /**
   * Track branch completion
   */
  branchComplete(executionId: string, forkNodeId: string, branchId: string): void {
    const execMetrics = this.parallelMetrics.get(executionId)
    if (!execMetrics) return

    const forkMetrics = execMetrics.find((m) => m.forkNodeId === forkNodeId)
    if (forkMetrics) {
      forkMetrics.completionTimes.set(branchId, Date.now())

      // Update statistics if all branches completed
      if (forkMetrics.completionTimes.size === forkMetrics.branchCount) {
        this.calculateParallelStats(forkMetrics)
      }
    }
  }

  /**
   * Track join point execution
   */
  joinExecuted(executionId: string): void {
    const metrics = this.executionMetrics.get(executionId)
    if (metrics) {
      metrics.joinPoints++
    }
  }

  /**
   * Track execution error
   */
  recordError(executionId: string): void {
    const metrics = this.executionMetrics.get(executionId)
    if (metrics) {
      metrics.errors++
    }
  }

  /**
   * Track execution pause
   */
  recordPause(executionId: string): void {
    const metrics = this.executionMetrics.get(executionId)
    if (metrics) {
      metrics.pauses++
    }
  }

  /**
   * Calculate parallel execution statistics
   */
  private calculateParallelStats(metrics: ParallelMetrics): void {
    const times: number[] = []
    let slowest = { branch: '', time: 0 }
    let fastest = { branch: '', time: Infinity }

    metrics.completionTimes.forEach((endTime, branchId) => {
      const duration = endTime - metrics.startTime
      times.push(duration)

      if (duration > slowest.time) {
        slowest = { branch: branchId, time: duration }
      }
      if (duration < fastest.time) {
        fastest = { branch: branchId, time: duration }
      }
    })

    metrics.slowestBranch = slowest.branch
    metrics.fastestBranch = fastest.branch
    metrics.averageBranchTime = times.reduce((a, b) => a + b, 0) / times.length

    logger.debug('Parallel execution stats', {
      forkNode: metrics.forkNodeId,
      branches: metrics.branchCount,
      slowest: `${slowest.branch} (${slowest.time}ms)`,
      fastest: `${fastest.branch} (${fastest.time}ms)`,
      average: `${metrics.averageBranchTime.toFixed(2)}ms`,
    })
  }

  /**
   * Get execution summary
   */
  getExecutionSummary(executionId: string) {
    const execution = this.executionMetrics.get(executionId)
    const parallel = this.parallelMetrics.get(executionId) || []
    const nodeTimes = this.nodeTimings.get(executionId) || new Map()

    // Calculate node execution times
    const nodeStats: Array<{ nodeId: string; duration: number }> = []
    nodeTimes.forEach((timing, nodeId) => {
      if (timing.end) {
        nodeStats.push({
          nodeId,
          duration: timing.end - timing.start,
        })
      }
    })

    // Sort by duration to find slowest nodes
    nodeStats.sort((a, b) => b.duration - a.duration)

    return {
      execution,
      parallel: parallel.map((p) => ({
        forkNode: p.forkNodeId,
        branches: p.branchCount,
        slowest: p.slowestBranch,
        fastest: p.fastestBranch,
        averageTime: p.averageBranchTime,
      })),
      slowestNodes: nodeStats.slice(0, 5),
      totalNodes: nodeStats.length,
    }
  }

  /**
   * Clear metrics for an execution
   */
  clearExecution(executionId: string): void {
    this.executionMetrics.delete(executionId)
    this.parallelMetrics.delete(executionId)
    this.nodeTimings.delete(executionId)
  }

  /**
   * Get global statistics
   */
  getGlobalStats() {
    const completedExecutions = Array.from(this.executionMetrics.values()).filter((m) => m.endTime)

    if (completedExecutions.length === 0) {
      return { message: 'No completed executions' }
    }

    const totalDuration = completedExecutions.reduce((sum, m) => sum + (m.duration || 0), 0)
    const totalNodes = completedExecutions.reduce((sum, m) => sum + m.nodeCount, 0)
    const totalErrors = completedExecutions.reduce((sum, m) => sum + m.errors, 0)

    return {
      totalExecutions: completedExecutions.length,
      averageDuration: totalDuration / completedExecutions.length,
      averageNodes: totalNodes / completedExecutions.length,
      errorRate: (totalErrors / completedExecutions.length) * 100,
      parallelExecutions: completedExecutions.filter((m) => m.parallelBranches > 0).length,
    }
  }
}

// Singleton instance
export const workflowMetrics = new WorkflowMetricsCollector()
