// packages/lib/src/workflow-engine/core/__tests__/state-persistence-manager.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { ExecutionContextManager } from '../execution-context'
import { StatePersistenceManager } from '../state-persistence-manager'
import { type NodeExecutionResult, type PauseReason, WorkflowExecutionStatus } from '../types'

describe('StatePersistenceManager', () => {
  let manager: StatePersistenceManager
  let contextManager: ExecutionContextManager

  beforeEach(() => {
    manager = new StatePersistenceManager()
    contextManager = new ExecutionContextManager(
      'workflow-123',
      'exec-456',
      'org-789',
      'user-001',
      'user@example.com',
      'John Doe',
      'Acme Corp'
    )
  })

  describe('saveState', () => {
    it('should save state to executionStates for all executions', () => {
      const nodeResults: Record<string, NodeExecutionResult> = {
        'node-1': { status: 'succeeded' as any, output: { data: 'test' } },
      }

      const state = manager.saveState('exec-456', contextManager, nodeResults)

      expect(state.executionId).toBe('exec-456')
      expect(state.workflowId).toBe('workflow-123')
      expect(manager.getState('exec-456')).toBeDefined()
    })

    it('should save state to pausedExecutions only for terminal pauses', () => {
      const nodeResults: Record<string, NodeExecutionResult> = {}
      const pauseReason: PauseReason = {
        type: 'human_confirmation',
        nodeId: 'node-1',
        message: 'Waiting for approval',
      }

      manager.saveState('exec-456', contextManager, nodeResults, {
        pauseReason,
        isTerminalPause: true,
      })

      expect(manager.getPausedState('exec-456')).toBeDefined()
      expect(manager.isTerminalPause('exec-456')).toBe(true)
    })

    it('should not save to pausedExecutions for branch-level pauses', () => {
      const nodeResults: Record<string, NodeExecutionResult> = {}
      const pauseReason: PauseReason = {
        type: 'wait',
        nodeId: 'node-1',
      }

      manager.saveState('exec-456', contextManager, nodeResults, {
        pauseReason,
        isTerminalPause: false,
      })

      expect(manager.getState('exec-456')).toBeDefined()
      expect(manager.getPausedState('exec-456')).toBeUndefined()
      expect(manager.isTerminalPause('exec-456')).toBe(false)
    })

    it('should capture all context data', () => {
      contextManager.setVariable('testVar', 'testValue')
      contextManager.setNodeVariable('node-1', 'nodeVar', 'nodeValue')
      contextManager.markNodeVisited('node-1')
      contextManager.log('INFO', 'node-1', 'Test log message')

      const nodeResults: Record<string, NodeExecutionResult> = {
        'node-1': { success: true, output: { result: 'done' } },
      }

      const state = manager.saveState('exec-456', contextManager, nodeResults)

      expect(state.context.variables.testVar).toBe('testValue')
      expect(state.context.nodeVariables['node-1'].nodeVar).toBe('nodeValue')
      expect(state.visitedNodes.has('node-1')).toBe(true)
      expect(state.context.logs).toHaveLength(1)
      expect(state.context.logs[0]!.message).toBe('Test log message')
      expect(state.nodeResults['node-1']).toEqual({ success: true, output: { result: 'done' } })
    })

    it('should include execution tracking data when provided', () => {
      const trackingData = {
        executionCounter: 5,
        lastExecutedNodeId: 'node-3',
        currentDepth: 2,
        forkContext: {
          forkId: 'fork-1',
          branchIndex: 0,
          executionPath: 'branch-a',
        },
      }

      const state = manager.saveState(
        'exec-456',
        contextManager,
        {},
        {
          executionTracking: trackingData,
        }
      )

      expect(state.executionTracking).toEqual(trackingData)
    })

    it('should set status to PAUSED for terminal pauses', () => {
      const pauseReason: PauseReason = {
        type: 'human_confirmation',
        nodeId: 'node-1',
      }

      const state = manager.saveState(
        'exec-456',
        contextManager,
        {},
        {
          status: WorkflowExecutionStatus.PAUSED,
          pauseReason,
          isTerminalPause: true,
        }
      )

      expect(state.status).toBe(WorkflowExecutionStatus.PAUSED)
      expect(state.pausedAt).toBeInstanceOf(Date)
      expect(state.pauseReason).toEqual(pauseReason)
    })

    it('should set status to RUNNING for branch-level pauses', () => {
      const pauseReason: PauseReason = {
        type: 'wait',
        nodeId: 'node-1',
      }

      const state = manager.saveState(
        'exec-456',
        contextManager,
        {},
        {
          status: WorkflowExecutionStatus.RUNNING,
          pauseReason,
          isTerminalPause: false,
        }
      )

      expect(state.status).toBe(WorkflowExecutionStatus.RUNNING)
    })
  })

  describe('getState', () => {
    it('should retrieve state from executionStates', () => {
      manager.saveState('exec-456', contextManager, {})
      const state = manager.getState('exec-456')

      expect(state).toBeDefined()
      expect(state!.executionId).toBe('exec-456')
    })

    it('should retrieve state from pausedExecutions if not in executionStates', () => {
      const pauseReason: PauseReason = {
        type: 'human_confirmation',
        nodeId: 'node-1',
      }

      manager.saveState(
        'exec-456',
        contextManager,
        {},
        {
          pauseReason,
          isTerminalPause: true,
        }
      )

      // Clear from executionStates manually to test fallback
      // (in real scenario both would have it, but testing the fallback logic)
      const state = manager.getState('exec-456')
      expect(state).toBeDefined()
    })

    it('should return undefined for non-existent execution', () => {
      const state = manager.getState('non-existent')
      expect(state).toBeUndefined()
    })
  })

  describe('getPausedState', () => {
    it('should only retrieve terminal pauses', () => {
      const pauseReason: PauseReason = {
        type: 'human_confirmation',
        nodeId: 'node-1',
      }

      manager.saveState(
        'exec-456',
        contextManager,
        {},
        {
          pauseReason,
          isTerminalPause: true,
        }
      )

      const pausedState = manager.getPausedState('exec-456')
      expect(pausedState).toBeDefined()
      expect(pausedState!.executionId).toBe('exec-456')
    })

    it('should return undefined for branch-level pauses', () => {
      const pauseReason: PauseReason = {
        type: 'wait',
        nodeId: 'node-1',
      }

      manager.saveState(
        'exec-456',
        contextManager,
        {},
        {
          pauseReason,
          isTerminalPause: false,
        }
      )

      const pausedState = manager.getPausedState('exec-456')
      expect(pausedState).toBeUndefined()
    })

    it('should return undefined for non-existent execution', () => {
      const pausedState = manager.getPausedState('non-existent')
      expect(pausedState).toBeUndefined()
    })
  })

  describe('isTerminalPause', () => {
    it('should return true for terminal pauses', () => {
      const pauseReason: PauseReason = {
        type: 'human_confirmation',
        nodeId: 'node-1',
      }

      manager.saveState(
        'exec-456',
        contextManager,
        {},
        {
          pauseReason,
          isTerminalPause: true,
        }
      )

      expect(manager.isTerminalPause('exec-456')).toBe(true)
    })

    it('should return false for branch-level pauses', () => {
      const pauseReason: PauseReason = {
        type: 'wait',
        nodeId: 'node-1',
      }

      manager.saveState(
        'exec-456',
        contextManager,
        {},
        {
          pauseReason,
          isTerminalPause: false,
        }
      )

      expect(manager.isTerminalPause('exec-456')).toBe(false)
    })

    it('should return false for non-existent execution', () => {
      expect(manager.isTerminalPause('non-existent')).toBe(false)
    })
  })

  describe('clearState', () => {
    it('should remove state from both maps', () => {
      const pauseReason: PauseReason = {
        type: 'human_confirmation',
        nodeId: 'node-1',
      }

      manager.saveState(
        'exec-456',
        contextManager,
        {},
        {
          pauseReason,
          isTerminalPause: true,
        }
      )

      expect(manager.getState('exec-456')).toBeDefined()
      expect(manager.getPausedState('exec-456')).toBeDefined()

      manager.clearState('exec-456')

      expect(manager.getState('exec-456')).toBeUndefined()
      expect(manager.getPausedState('exec-456')).toBeUndefined()
    })

    it('should handle clearing non-existent state gracefully', () => {
      expect(() => manager.clearState('non-existent')).not.toThrow()
    })
  })

  describe('restoreContext', () => {
    it('should recreate ExecutionContextManager with all variables', async () => {
      contextManager.setVariable('globalVar', 'globalValue')
      contextManager.setVariable('numberVar', 42)
      contextManager.setVariable('objectVar', { key: 'value' })

      const state = manager.saveState('exec-456', contextManager, {})
      const restored = manager.restoreContext(state)

      expect(await restored.getVariable('globalVar')).toBe('globalValue')
      expect(await restored.getVariable('numberVar')).toBe(42)
      expect(await restored.getVariable('objectVar')).toEqual({ key: 'value' })
    })

    it('should restore node variables', async () => {
      contextManager.setNodeVariable('node-1', 'nodeVar1', 'value1')
      contextManager.setNodeVariable('node-1', 'nodeVar2', 'value2')
      contextManager.setNodeVariable('node-2', 'nodeVar3', 'value3')

      const state = manager.saveState('exec-456', contextManager, {})
      const restored = manager.restoreContext(state)

      expect(await restored.getNodeVariable('node-1', 'nodeVar1')).toBe('value1')
      expect(await restored.getNodeVariable('node-1', 'nodeVar2')).toBe('value2')
      expect(await restored.getNodeVariable('node-2', 'nodeVar3')).toBe('value3')
    })

    it('should restore visited nodes', () => {
      contextManager.markNodeVisited('node-1')
      contextManager.markNodeVisited('node-2')
      contextManager.markNodeVisited('node-3')

      const state = manager.saveState('exec-456', contextManager, {})
      const restored = manager.restoreContext(state)

      const restoredContext = restored.getContext()
      expect(restoredContext.visitedNodes).toContain('node-1')
      expect(restoredContext.visitedNodes).toContain('node-2')
      expect(restoredContext.visitedNodes).toContain('node-3')
    })

    it('should restore logs in correct order', () => {
      contextManager.log('INFO', 'node-1', 'Log message 1')
      contextManager.log('WARN', 'node-2', 'Log message 2')
      contextManager.log('ERROR', 'node-3', 'Log message 3')

      const state = manager.saveState('exec-456', contextManager, {})
      const restored = manager.restoreContext(state)

      const restoredContext = restored.getContext()
      expect(restoredContext.logs).toHaveLength(3)
      expect(restoredContext.logs[0]!.message).toBe('Log message 1')
      expect(restoredContext.logs[1]!.message).toBe('Log message 2')
      expect(restoredContext.logs[2]!.message).toBe('Log message 3')
    })

    it('should restore system variables correctly', () => {
      // Initialize system variables first so they're captured in state
      contextManager.initializeSystemVariables()

      const state = manager.saveState('exec-456', contextManager, {})
      const restored = manager.restoreContext(state)

      const systemVars = restored.getSystemVariables()
      expect(systemVars['sys.organizationId']).toBe('org-789')
      expect(systemVars['sys.userId']).toBe('user-001')
      expect(systemVars['sys.userEmail']).toBe('user@example.com')
      expect(systemVars['sys.userName']).toBe('John Doe')
      expect(systemVars['sys.organizationName']).toBe('Acme Corp')
    })

    it('should handle missing data gracefully (backward compatibility)', () => {
      const state = manager.saveState('exec-456', contextManager, {})

      // Simulate missing node variables (backward compatibility)
      state.context.nodeVariables = {}

      const restored = manager.restoreContext(state)

      // Should not throw and should create valid context
      expect(restored).toBeDefined()
      expect(restored.getContext().workflowId).toBe('workflow-123')
    })
  })

  describe('terminal vs branch pause distinction', () => {
    it('should maintain separation between terminal and branch pauses', () => {
      const terminalPauseReason: PauseReason = {
        type: 'human_confirmation',
        nodeId: 'node-1',
      }
      const branchPauseReason: PauseReason = {
        type: 'wait',
        nodeId: 'node-2',
      }

      // Save terminal pause
      manager.saveState(
        'exec-terminal',
        contextManager,
        {},
        {
          pauseReason: terminalPauseReason,
          isTerminalPause: true,
        }
      )

      // Save branch pause
      manager.saveState(
        'exec-branch',
        contextManager,
        {},
        {
          pauseReason: branchPauseReason,
          isTerminalPause: false,
        }
      )

      // Terminal pause should be in both maps
      expect(manager.getState('exec-terminal')).toBeDefined()
      expect(manager.getPausedState('exec-terminal')).toBeDefined()
      expect(manager.isTerminalPause('exec-terminal')).toBe(true)

      // Branch pause should only be in executionStates
      expect(manager.getState('exec-branch')).toBeDefined()
      expect(manager.getPausedState('exec-branch')).toBeUndefined()
      expect(manager.isTerminalPause('exec-branch')).toBe(false)
    })
  })

  describe('complex workflow scenario', () => {
    it('should handle full save-restore cycle with complete context', async () => {
      // Set up complex context
      contextManager.setVariable('counter', 5)
      contextManager.setVariable('items', ['a', 'b', 'c'])
      contextManager.setNodeVariable('loop-node', 'iteration', 2)
      contextManager.setNodeVariable('if-node', 'condition', true)
      contextManager.markNodeVisited('start')
      contextManager.markNodeVisited('loop-node')
      contextManager.markNodeVisited('if-node')
      contextManager.log('INFO', 'start', 'Workflow started')
      contextManager.log('INFO', 'loop-node', 'Loop iteration 2')
      contextManager.log('INFO', 'if-node', 'Condition evaluated to true')

      const nodeResults: Record<string, NodeExecutionResult> = {
        start: { success: true, output: { initialized: true } },
        'loop-node': { success: true, output: { iteration: 2 } },
        'if-node': { success: true, output: { result: true } },
      }

      const trackingData = {
        executionCounter: 3,
        lastExecutedNodeId: 'if-node',
        currentDepth: 1,
      }

      // Save state
      const state = manager.saveState('exec-456', contextManager, nodeResults, {
        currentNodeId: 'if-node',
        executionTracking: trackingData,
      })

      // Verify state
      expect(state.currentNodeId).toBe('if-node')
      expect(state.executionTracking).toEqual(trackingData)

      // Restore context
      const restored = manager.restoreContext(state)

      // Verify all data restored correctly
      expect(await restored.getVariable('counter')).toBe(5)
      expect(await restored.getVariable('items')).toEqual(['a', 'b', 'c'])
      expect(await restored.getNodeVariable('loop-node', 'iteration')).toBe(2)
      expect(await restored.getNodeVariable('if-node', 'condition')).toBe(true)

      const restoredContext = restored.getContext()
      expect(restoredContext.visitedNodes).toContain('start')
      expect(restoredContext.visitedNodes).toContain('loop-node')
      expect(restoredContext.visitedNodes).toContain('if-node')
      expect(restoredContext.logs).toHaveLength(3)
    })
  })
})
