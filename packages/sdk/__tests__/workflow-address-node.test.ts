// packages/sdk/__tests__/workflow-address-node.test.ts

import { describe, expect, it } from 'vitest'
import { Workflow, WorkflowAddressNode } from '../src/root/workflow'

describe('Workflow.address', () => {
  it('creates a WorkflowAddressNode with type "address"', () => {
    const field = Workflow.address({ label: 'Ship To' })

    expect(field).toBeInstanceOf(WorkflowAddressNode)
    expect(field.type).toBe('address')
  })

  it('serializes the shared metadata', () => {
    const json = Workflow.address({
      label: 'Ship To',
      description: 'Where the parcel goes',
      required: true,
      acceptsVariables: true,
    }).toJSON()

    expect(json.type).toBe('address')
    expect(json.acceptsVariables).toBe(true)
    expect(json._metadata?.label).toBe('Ship To')
    expect(json._metadata?.description).toBe('Where the parcel goes')
    expect(json._metadata?.required).toBe(true)
  })

  it('serializes addressComponents and inputMode into metadata', () => {
    const json = Workflow.address({
      label: 'Ship From',
      addressComponents: ['street1', 'city', 'country'],
      inputMode: 'single',
    }).toJSON()

    expect(json._metadata?.addressComponents).toEqual(['street1', 'city', 'country'])
    expect(json._metadata?.inputMode).toBe('single')
  })

  it('omits addressComponents and inputMode when not given', () => {
    const json = Workflow.address({ label: 'Ship From' }).toJSON()

    expect(json._metadata?.addressComponents).toBeUndefined()
    expect(json._metadata?.inputMode).toBeUndefined()
  })

  it('optional() returns a new node carrying the original options', () => {
    const field = Workflow.address({ label: 'Ship To', inputMode: 'structured' })
    const optionalField = field.optional()

    expect(optionalField).not.toBe(field)
    expect(optionalField.isOptional).toBe(true)
    expect(field.isOptional).toBe(false)
    expect(optionalField.toJSON()._metadata?.inputMode).toBe('structured')
  })

  it('passes values through serialize and deserialize unchanged', () => {
    const field = Workflow.address()
    const value = {
      street1: '1 Main St',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'US',
    }

    expect(field.serialize(value)).toEqual(value)
    expect(field.deserialize(value)).toEqual(value)
  })
})
