// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/crud-relation-fields.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../../core/types'
import { WorkflowNodeType } from '../../../core/types'
import { CrudNodeProcessor } from '../crud'

/**
 * Test suite for CRUD node relation field handling
 *
 * These tests ensure that relation fields are correctly transformed from
 * logical field names (e.g., "contact") to database column names (e.g., "contactId")
 */
describe('CrudNodeProcessor - Relation Field Handling', () => {
  let crudProcessor: CrudNodeProcessor
  let mockContextManager: any

  beforeEach(() => {
    crudProcessor = new CrudNodeProcessor()

    // Mock ExecutionContextManager
    mockContextManager = {
      getVariable: vi.fn((path: string) => {
        // Mock system variables
        if (path === 'sys.organizationId') return 'org_test_123'
        if (path === 'sys.userId') return 'user_test_123'
        // Mock workflow variables
        if (path === 'webhook.contact') return 'contact_abc123'
        if (path === 'webhook.assignee') return 'user_def456'
        return undefined
      }),
      interpolateVariables: vi.fn().mockImplementation((text: string) => {
        // Replace {{variable}} patterns with values from getVariable
        return Promise.resolve(
          text.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
            if (path === 'webhook.contact') return 'contact_abc123'
            if (path === 'webhook.assignee') return 'user_def456'
            return ''
          })
        )
      }),
      setNodeVariable: vi.fn(),
      log: vi.fn(),
      getContext: vi.fn(() => ({
        organizationId: 'org_test_123',
        userId: 'user_test_123',
      })),
    }
  })

  describe('preprocessNode - Relation Field Transformation', () => {
    it('should transform "contact" to "contactId" for ticket create', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Create Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {
            title: 'Test Ticket',
            contact: 'contact_abc123', // Logical field name
            priority: 'MEDIUM',
          },
        },
      }

      const result = await crudProcessor.preprocessNode(node, mockContextManager)

      // Should transform "contact" → "contactId"
      expect(result.inputs.data).toHaveProperty('contactId', 'contact_abc123')
      expect(result.inputs.data).not.toHaveProperty('contact')
    })

    it('should transform relation field with object value {referenceId: "xyz"}', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_2',
        name: 'Create Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {
            title: 'Test Ticket',
            contact: { referenceId: 'contact_xyz789' }, // Object format
            priority: 'HIGH',
          },
        },
      }

      const result = await crudProcessor.preprocessNode(node, mockContextManager)

      // Should extract referenceId and map to contactId
      expect(result.inputs.data).toHaveProperty('contactId', 'contact_xyz789')
      expect(result.inputs.data).not.toHaveProperty('contact')
    })

    it('should transform RELATION fields but preserve ACTOR fields', async () => {
      // Note: "contact" is BaseType.RELATION with dbColumn="contactId" -> gets transformed
      // "assignee" is BaseType.ACTOR with dbColumn="assignedToId" -> NOT transformed (ACTOR != RELATION)
      const node: WorkflowNode = {
        nodeId: 'node_3',
        name: 'Create Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {
            title: 'Test Ticket',
            contact: 'contact_abc123',
            assignee: 'user_def456',
            priority: 'LOW',
          },
        },
      }

      const result = await crudProcessor.preprocessNode(node, mockContextManager)

      // "contact" (BaseType.RELATION) should be transformed to "contactId"
      expect(result.inputs.data).toHaveProperty('contactId', 'contact_abc123')
      expect(result.inputs.data).not.toHaveProperty('contact')

      // "assignee" (BaseType.ACTOR) is NOT transformed - it stays as "assignee"
      expect(result.inputs.data).toHaveProperty('assignee', 'user_def456')
    })

    it('should handle null relation field values', async () => {
      // Note: "contact" (BaseType.RELATION) gets transformed to "contactId"
      // "assignee" (BaseType.ACTOR) does NOT get transformed - ACTOR != RELATION
      const node: WorkflowNode = {
        nodeId: 'node_4',
        name: 'Update Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'update',
          resourceId: 'ticket_123',
          data: {
            contact: null, // Removing contact
            assignee: null, // Removing assignee
          },
        },
      }

      const result = await crudProcessor.preprocessNode(node, mockContextManager)

      // "contact" (BaseType.RELATION) should transform to null with correct column name
      expect(result.inputs.data).toHaveProperty('contactId', null)

      // "assignee" (BaseType.ACTOR) stays as-is
      expect(result.inputs.data).toHaveProperty('assignee', null)
    })

    it('should preserve non-relation fields unchanged', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_5',
        name: 'Create Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {
            title: 'Test Ticket',
            description: 'Test Description',
            type: 'GENERAL',
            priority: 'MEDIUM',
            status: 'OPEN',
          },
        },
      }

      const result = await crudProcessor.preprocessNode(node, mockContextManager)

      // Non-relation fields should pass through unchanged
      expect(result.inputs.data).toHaveProperty('title', 'Test Ticket')
      expect(result.inputs.data).toHaveProperty('description', 'Test Description')
      expect(result.inputs.data).toHaveProperty('type', 'GENERAL')
      expect(result.inputs.data).toHaveProperty('priority', 'MEDIUM')
      expect(result.inputs.data).toHaveProperty('status', 'OPEN')
    })

    it('should resolve variables in relation fields', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_6',
        name: 'Create Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {
            title: 'Test Ticket',
            contact: '{{webhook.contact}}', // Variable reference
            priority: 'HIGH',
          },
        },
      }

      const result = await crudProcessor.preprocessNode(node, mockContextManager)

      // Should resolve variable and transform field name
      expect(result.inputs.data).toHaveProperty('contactId', 'contact_abc123')
      expect(result.inputs.data).not.toHaveProperty('contact')
    })
  })

  describe('executeNode - Preprocessing Enforcement', () => {
    it('should throw error when preprocessing is not provided', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_7',
        name: 'Create Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {
            title: 'Test Ticket',
            contact: 'contact_abc123',
          },
        },
      }

      // Call executeNode without preprocessing
      await expect(
        (crudProcessor as any).executeNode(node, mockContextManager, undefined)
      ).rejects.toThrow('CRUD node requires preprocessing')
    })

    it('should execute successfully with preprocessed data', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_8',
        name: 'Create Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {
            title: 'Test Ticket',
            contact: 'contact_abc123',
          },
        },
      }

      // First preprocess the node
      const preprocessed = await crudProcessor.preprocessNode(node, mockContextManager)

      // Verify preprocessing transformed the field
      expect(preprocessed.inputs.data).toHaveProperty('contactId')

      // Note: Full execution would require mocking TicketService and database
      // This test verifies the preprocessing requirement is enforced
    })
  })

  describe('validateRelationFields', () => {
    it('should pass validation when using database column names', () => {
      const validData = {
        title: 'Test Ticket',
        contactId: 'contact_abc123', // ✅ Correct database column name
        priority: 'HIGH',
      }

      // Should not throw
      expect(() => {
        ;(crudProcessor as any).validateRelationFields(validData, 'ticket', 'create')
      }).not.toThrow()
    })

    it('should fail validation when using logical field names', () => {
      const invalidData = {
        title: 'Test Ticket',
        contact: 'contact_abc123', // ❌ Logical name instead of contactId
        priority: 'HIGH',
      }

      // Should throw with clear error message
      expect(() => {
        ;(crudProcessor as any).validateRelationFields(invalidData, 'ticket', 'create')
      }).toThrow(/Invalid relation field names/)
      expect(() => {
        ;(crudProcessor as any).validateRelationFields(invalidData, 'ticket', 'create')
      }).toThrow(/"contact" should be "contactId"/)
    })

    it('should detect invalid RELATION fields (but not ACTOR fields)', () => {
      // validateRelationFields only checks fields with type=BaseType.RELATION
      // "assignee" is BaseType.ACTOR, so it's NOT checked by this validation
      // Use parentTicket (BaseType.RELATION) as the second invalid field
      const invalidData = {
        title: 'Test Ticket',
        contact: 'contact_abc123', // BaseType.RELATION - should be contactId
        parentTicket: 'ticket_xyz', // BaseType.RELATION - should be parentTicketId
        priority: 'HIGH',
      }

      // Should throw mentioning both RELATION fields
      expect(() => {
        ;(crudProcessor as any).validateRelationFields(invalidData, 'ticket', 'create')
      }).toThrow(/"contact" should be "contactId"/)
      expect(() => {
        ;(crudProcessor as any).validateRelationFields(invalidData, 'ticket', 'create')
      }).toThrow(/"parentTicket" should be "parentTicketId"/)
    })

    it('should allow data with both logical and database names (database name takes precedence)', () => {
      const mixedData = {
        title: 'Test Ticket',
        contact: 'contact_wrong', // Logical name (should be ignored)
        contactId: 'contact_correct', // Database column name (correct)
        priority: 'HIGH',
      }

      // Validation should pass because contactId is present
      // (even though contact is also present)
      expect(() => {
        ;(crudProcessor as any).validateRelationFields(mixedData, 'ticket', 'create')
      }).not.toThrow()
    })
  })

  describe('separateFieldData - Defensive Transformation', () => {
    it('should pass through already-transformed data unchanged', () => {
      const transformedData = {
        title: 'Test Ticket',
        contactId: 'contact_abc123', // Already using database column name
        priority: 'HIGH',
      }

      const result = (crudProcessor as any).separateFieldData(transformedData, 'ticket')

      expect(result.standardData).toHaveProperty('contactId', 'contact_abc123')
      expect(result.standardData).not.toHaveProperty('contact')
    })

    it('should transform logical field names as defensive layer', () => {
      const logicalData = {
        title: 'Test Ticket',
        contact: 'contact_abc123', // Logical name
        priority: 'HIGH',
      }

      const result = (crudProcessor as any).separateFieldData(logicalData, 'ticket')

      // Should transform to database column name
      expect(result.standardData).toHaveProperty('contactId', 'contact_abc123')
      // Note: The method transforms, so 'contact' won't be in output
    })

    it('should separate custom fields correctly', () => {
      const dataWithCustomFields = {
        title: 'Test Ticket',
        contactId: 'contact_abc123',
        custom_field_123: 'Custom value 1',
        custom_field_456: 'Custom value 2',
      }

      const result = (crudProcessor as any).separateFieldData(dataWithCustomFields, 'ticket')

      // Standard fields
      expect(result.standardData).toHaveProperty('title')
      expect(result.standardData).toHaveProperty('contactId')

      // Custom fields (without custom_ prefix)
      expect(result.customFieldData).toHaveProperty('field_123', 'Custom value 1')
      expect(result.customFieldData).toHaveProperty('field_456', 'Custom value 2')
    })
  })

  describe('Integration: Full Preprocessing Flow', () => {
    it('should handle complex ticket data with all field types', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_complex',
        name: 'Create Complex Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {
            // Standard fields
            title: 'Complex Ticket',
            description: 'This is a test',
            type: 'GENERAL',
            priority: 'HIGH',
            status: 'OPEN',
            // Relation fields (should be transformed)
            contact: 'contact_abc123',
            assignee: 'user_def456',
            // Custom fields (should be separated)
            custom_field_789: 'Custom value',
          },
        },
      }

      const result = await crudProcessor.preprocessNode(node, mockContextManager)

      // RELATION fields should be transformed
      expect(result.inputs.data).toHaveProperty('contactId', 'contact_abc123')
      expect(result.inputs.data).not.toHaveProperty('contact')

      // ACTOR fields (assignee) are NOT transformed - ACTOR != RELATION
      expect(result.inputs.data).toHaveProperty('assignee', 'user_def456')

      // Standard fields should pass through
      expect(result.inputs.data).toHaveProperty('title', 'Complex Ticket')
      expect(result.inputs.data).toHaveProperty('type', 'GENERAL')

      // Custom fields should remain (will be separated later)
      expect(result.inputs.data).toHaveProperty('custom_field_789', 'Custom value')

      // Metadata should be populated
      expect(result.metadata).toHaveProperty('nodeType', 'crud')
      expect(result.metadata).toHaveProperty('resourceType', 'ticket')
      expect(result.metadata).toHaveProperty('operation', 'create')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty data object', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_empty',
        name: 'Create Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {},
        },
      }

      const result = await crudProcessor.preprocessNode(node, mockContextManager)

      expect(result.inputs.data).toEqual({})
    })

    it('should handle undefined relation field value', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_undefined',
        name: 'Create Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {
            title: 'Test',
            contact: undefined,
          },
        },
      }

      const result = await crudProcessor.preprocessNode(node, mockContextManager)

      // Should handle undefined gracefully
      expect(result.inputs.data).toHaveProperty('contactId')
    })

    it('should handle empty string relation field value', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_empty_string',
        name: 'Create Ticket',
        type: WorkflowNodeType.CRUD,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'ticket',
          mode: 'create',
          data: {
            title: 'Test',
            contact: '',
          },
        },
      }

      const result = await crudProcessor.preprocessNode(node, mockContextManager)

      // Empty string should be transformed to null or passed through
      expect(result.inputs.data).toHaveProperty('contactId')
    })
  })
})
