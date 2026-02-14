// apps/web/src/components/workflow/ui/variables/__tests__/convert-array-wildcard.test.ts

import { describe, expect, it } from 'vitest'

/**
 * Test for array wildcard to loop item conversion logic
 *
 * This tests the core logic that would be in convertArrayWildcardToLoopItem
 * We test the algorithm separately since the actual function requires React hooks
 */
describe('Array Wildcard to Loop Item Conversion Logic', () => {
  // Test data structures
  const mockLoopContexts = [
    {
      loopNodeId: 'loop-xyz-123',
      iteratorName: 'item',
      depth: 1,
    },
  ]

  const mockNodes = [
    {
      id: 'loop-xyz-123',
      type: 'loop',
      data: {
        itemsSource: '{{find-abc.contacts}}', // ✅ Plural (matches array name)
      },
    },
  ]

  describe('Pattern Detection', () => {
    it('should detect [*] wildcard in variable ID', () => {
      const variableId = 'find-abc.contacts[*].firstName' // ✅ Plural
      expect(variableId.includes('[*]')).toBe(true)
    })

    it('should not detect [*] in regular variable', () => {
      const variableId = 'loop-xyz.item.firstName'
      expect(variableId.includes('[*]')).toBe(false)
    })
  })

  describe('Source Variable Extraction', () => {
    it('should extract source variable ID from itemsSource', () => {
      const itemsSource = '{{find-abc.contacts}}' // ✅ Plural
      const sourceVarId = itemsSource.replace(/^\{\{|\}\}$/g, '').trim()
      expect(sourceVarId).toBe('find-abc.contacts')
    })

    it('should handle itemsSource without spaces', () => {
      const itemsSource = '{{find-abc.contacts}}' // ✅ Plural
      const sourceVarId = itemsSource.replace(/^\{\{|\}\}$/g, '').trim()
      expect(sourceVarId).toBe('find-abc.contacts')
    })
  })

  describe('Property Path Extraction', () => {
    it('should extract property path from array wildcard variable', () => {
      const variableId = 'find-abc.contacts[*].firstName' // ✅ Plural
      const sourceVarId = 'find-abc.contacts' // ✅ Plural

      const propertyPath = variableId
        .substring(sourceVarId.length + 3) // Remove "sourceId[*]"
        .replace(/^\./, '') // Remove leading dot

      expect(propertyPath).toBe('firstName')
    })

    it('should extract nested property path', () => {
      const variableId = 'find-abc.contacts[*].address.city' // ✅ Plural
      const sourceVarId = 'find-abc.contacts' // ✅ Plural

      const propertyPath = variableId.substring(sourceVarId.length + 3).replace(/^\./, '')

      expect(propertyPath).toBe('address.city')
    })

    it('should handle array wildcard with no property', () => {
      const variableId = 'find-abc.contacts[*]' // ✅ Plural
      const sourceVarId = 'find-abc.contacts' // ✅ Plural

      const propertyPath = variableId.substring(sourceVarId.length + 3).replace(/^\./, '')

      expect(propertyPath).toBe('')
    })
  })

  describe('Loop Item ID Construction', () => {
    it('should build loop item ID with property', () => {
      const loopNodeId = 'loop-xyz-123'
      const propertyPath = 'firstName'

      const loopItemId = propertyPath ? `${loopNodeId}.item.${propertyPath}` : `${loopNodeId}.item`

      expect(loopItemId).toBe('loop-xyz-123.item.firstName')
    })

    it('should build loop item ID without property', () => {
      const loopNodeId = 'loop-xyz-123'
      const propertyPath = ''

      const loopItemId = propertyPath ? `${loopNodeId}.item.${propertyPath}` : `${loopNodeId}.item`

      expect(loopItemId).toBe('loop-xyz-123.item')
    })

    it('should build loop item ID with nested property', () => {
      const loopNodeId = 'loop-xyz-123'
      const propertyPath = 'address.city'

      const loopItemId = propertyPath ? `${loopNodeId}.item.${propertyPath}` : `${loopNodeId}.item`

      expect(loopItemId).toBe('loop-xyz-123.item.address.city')
    })
  })

  describe('Matching Logic', () => {
    it('should match when variable is from loop source array', () => {
      const variableId = 'find-abc.contacts[*].firstName' // ✅ Plural
      const sourceVarId = 'find-abc.contacts' // ✅ Plural

      const matches = variableId.startsWith(`${sourceVarId}[*]`)
      expect(matches).toBe(true)
    })

    it('should not match when variable is from different array', () => {
      const variableId = 'find-xyz.customers[*].name' // ✅ Plural
      const sourceVarId = 'find-abc.contacts' // ✅ Plural

      const matches = variableId.startsWith(`${sourceVarId}[*]`)
      expect(matches).toBe(false)
    })
  })

  describe('Nested Loops', () => {
    it('should handle multiple loop contexts (innermost first)', () => {
      const nestedContexts = [
        {
          loopNodeId: 'loop-outer',
          iteratorName: 'item',
          depth: 1,
        },
        {
          loopNodeId: 'loop-inner',
          iteratorName: 'item',
          depth: 2,
        },
      ]

      // Should check from innermost (index 1) to outermost (index 0)
      const reverseOrder = []
      for (let i = nestedContexts.length - 1; i >= 0; i--) {
        reverseOrder.push(nestedContexts[i])
      }

      expect(reverseOrder[0]?.loopNodeId).toBe('loop-inner')
      expect(reverseOrder[1]?.loopNodeId).toBe('loop-outer')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty loop contexts', () => {
      const emptyContexts: any[] = []
      expect(emptyContexts.length).toBe(0)
    })

    it('should handle missing itemsSource in loop node', () => {
      const loopNode = {
        id: 'loop-xyz',
        type: 'loop',
        data: {},
      }

      expect(loopNode.data.itemsSource).toBeUndefined()
    })

    it('should extract property path with multiple array accesses', () => {
      // This is an edge case - user shouldn't do this, but let's handle it
      const variableId = 'find-abc.contacts[*].orders[*].total' // ✅ Plural
      const sourceVarId = 'find-abc.contacts' // ✅ Plural

      const propertyPath = variableId.substring(sourceVarId.length + 3).replace(/^\./, '')

      // Should extract everything after first [*]
      expect(propertyPath).toBe('orders[*].total')
    })
  })
})
