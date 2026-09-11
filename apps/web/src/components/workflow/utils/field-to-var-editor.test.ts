// apps/web/src/components/workflow/utils/field-to-var-editor.test.ts

import { describe, expect, it } from 'vitest'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import { mapFieldToVarEditorProps, mapFieldType } from './field-to-var-editor'

describe('mapFieldToVarEditorProps — address', () => {
  it('resolves type "address" to the ADDRESS render path, not the STRING fallback', () => {
    const result = mapFieldToVarEditorProps({ type: 'address' })

    expect(result.varType).toBe(BaseType.ADDRESS)
    expect(result.mode).toBe(VAR_MODE.PICKER)
    // The trap: without the case above, the default arm returns STRING/RICH and an app
    // shipping Workflow.address() silently renders a plain text box.
    expect(result.varType).not.toBe(BaseType.STRING)
    expect(result.mode).not.toBe(VAR_MODE.RICH)
  })

  it('passes addressComponents and inputMode through in fieldOptions', () => {
    const result = mapFieldToVarEditorProps({
      type: 'address',
      addressComponents: ['street1', 'city', 'country'],
      inputMode: 'structured',
    })

    expect(result.fieldOptions?.addressComponents).toEqual(['street1', 'city', 'country'])
    expect(result.fieldOptions?.inputMode).toBe('structured')
  })

  it('resolves an absent inputMode to single, matching parseAddressInputMode', () => {
    const result = mapFieldToVarEditorProps({ type: 'address' })

    expect(result.fieldOptions?.inputMode).toBe('single')
    expect(result.fieldOptions?.addressComponents).toBeUndefined()
  })

  it('normalizes an unknown inputMode to single', () => {
    const result = mapFieldToVarEditorProps({ type: 'address', inputMode: 'nonsense' })

    expect(result.fieldOptions?.inputMode).toBe('single')
  })

  it('honours acceptsVariables: false by disallowing constant-mode toggling', () => {
    expect(
      mapFieldToVarEditorProps({ type: 'address', acceptsVariables: false }).allowConstant
    ).toBe(false)
    expect(
      mapFieldToVarEditorProps({ type: 'address', acceptsVariables: true }).allowConstant
    ).toBe(true)
  })

  it('maps an "address" entry in variableTypes to BaseType.ADDRESS', () => {
    const result = mapFieldToVarEditorProps({
      type: 'address',
      variableTypes: ['address', 'string'],
    })

    expect(result.allowedTypes).toEqual([BaseType.ADDRESS, BaseType.STRING])
  })
})

describe('mapFieldType — address', () => {
  it('returns BaseType.ADDRESS for the type icon', () => {
    expect(mapFieldType('address')).toBe(BaseType.ADDRESS)
  })
})
