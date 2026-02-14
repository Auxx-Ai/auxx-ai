// packages/lib/src/workflow-engine/core/execution-context.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { ExecutionContextManager } from './execution-context'

describe('ExecutionContextManager - Variable Validation', () => {
  let contextManager: ExecutionContextManager

  beforeEach(() => {
    contextManager = new ExecutionContextManager(
      'test-workflow',
      'test-exec',
      'test-org',
      'test-user',
      'test@example.com',
      'Test User',
      'Test Org',
      'test-org-handle'
    )
  })

  describe('validateRequiredVariables', () => {
    it('should validate required variables exist', async () => {
      // Set up some variables
      contextManager.setVariable('webhook1.body.email', 'test@example.com')
      contextManager.setVariable('webhook1.body.subject', 'Test Subject')

      // Validate variables that exist
      const result = await contextManager.validateRequiredVariables([
        'webhook1.body.email',
        'webhook1.body.subject',
      ])

      expect(result.valid).toBe(true)
      expect(result.missingVariables).toHaveLength(0)
      expect(result.availableVariables).toHaveLength(2)
      expect(result.availableVariables).toContain('webhook1.body.email')
      expect(result.availableVariables).toContain('webhook1.body.subject')
    })

    it('should detect missing variables', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')

      const result = await contextManager.validateRequiredVariables([
        'webhook1.body.email',
        'find1.ticket.id', // This doesn't exist
      ])

      expect(result.valid).toBe(false)
      expect(result.missingVariables).toContain('find1.ticket.id')
      expect(result.availableVariables).toContain('webhook1.body.email')
      expect(result.missingVariables).toHaveLength(1)
      expect(result.availableVariables).toHaveLength(1)
    })

    it('should find partial matches for missing variables', async () => {
      contextManager.setVariable('find1.ticket.title', 'Test Ticket')
      contextManager.setVariable('find1.ticket.status', 'OPEN')

      const result = await contextManager.validateRequiredVariables([
        'find1.ticket.id', // Requested but missing
      ])

      expect(result.valid).toBe(false)
      expect(result.partialMatches).toHaveLength(1)
      expect(result.partialMatches[0]?.requested).toBe('find1.ticket.id')
      expect(result.partialMatches[0]?.available).toContain('find1.ticket.title')
      expect(result.partialMatches[0]?.available).toContain('find1.ticket.status')
    })

    it('should handle empty required variables', async () => {
      const result = await contextManager.validateRequiredVariables([])

      expect(result.valid).toBe(true)
      expect(result.missingVariables).toHaveLength(0)
      expect(result.availableVariables).toHaveLength(0)
      expect(result.partialMatches).toHaveLength(0)
    })

    it('should validate all missing when context is empty', async () => {
      const result = await contextManager.validateRequiredVariables([
        'webhook1.body.email',
        'find1.ticket.id',
      ])

      expect(result.valid).toBe(false)
      expect(result.missingVariables).toHaveLength(2)
      expect(result.availableVariables).toHaveLength(0)
    })
  })

  describe('buildOptimizedContext', () => {
    it('should build optimized context with only required variables', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')
      contextManager.setVariable('webhook1.body.subject', 'Test Subject')
      contextManager.setVariable('webhook1.headers.contentType', 'application/json')

      const optimized = await contextManager.buildOptimizedContext([
        'webhook1.body.email', // Only request one variable
      ])

      expect(optimized.size).toBe(1)
      expect(optimized.get('webhook1.body.email')).toBe('test@example.com')
      expect(optimized.has('webhook1.body.subject')).toBe(false)
      expect(optimized.has('webhook1.headers.contentType')).toBe(false)
    })

    it('should handle multiple required variables', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')
      contextManager.setVariable('webhook1.body.subject', 'Test Subject')
      contextManager.setVariable('find1.ticket.id', '123')

      const optimized = await contextManager.buildOptimizedContext([
        'webhook1.body.email',
        'find1.ticket.id',
      ])

      expect(optimized.size).toBe(2)
      expect(optimized.get('webhook1.body.email')).toBe('test@example.com')
      expect(optimized.get('find1.ticket.id')).toBe('123')
      expect(optimized.has('webhook1.body.subject')).toBe(false)
    })

    it('should skip missing variables', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')

      const optimized = await contextManager.buildOptimizedContext([
        'webhook1.body.email',
        'find1.ticket.id', // This doesn't exist
      ])

      expect(optimized.size).toBe(1)
      expect(optimized.get('webhook1.body.email')).toBe('test@example.com')
      expect(optimized.has('find1.ticket.id')).toBe(false)
    })

    it('should return empty map when no variables requested', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')

      const optimized = await contextManager.buildOptimizedContext([])

      expect(optimized.size).toBe(0)
    })

    it('should return empty map when all requested variables are missing', async () => {
      const optimized = await contextManager.buildOptimizedContext([
        'find1.ticket.id',
        'webhook1.body.email',
      ])

      expect(optimized.size).toBe(0)
    })
  })

  describe('getAvailableVariableIds', () => {
    it('should return all available variable IDs', () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')
      contextManager.setVariable('webhook1.body.subject', 'Test')
      contextManager.setVariable('find1.ticket.id', '123')

      const ids = contextManager.getAvailableVariableIds()

      expect(ids).toHaveLength(3)
      expect(ids).toContain('webhook1.body.email')
      expect(ids).toContain('webhook1.body.subject')
      expect(ids).toContain('find1.ticket.id')
    })

    it('should return empty array when no variables exist', () => {
      const ids = contextManager.getAvailableVariableIds()

      expect(ids).toHaveLength(0)
    })

    it('should return sorted variable IDs', () => {
      contextManager.setVariable('z.var', 'value')
      contextManager.setVariable('a.var', 'value')
      contextManager.setVariable('m.var', 'value')

      const ids = contextManager.getAvailableVariableIds()

      expect(ids).toEqual(['a.var', 'm.var', 'z.var'])
    })
  })

  describe('getVariablesByNode', () => {
    it('should group variables by node', () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')
      contextManager.setVariable('webhook1.body.subject', 'Test')
      contextManager.setVariable('find1.ticket.id', '123')
      contextManager.setVariable('find1.ticket.status', 'OPEN')

      const grouped = contextManager.getVariablesByNode()

      expect(grouped.size).toBe(2)
      expect(grouped.get('webhook1')).toHaveLength(2)
      expect(grouped.get('webhook1')).toContain('webhook1.body.email')
      expect(grouped.get('webhook1')).toContain('webhook1.body.subject')
      expect(grouped.get('find1')).toHaveLength(2)
      expect(grouped.get('find1')).toContain('find1.ticket.id')
      expect(grouped.get('find1')).toContain('find1.ticket.status')
    })

    it('should return empty map when no variables exist', () => {
      const grouped = contextManager.getVariablesByNode()

      expect(grouped.size).toBe(0)
    })

    it('should handle single node with multiple variables', () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')
      contextManager.setVariable('webhook1.body.subject', 'Test')
      contextManager.setVariable('webhook1.headers.contentType', 'application/json')

      const grouped = contextManager.getVariablesByNode()

      expect(grouped.size).toBe(1)
      expect(grouped.get('webhook1')).toHaveLength(3)
    })

    it('should include system and environment variables', () => {
      contextManager.setVariable('sys.userId', 'user-123')
      contextManager.setVariable('env.API_KEY', 'key-123')
      contextManager.setVariable('webhook1.body.email', 'test@example.com')

      const grouped = contextManager.getVariablesByNode()

      expect(grouped.size).toBe(3)
      expect(grouped.has('sys')).toBe(true)
      expect(grouped.has('env')).toBe(true)
      expect(grouped.has('webhook1')).toBe(true)
    })
  })

  describe('Integration - Validation with partial matches', () => {
    it('should provide helpful suggestions for typos', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')
      contextManager.setVariable('webhook1.body.subject', 'Test')

      // User typo: "emial" instead of "email"
      const result = await contextManager.validateRequiredVariables(['webhook1.body.emial'])

      expect(result.valid).toBe(false)
      expect(result.partialMatches).toHaveLength(1)
      expect(result.partialMatches[0]?.available).toContain('webhook1.body.email')
      expect(result.partialMatches[0]?.available).toContain('webhook1.body.subject')
    })

    it('should detect when node exists but specific property missing', async () => {
      contextManager.setVariable('find1.ticket', { id: '123', status: 'OPEN' })

      // User requests specific property that doesn't exist
      const result = await contextManager.validateRequiredVariables(['find1.ticket.priority'])

      expect(result.valid).toBe(false)
      expect(result.partialMatches).toHaveLength(1)
      expect(result.partialMatches[0]?.requested).toBe('find1.ticket.priority')
      expect(result.partialMatches[0]?.available).toContain('find1.ticket')
    })
  })
})
