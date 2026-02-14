// packages/lib/src/workflow-engine/core/__tests__/cancellation-manager.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { CancellationManager } from '../cancellation-manager'

describe('CancellationManager', () => {
  let manager: CancellationManager

  beforeEach(() => {
    manager = new CancellationManager()
  })

  describe('cancelExecution', () => {
    it('should mark execution as cancelled', () => {
      const executionId = 'exec_123'

      manager.cancelExecution(executionId)

      expect(manager.isCancelled(executionId)).toBe(true)
    })

    it('should track multiple cancelled executions', () => {
      manager.cancelExecution('exec_1')
      manager.cancelExecution('exec_2')

      expect(manager.isCancelled('exec_1')).toBe(true)
      expect(manager.isCancelled('exec_2')).toBe(true)
      expect(manager.getCancelledExecutions()).toHaveLength(2)
    })
  })

  describe('cancelWorkflowRun', () => {
    it('should mark workflow run as cancelled', () => {
      const runId = 'run_456'

      manager.cancelWorkflowRun(runId)

      expect(manager.isCancelled('any_exec', runId)).toBe(true)
      expect(manager.isWorkflowRunCancelled(runId)).toBe(true)
    })

    it('should create abort signal', () => {
      const runId = 'run_456'

      manager.cancelWorkflowRun(runId)

      const signal = manager.getAbortSignal(runId)
      expect(signal).toBeDefined()
      expect(signal?.aborted).toBe(true)
    })

    it('should use prefixed storage', () => {
      const runId = 'run_456'

      manager.cancelWorkflowRun(runId)

      const executions = manager.getCancelledExecutions()
      expect(executions).toContain(`run:${runId}`)
    })
  })

  describe('isCancelled', () => {
    it('should return false for non-cancelled execution', () => {
      expect(manager.isCancelled('exec_123')).toBe(false)
    })

    it('should detect execution-level cancellation', () => {
      manager.cancelExecution('exec_123')

      expect(manager.isCancelled('exec_123')).toBe(true)
    })

    it('should detect run-level cancellation', () => {
      manager.cancelWorkflowRun('run_456')

      expect(manager.isCancelled('any_exec', 'run_456')).toBe(true)
    })

    it('should check abort signal status', () => {
      const runId = 'run_456'
      manager.cancelWorkflowRun(runId)

      expect(manager.isCancelled('exec_123', runId)).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('should remove execution from tracking', () => {
      manager.cancelExecution('exec_123')
      expect(manager.isCancelled('exec_123')).toBe(true)

      manager.cleanup('exec_123')

      expect(manager.isCancelled('exec_123')).toBe(false)
    })

    it('should remove workflow run from tracking', () => {
      const runId = 'run_456'
      manager.cancelWorkflowRun(runId)
      expect(manager.isCancelled('exec_123', runId)).toBe(true)

      manager.cleanup('exec_123', runId)

      expect(manager.isCancelled('exec_123', runId)).toBe(false)
      expect(manager.isWorkflowRunCancelled(runId)).toBe(false)
    })

    it('should clean up abort controller', () => {
      const runId = 'run_456'
      manager.cancelWorkflowRun(runId)
      expect(manager.getAbortSignal(runId)).toBeDefined()

      manager.cleanup('exec_123', runId)

      expect(manager.getAbortSignal(runId)).toBeUndefined()
    })

    it('should handle cleanup of non-existent items gracefully', () => {
      expect(() => manager.cleanup('non_existent')).not.toThrow()
      expect(() => manager.cleanup('exec', 'non_existent_run')).not.toThrow()
    })
  })

  describe('getAbortSignal', () => {
    it('should return undefined for non-cancelled run', () => {
      expect(manager.getAbortSignal('run_456')).toBeUndefined()
    })

    it('should return abort signal for cancelled run', () => {
      manager.cancelWorkflowRun('run_456')

      const signal = manager.getAbortSignal('run_456')
      expect(signal).toBeDefined()
      expect(signal?.aborted).toBe(true)
    })
  })

  describe('isWorkflowRunCancelled', () => {
    it('should return false for non-cancelled run', () => {
      expect(manager.isWorkflowRunCancelled('run_456')).toBe(false)
    })

    it('should return true for cancelled run', () => {
      manager.cancelWorkflowRun('run_456')

      expect(manager.isWorkflowRunCancelled('run_456')).toBe(true)
    })
  })

  describe('clearAll', () => {
    it('should clear all cancellation state', () => {
      manager.cancelExecution('exec_1')
      manager.cancelExecution('exec_2')
      manager.cancelWorkflowRun('run_1')
      manager.cancelWorkflowRun('run_2')

      manager.clearAll()

      expect(manager.getCancelledExecutions()).toHaveLength(0)
      expect(manager.getCancelledWorkflowRuns()).toHaveLength(0)
      expect(manager.isCancelled('exec_1')).toBe(false)
      expect(manager.isWorkflowRunCancelled('run_1')).toBe(false)
    })
  })

  describe('monitoring methods', () => {
    it('should list all cancelled executions', () => {
      manager.cancelExecution('exec_1')
      manager.cancelExecution('exec_2')
      manager.cancelWorkflowRun('run_1')

      const executions = manager.getCancelledExecutions()
      expect(executions).toContain('exec_1')
      expect(executions).toContain('exec_2')
      expect(executions).toContain('run:run_1')
    })

    it('should list all cancelled workflow runs', () => {
      manager.cancelWorkflowRun('run_1')
      manager.cancelWorkflowRun('run_2')

      const runs = manager.getCancelledWorkflowRuns()
      expect(runs).toHaveLength(2)
      expect(runs).toContain('run_1')
      expect(runs).toContain('run_2')
    })
  })
})
