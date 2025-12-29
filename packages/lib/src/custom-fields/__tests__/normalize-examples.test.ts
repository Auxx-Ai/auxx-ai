// packages/lib/src/custom-fields/__tests__/normalize-examples.test.ts
import { normalizeCustomFieldValue } from '../custom-field-service'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'

/**
 * Test examples for normalizeCustomFieldValue function
 * These tests demonstrate the normalization behavior for different field types
 */

describe('normalizeCustomFieldValue', () => {
  describe('CHECKBOX type', () => {
    const field = { type: FieldTypeEnum.CHECKBOX, name: 'testCheckbox' }

    it('should parse string "true" to boolean true', () => {
      const result = normalizeCustomFieldValue('true', field)
      expect(result).toEqual({ data: true })
    })

    it('should parse string "false" to boolean false', () => {
      const result = normalizeCustomFieldValue('false', field)
      expect(result).toEqual({ data: false })
    })

    it('should parse number 1 to boolean true', () => {
      const result = normalizeCustomFieldValue(1, field)
      expect(result).toEqual({ data: true })
    })

    it('should parse number 0 to boolean false', () => {
      const result = normalizeCustomFieldValue(0, field)
      expect(result).toEqual({ data: false })
    })

    it('should unwrap legacy {"data": true} format', () => {
      const result = normalizeCustomFieldValue({ data: true }, field)
      expect(result).toEqual({ data: true })
    })
  })

  describe('SINGLE_SELECT type', () => {
    const field = {
      type: FieldTypeEnum.SINGLE_SELECT,
      name: 'testSelect',
      options: {
        options: [
          { label: 'Option 1', value: 'opt1' },
          { label: 'Option 2', value: 'opt2' },
        ],
      },
    }

    it('should accept valid option value', () => {
      const result = normalizeCustomFieldValue('opt1', field)
      expect(result).toEqual({ data: 'opt1' })
    })

    it('should accept valid option by label', () => {
      const result = normalizeCustomFieldValue('Option 1', field)
      expect(result).toEqual({ data: 'opt1' })
    })

    it('should throw error for invalid option', () => {
      expect(() => normalizeCustomFieldValue('invalid', field)).toThrow(
        'Invalid value for field "testSelect"'
      )
    })

    it('should unwrap legacy {"data": "opt1"} format', () => {
      const result = normalizeCustomFieldValue({ data: 'opt1' }, field)
      expect(result).toEqual({ data: 'opt1' })
    })
  })

  describe('MULTI_SELECT type', () => {
    const field = {
      type: FieldTypeEnum.MULTI_SELECT,
      name: 'testMultiSelect',
      options: {
        options: [
          { label: 'Tag 1', value: 'tag1' },
          { label: 'Tag 2', value: 'tag2' },
          { label: 'Tag 3', value: 'tag3' },
        ],
      },
    }

    it('should accept array of valid values', () => {
      const result = normalizeCustomFieldValue(['tag1', 'tag2'], field)
      expect(result).toEqual({ data: ['tag1', 'tag2'] })
    })

    it('should parse comma-separated string to array', () => {
      const result = normalizeCustomFieldValue('tag1, tag2', field)
      expect(result).toEqual({ data: ['tag1', 'tag2'] })
    })

    it('should throw error for invalid values', () => {
      expect(() => normalizeCustomFieldValue(['tag1', 'invalid'], field)).toThrow(
        'Invalid values for field "testMultiSelect"'
      )
    })

    it('should unwrap legacy {"data": ["tag1"]} format', () => {
      const result = normalizeCustomFieldValue({ data: ['tag1'] }, field)
      expect(result).toEqual({ data: ['tag1'] })
    })
  })

  describe('NUMBER type', () => {
    const field = { type: FieldTypeEnum.NUMBER, name: 'testNumber' }

    it('should accept number values', () => {
      const result = normalizeCustomFieldValue(123, field)
      expect(result).toEqual({ data: 123 })
    })

    it('should parse string numbers', () => {
      const result = normalizeCustomFieldValue('123.45', field)
      expect(result).toEqual({ data: 123.45 })
    })

    it('should throw error for invalid numbers', () => {
      expect(() => normalizeCustomFieldValue('abc', field)).toThrow(
        'Invalid NUMBER value for field "testNumber"'
      )
    })

    it('should unwrap legacy {"data": 123} format', () => {
      const result = normalizeCustomFieldValue({ data: 123 }, field)
      expect(result).toEqual({ data: 123 })
    })
  })

  describe('DATE type', () => {
    const field = { type: FieldTypeEnum.DATE, name: 'testDate' }

    it('should accept Date objects', () => {
      const date = new Date('2024-01-15')
      const result = normalizeCustomFieldValue(date, field)
      expect(result.data).toBe(date.toISOString())
    })

    it('should parse valid date strings', () => {
      const result = normalizeCustomFieldValue('2024-01-15', field)
      expect(result.data).toBe(new Date('2024-01-15').toISOString())
    })

    it('should throw error for invalid dates', () => {
      expect(() => normalizeCustomFieldValue('invalid-date', field)).toThrow(
        'Invalid DATE value for field "testDate"'
      )
    })
  })

  describe('TAGS type', () => {
    const field = { type: FieldTypeEnum.TAGS, name: 'testTags' }

    it('should accept array of tags', () => {
      const result = normalizeCustomFieldValue(['tag1', 'tag2'], field)
      expect(result).toEqual({ data: ['tag1', 'tag2'] })
    })

    it('should parse comma-separated string', () => {
      const result = normalizeCustomFieldValue('tag1, tag2, tag3', field)
      expect(result).toEqual({ data: ['tag1', 'tag2', 'tag3'] })
    })

    it('should trim whitespace from tags', () => {
      const result = normalizeCustomFieldValue(['  tag1  ', '  tag2  '], field)
      expect(result).toEqual({ data: ['tag1', 'tag2'] })
    })
  })

  describe('ADDRESS_STRUCT type', () => {
    const field = { type: FieldTypeEnum.ADDRESS_STRUCT, name: 'testAddress' }

    it('should accept valid address object', () => {
      const address = {
        street: '123 Main St',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        country: 'USA',
      }
      const result = normalizeCustomFieldValue(address, field)
      expect(result).toEqual({ data: address })
    })

    it('should fill missing fields with empty strings', () => {
      const address = { city: 'New York' }
      const result = normalizeCustomFieldValue(address, field)
      expect(result.data).toEqual({
        street: '',
        city: 'New York',
        state: '',
        postalCode: '',
        country: '',
      })
    })

    it('should throw error for non-object values', () => {
      expect(() => normalizeCustomFieldValue('not an object', field)).toThrow(
        'ADDRESS_STRUCT field "testAddress" requires an object'
      )
    })
  })

  describe('TEXT type', () => {
    const field = { type: FieldTypeEnum.TEXT, name: 'testText' }

    it('should convert to string and trim', () => {
      const result = normalizeCustomFieldValue('  hello world  ', field)
      expect(result).toEqual({ data: 'hello world' })
    })

    it('should convert numbers to strings', () => {
      const result = normalizeCustomFieldValue(123, field)
      expect(result).toEqual({ data: '123' })
    })

    it('should unwrap legacy {"data": "text"} format', () => {
      const result = normalizeCustomFieldValue({ data: 'hello' }, field)
      expect(result).toEqual({ data: 'hello' })
    })
  })

  describe('null and empty handling', () => {
    const field = { type: FieldTypeEnum.TEXT, name: 'testField' }

    it('should handle null values', () => {
      const result = normalizeCustomFieldValue(null, field)
      expect(result).toEqual({ data: null })
    })

    it('should handle undefined values', () => {
      const result = normalizeCustomFieldValue(undefined, field)
      expect(result).toEqual({ data: null })
    })

    it('should handle empty strings as null', () => {
      const result = normalizeCustomFieldValue('   ', field)
      expect(result).toEqual({ data: null })
    })
  })

  describe('legacy {"data": x} unwrapping', () => {
    it('should unwrap and re-validate CHECKBOX', () => {
      const field = { type: FieldTypeEnum.CHECKBOX, name: 'test' }
      // Legacy stored "true" as string in {data: "true"}
      const result = normalizeCustomFieldValue({ data: 'true' }, field)
      expect(result).toEqual({ data: true })
    })

    it('should unwrap and re-validate NUMBER', () => {
      const field = { type: FieldTypeEnum.NUMBER, name: 'test' }
      // Legacy stored number as string in {data: "123"}
      const result = normalizeCustomFieldValue({ data: '123' }, field)
      expect(result).toEqual({ data: 123 })
    })

    it('should be idempotent for properly formatted values', () => {
      const field = { type: FieldTypeEnum.TEXT, name: 'test' }
      const firstPass = normalizeCustomFieldValue('hello', field)
      const secondPass = normalizeCustomFieldValue(firstPass, field)
      expect(firstPass).toEqual(secondPass)
    })
  })
})
