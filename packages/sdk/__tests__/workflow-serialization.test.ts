// packages/sdk/__tests__/workflow-serialization.test.ts

import { describe, it, expect } from 'vitest'
import { Workflow } from '../src/root/workflow'

describe('Workflow Field Serialization', () => {
  describe('Basic Field Types', () => {
    it('should serialize string field with full metadata', () => {
      const stringField = Workflow.string({
        label: 'Email Address',
        description: 'User email',
        placeholder: 'user@example.com',
        acceptsVariables: true,
        minLength: 5,
        maxLength: 100,
      })

      const json = stringField.toJSON()

      expect(json.type).toBe('string')
      expect(json.acceptsVariables).toBe(true)
      expect(json._metadata?.label).toBe('Email Address')
      expect(json._metadata?.description).toBe('User email')
      expect(json._metadata?.placeholder).toBe('user@example.com')
      expect(json._metadata?.minLength).toBe(5)
      expect(json._metadata?.maxLength).toBe(100)
    })

    it('should serialize number field with constraints', () => {
      const numberField = Workflow.number({
        label: 'Count',
        description: 'Item count',
        min: 1,
        max: 100,
        integer: true,
        default: 10,
      })

      const json = numberField.toJSON()

      expect(json.type).toBe('number')
      expect(json._metadata?.label).toBe('Count')
      expect(json._metadata?.description).toBe('Item count')
      expect(json._metadata?.min).toBe(1)
      expect(json._metadata?.max).toBe(100)
      expect(json._metadata?.integer).toBe(true)
      expect(json._metadata?.defaultValue).toBe(10)
    })

    it('should serialize boolean field', () => {
      const booleanField = Workflow.boolean({
        label: 'Enabled',
        description: 'Feature enabled',
        default: false,
      })

      const json = booleanField.toJSON()

      expect(json.type).toBe('boolean')
      expect(json._metadata?.label).toBe('Enabled')
      expect(json._metadata?.defaultValue).toBe(false)
    })

    it('should serialize select field with options', () => {
      const selectField = Workflow.select({
        label: 'Priority',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
        default: 'medium',
      })

      const json = selectField.toJSON()

      expect(json.type).toBe('select')
      expect(json._metadata?.label).toBe('Priority')
      expect(json._metadata?.options).toHaveLength(3)
      expect(json._metadata?.defaultValue).toBe('medium')
    })
  })

  describe('Nested Structures', () => {
    it('should serialize struct with nested fields', () => {
      const personField = Workflow.struct({
        name: Workflow.string({ label: 'Name', required: true }),
        age: Workflow.number({ label: 'Age', min: 0, max: 120 }),
        email: Workflow.string({
          label: 'Email',
          pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$',
        }),
      }, {
        label: 'Person',
        description: 'Person information',
      })

      const json = personField.toJSON()

      expect(json.type).toBe('struct')
      expect(json._metadata?.label).toBe('Person')
      expect(json._metadata?.description).toBe('Person information')
      expect(json.fields).toBeDefined()
      expect(json.fields.name.type).toBe('string')
      expect(json.fields.name._metadata?.required).toBe(true)
      expect(json.fields.age.type).toBe('number')
      expect(json.fields.age._metadata?.min).toBe(0)
      expect(json.fields.email._metadata?.pattern).toBeDefined()
    })

    it('should serialize array with item type', () => {
      const tagsField = Workflow.array({
        label: 'Tags',
        description: 'List of tags',
        items: Workflow.string({ label: 'Tag' }),
      })

      const json = tagsField.toJSON()

      expect(json.type).toBe('array')
      expect(json._metadata?.label).toBe('Tags')
      expect(json._metadata?.description).toBe('List of tags')
      expect(json.items).toBeDefined()
      expect(json.items.type).toBe('string')
      expect(json.items._metadata?.label).toBe('Tag')
    })

    it('should serialize array of objects', () => {
      const usersField = Workflow.array({
        label: 'Users',
        items: Workflow.struct({
          id: Workflow.string({ label: 'ID' }),
          name: Workflow.string({ label: 'Name' }),
        }),
      })

      const json = usersField.toJSON()

      expect(json.type).toBe('array')
      expect(json.items.type).toBe('struct')
      expect(json.items.fields.id.type).toBe('string')
      expect(json.items.fields.name.type).toBe('string')
    })

    it('should serialize deeply nested structures', () => {
      const complexField = Workflow.struct({
        user: Workflow.struct({
          name: Workflow.string({ label: 'Name' }),
          addresses: Workflow.array({
            label: 'Addresses',
            items: Workflow.struct({
              street: Workflow.string({ label: 'Street' }),
              city: Workflow.string({ label: 'City' }),
            }),
          }),
        }),
      })

      const json = complexField.toJSON()

      expect(json.type).toBe('struct')
      expect(json.fields.user.type).toBe('struct')
      expect(json.fields.user.fields.addresses.type).toBe('array')
      expect(json.fields.user.fields.addresses.items.type).toBe('struct')
      expect(json.fields.user.fields.addresses.items.fields.street.type).toBe('string')
    })
  })

  describe('Output Fields', () => {
    it('should serialize output fields with same metadata as inputs', () => {
      const messageIdOutput = Workflow.string({
        label: 'Message ID',
        description: 'Unique identifier for the sent message',
      })

      const json = messageIdOutput.toJSON()

      expect(json.type).toBe('string')
      expect(json._metadata?.label).toBe('Message ID')
      expect(json._metadata?.description).toBe('Unique identifier for the sent message')
    })

    it('should serialize complex output structures', () => {
      const resultOutput = Workflow.struct({
        id: Workflow.string({ label: 'ID', description: 'Result ID' }),
        status: Workflow.string({ label: 'Status', description: 'Result status' }),
        data: Workflow.object({ label: 'Data', description: 'Result data' }),
        items: Workflow.array({
          label: 'Items',
          items: Workflow.struct({
            name: Workflow.string({ label: 'Name' }),
            value: Workflow.number({ label: 'Value' }),
          }),
        }),
      }, {
        label: 'API Response',
        description: 'Response from API call',
      })

      const json = resultOutput.toJSON()

      expect(json.type).toBe('struct')
      expect(json._metadata?.label).toBe('API Response')
      expect(json.fields.id.type).toBe('string')
      expect(json.fields.status.type).toBe('string')
      expect(json.fields.data.type).toBe('object')
      expect(json.fields.items.type).toBe('array')
      expect(json.fields.items.items.type).toBe('struct')
    })
  })

  describe('Optional Fields', () => {
    it('should handle optional fields correctly', () => {
      const optionalField = Workflow.string({ label: 'Optional Field' }).optional()

      const json = optionalField.toJSON()

      expect(json.isOptional).toBe(true)
      expect(json._metadata?.label).toBe('Optional Field')
    })

    it('should handle required fields correctly', () => {
      const requiredField = Workflow.string({ label: 'Required Field', required: true })

      const json = requiredField.toJSON()

      expect(json._metadata?.required).toBe(true)
    })
  })

  describe('Variable Acceptance', () => {
    it('should serialize acceptsVariables and variableTypes', () => {
      const variableField = Workflow.string({
        label: 'Dynamic Value',
        acceptsVariables: true,
        variableTypes: ['string', 'number'],
      })

      const json = variableField.toJSON()

      expect(json.acceptsVariables).toBe(true)
      expect(json.variableTypes).toEqual(['string', 'number'])
    })

    it('should not include acceptsVariables if false', () => {
      const staticField = Workflow.string({
        label: 'Static Value',
      })

      const json = staticField.toJSON()

      expect(json.acceptsVariables).toBeUndefined()
    })
  })
})
