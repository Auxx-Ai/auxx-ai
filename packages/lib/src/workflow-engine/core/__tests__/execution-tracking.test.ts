// packages/lib/src/workflow-engine/core/__tests__/execution-tracking.test.ts

import { describe, it, expect, beforeEach } from 'vitest'
import { ExecutionTrackingManager } from '../execution-tracking'

describe('ExecutionTrackingManager', () => {
  let manager: ExecutionTrackingManager

  beforeEach(() => {
    manager = new ExecutionTrackingManager()
  })

  describe('Lifecycle', () => {
    it('should initialize with default values', () => {
      expect(manager.getCounter()).toBe(0)
      expect(manager.getLastExecutedNode()).toBeNull()
      expect(manager.getDepth()).toBe(0)
    })

    it('should reset all state', () => {
      manager.incrementCounter()
      manager.setLastExecutedNode('node-1')
      manager.incrementDepth()
      manager.setForkContext('fork-1', 0, 'path')

      manager.reset()

      expect(manager.getCounter()).toBe(0)
      expect(manager.getLastExecutedNode()).toBeNull()
      expect(manager.getDepth()).toBe(0)
      expect(manager.getForkContext('forkId')).toBeUndefined()
    })
  })

  describe('Execution Counter', () => {
    it('should increment counter', () => {
      expect(manager.incrementCounter()).toBe(1)
      expect(manager.incrementCounter()).toBe(2)
      expect(manager.getCounter()).toBe(2)
    })

    it('should get counter without incrementing', () => {
      manager.incrementCounter()
      expect(manager.getCounter()).toBe(1)
      expect(manager.getCounter()).toBe(1) // No increment
    })
  })

  describe('Predecessor Tracking', () => {
    it('should track last executed node', () => {
      manager.setLastExecutedNode('node-1')
      expect(manager.getLastExecutedNode()).toBe('node-1')

      manager.setLastExecutedNode('node-2')
      expect(manager.getLastExecutedNode()).toBe('node-2')
    })

    it('should start with null last executed node', () => {
      expect(manager.getLastExecutedNode()).toBeNull()
    })
  })

  describe('Depth Management', () => {
    it('should increment depth', () => {
      manager.incrementDepth()
      expect(manager.getDepth()).toBe(1)
      manager.incrementDepth()
      expect(manager.getDepth()).toBe(2)
    })

    it('should decrement depth', () => {
      manager.incrementDepth()
      manager.incrementDepth()
      manager.decrementDepth()
      expect(manager.getDepth()).toBe(1)
    })

    it('should not decrement depth below 0', () => {
      manager.decrementDepth()
      expect(manager.getDepth()).toBe(0)
    })

    it('should handle multiple decrements at zero', () => {
      manager.decrementDepth()
      manager.decrementDepth()
      expect(manager.getDepth()).toBe(0)
    })
  })

  describe('Fork Context', () => {
    it('should set and get fork context', () => {
      manager.setForkContext('fork-1', 2, 'start->branch-1')

      expect(manager.getForkContext('forkId')).toBe('fork-1')
      expect(manager.getForkContext('branchIndex')).toBe(2)
      expect(manager.getForkContext('executionPath')).toBe('start->branch-1')
    })

    it('should clear fork context', () => {
      manager.setForkContext('fork-1', 0, 'path')
      manager.clearForkContext()

      expect(manager.getForkContext('forkId')).toBeUndefined()
      expect(manager.getForkContext('branchIndex')).toBeUndefined()
      expect(manager.getForkContext('executionPath')).toBeUndefined()
    })

    it('should get fork context snapshot', () => {
      manager.setForkContext('fork-1', 3, 'path-123')

      const snapshot = manager.getForkContextSnapshot()
      expect(snapshot).toEqual({
        forkId: 'fork-1',
        branchIndex: 3,
        executionPath: 'path-123',
      })
    })

    it('should return empty snapshot when no fork context set', () => {
      const snapshot = manager.getForkContextSnapshot()
      expect(snapshot).toEqual({
        forkId: undefined,
        branchIndex: undefined,
        executionPath: undefined,
      })
    })

    it('should overwrite fork context on subsequent sets', () => {
      manager.setForkContext('fork-1', 0, 'path-1')
      manager.setForkContext('fork-2', 1, 'path-2')

      expect(manager.getForkContext('forkId')).toBe('fork-2')
      expect(manager.getForkContext('branchIndex')).toBe(1)
    })
  })

  describe('State Serialization', () => {
    it('should export state', () => {
      manager.incrementCounter()
      manager.incrementCounter()
      manager.setLastExecutedNode('node-1')
      manager.incrementDepth()
      manager.setForkContext('fork-1', 0, 'path')

      const state = manager.exportState()

      expect(state).toEqual({
        executionCounter: 2,
        lastExecutedNodeId: 'node-1',
        currentDepth: 1,
        forkContext: {
          forkId: 'fork-1',
          branchIndex: 0,
          executionPath: 'path',
        },
      })
    })

    it('should export state without fork context', () => {
      manager.incrementCounter()
      manager.setLastExecutedNode('node-1')

      const state = manager.exportState()

      expect(state).toEqual({
        executionCounter: 1,
        lastExecutedNodeId: 'node-1',
        currentDepth: 0,
        forkContext: {
          forkId: undefined,
          branchIndex: undefined,
          executionPath: undefined,
        },
      })
    })

    it('should import state', () => {
      const state = {
        executionCounter: 5,
        lastExecutedNodeId: 'node-3',
        currentDepth: 2,
        forkContext: {
          forkId: 'fork-2',
          branchIndex: 1,
          executionPath: 'path-456',
        },
      }

      manager.importState(state)

      expect(manager.getCounter()).toBe(5)
      expect(manager.getLastExecutedNode()).toBe('node-3')
      expect(manager.getDepth()).toBe(2)
      expect(manager.getForkContext('forkId')).toBe('fork-2')
      expect(manager.getForkContext('branchIndex')).toBe(1)
      expect(manager.getForkContext('executionPath')).toBe('path-456')
    })

    it('should handle import without fork context', () => {
      const state = {
        executionCounter: 3,
        lastExecutedNodeId: 'node-1',
        currentDepth: 1,
      }

      manager.importState(state)

      expect(manager.getCounter()).toBe(3)
      expect(manager.getLastExecutedNode()).toBe('node-1')
      expect(manager.getDepth()).toBe(1)
      expect(manager.getForkContext('forkId')).toBeUndefined()
    })

    it('should handle partial fork context on import', () => {
      const state = {
        executionCounter: 2,
        lastExecutedNodeId: 'node-1',
        currentDepth: 0,
        forkContext: {
          forkId: 'fork-1',
          // branchIndex and executionPath undefined
        },
      }

      manager.importState(state)

      expect(manager.getForkContext('forkId')).toBe('fork-1')
      expect(manager.getForkContext('branchIndex')).toBeUndefined()
      expect(manager.getForkContext('executionPath')).toBeUndefined()
    })

    it('should round-trip state correctly', () => {
      manager.incrementCounter()
      manager.incrementCounter()
      manager.setLastExecutedNode('node-test')
      manager.incrementDepth()
      manager.setForkContext('fork-test', 5, 'test-path')

      const exported = manager.exportState()

      const newManager = new ExecutionTrackingManager()
      newManager.importState(exported)

      expect(newManager.getCounter()).toBe(manager.getCounter())
      expect(newManager.getLastExecutedNode()).toBe(manager.getLastExecutedNode())
      expect(newManager.getDepth()).toBe(manager.getDepth())
      expect(newManager.getForkContext('forkId')).toBe(manager.getForkContext('forkId'))
    })
  })

  describe('Execution ID Generation', () => {
    it('should generate unique execution IDs', () => {
      const id1 = manager.generateExecutionId()
      const id2 = manager.generateExecutionId()

      expect(id1).toMatch(/^exec_\d+_[a-z0-9]+$/)
      expect(id2).toMatch(/^exec_\d+_[a-z0-9]+$/)
      expect(id1).not.toBe(id2)
    })

    it('should generate IDs with correct format', () => {
      const id = manager.generateExecutionId()
      const parts = id.split('_')

      expect(parts[0]).toBe('exec')
      expect(parts[1]).toMatch(/^\d+$/) // timestamp
      expect(parts[2]).toMatch(/^[a-z0-9]+$/) // random string
    })

    it('should generate multiple unique IDs', () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        ids.add(manager.generateExecutionId())
      }

      expect(ids.size).toBe(100) // All unique
    })
  })

  describe('Integration Scenarios', () => {
    it('should handle typical workflow execution flow', () => {
      // Start workflow
      manager.reset()

      // Execute node 1
      const index1 = manager.incrementCounter()
      manager.setLastExecutedNode('node-1')
      expect(index1).toBe(1)
      expect(manager.getLastExecutedNode()).toBe('node-1')

      // Enter loop (depth++)
      manager.incrementDepth()

      // Execute node 2 in loop
      const index2 = manager.incrementCounter()
      manager.setLastExecutedNode('node-2')
      expect(index2).toBe(2)
      expect(manager.getDepth()).toBe(1)

      // Execute node 3 in loop
      const index3 = manager.incrementCounter()
      manager.setLastExecutedNode('node-3')
      expect(index3).toBe(3)

      // Exit loop (depth--)
      manager.decrementDepth()
      expect(manager.getDepth()).toBe(0)

      // Execute node 4
      const index4 = manager.incrementCounter()
      manager.setLastExecutedNode('node-4')
      expect(index4).toBe(4)
      expect(manager.getLastExecutedNode()).toBe('node-4')
    })

    it('should handle fork/join execution', () => {
      // Execute fork node
      manager.incrementCounter()
      manager.setLastExecutedNode('fork-1')

      // Enter branch 0
      manager.setForkContext('fork-1', 0, 'fork-1->branch-0')
      expect(manager.getForkContext('branchIndex')).toBe(0)

      // Execute in branch
      const branchIndex = manager.incrementCounter()
      expect(branchIndex).toBe(2)

      // Exit branch
      manager.clearForkContext()
      expect(manager.getForkContext('forkId')).toBeUndefined()

      // Enter branch 1
      manager.setForkContext('fork-1', 1, 'fork-1->branch-1')
      expect(manager.getForkContext('branchIndex')).toBe(1)

      // Execute in branch
      manager.incrementCounter()

      // Exit branch
      manager.clearForkContext()
    })

    it('should handle nested depth correctly', () => {
      expect(manager.getDepth()).toBe(0)

      // Enter loop level 1
      manager.incrementDepth()
      expect(manager.getDepth()).toBe(1)

      // Enter loop level 2 (nested)
      manager.incrementDepth()
      expect(manager.getDepth()).toBe(2)

      // Exit nested loop
      manager.decrementDepth()
      expect(manager.getDepth()).toBe(1)

      // Exit outer loop
      manager.decrementDepth()
      expect(manager.getDepth()).toBe(0)
    })

    it('should maintain state across pause/resume', () => {
      // Execute some nodes
      manager.incrementCounter()
      manager.incrementCounter()
      manager.setLastExecutedNode('node-2')
      manager.incrementDepth()

      // Pause: export state
      const pausedState = manager.exportState()

      // Simulate time passing, create new manager
      const resumedManager = new ExecutionTrackingManager()

      // Resume: import state
      resumedManager.importState(pausedState)

      // Continue execution
      const nextIndex = resumedManager.incrementCounter()
      expect(nextIndex).toBe(3) // Continues from where it left off

      resumedManager.setLastExecutedNode('node-3')
      expect(resumedManager.getLastExecutedNode()).toBe('node-3')
      expect(resumedManager.getDepth()).toBe(1)
    })
  })
})
