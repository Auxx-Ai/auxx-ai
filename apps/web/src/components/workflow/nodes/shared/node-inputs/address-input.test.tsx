// apps/web/src/components/workflow/nodes/shared/node-inputs/address-input.test.tsx

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseType } from '~/components/workflow/types'
import { getSpecificPropsForType } from '~/components/workflow/ui/input-editor/get-input-component'
import { mapFieldToVarEditorProps } from '~/components/workflow/utils/field-to-var-editor'

/**
 * These tests walk the real chain an app's `Workflow.address()` field takes:
 *
 *   mapFieldToVarEditorProps -> getSpecificPropsForType -> AddressInput -> Address*Fields
 *
 * Every link is a real function; only the two leaf field components and the org-country
 * hook are doubled, so the assertion is genuinely "the options reached the renderer".
 * A typecheck cannot catch a break anywhere in this chain, which is the whole point.
 */

const singleProps = vi.fn()
const structProps = vi.fn()

vi.mock('~/components/fields/inputs/address-single-input-field', () => ({
  AddressSingleFields: (props: Record<string, unknown>) => {
    singleProps(props)
    return <div data-testid='single-fields' />
  },
}))

vi.mock('~/components/fields/inputs/address-struct-input-field', () => ({
  AddressStructFields: (props: Record<string, unknown>) => {
    structProps(props)
    return <div data-testid='struct-fields' />
  },
}))

vi.mock('~/components/fields/inputs/use-org-business-country', () => ({
  useOrgBusinessCountry: () => 'US',
}))

const { AddressInput } = await import('./address-input')

/** Render AddressInput the way ConstantInputAdapter does, from an SDK field declaration. */
function renderFromSchemaField(field: {
  addressComponents?: string[]
  inputMode?: string
  fieldType?: string
}) {
  const { varType, fieldOptions } = mapFieldToVarEditorProps({
    type: 'address',
    addressComponents: field.addressComponents,
    inputMode: field.inputMode,
  })
  expect(varType).toBe(BaseType.ADDRESS)

  const specificProps = getSpecificPropsForType(varType, { fieldOptions })

  render(
    <AddressInput
      inputs={{ _value: {} }}
      errors={{}}
      onChange={vi.fn()}
      onError={vi.fn()}
      name='_value'
      fieldType={field.fieldType}
      {...specificProps}
    />
  )
}

beforeEach(() => {
  singleProps.mockClear()
  structProps.mockClear()
})

describe('Workflow.address options reach the rendered component', () => {
  it('delivers addressComponents all the way to the field component', () => {
    renderFromSchemaField({ addressComponents: ['street1', 'city'] })

    expect(singleProps).toHaveBeenCalledTimes(1)
    expect(singleProps.mock.calls[0][0].components).toEqual(['street1', 'city'])
  })

  it('delivers addressComponents in structured mode too', () => {
    renderFromSchemaField({ addressComponents: ['street1', 'city'], inputMode: 'structured' })

    expect(structProps).toHaveBeenCalledTimes(1)
    expect(structProps.mock.calls[0][0].components).toEqual(['street1', 'city'])
  })

  it('resolves an absent inputMode to the single paste-and-parse editor', () => {
    renderFromSchemaField({})

    expect(singleProps).toHaveBeenCalledTimes(1)
    expect(structProps).not.toHaveBeenCalled()
  })

  it('renders the structured editor when inputMode is structured', () => {
    renderFromSchemaField({ inputMode: 'structured' })

    expect(structProps).toHaveBeenCalledTimes(1)
    expect(singleProps).not.toHaveBeenCalled()
  })

  it('leaves components undefined when the field declares no addressComponents', () => {
    renderFromSchemaField({})

    expect(singleProps.mock.calls[0][0].components).toBeUndefined()
  })
})

describe('AddressInput fieldType branching', () => {
  it('keeps legacy plain-text ADDRESS on the structured fields regardless of inputMode', () => {
    // Decision #9: legacy ADDRESS must not be flipped to single mode by this change.
    renderFromSchemaField({ fieldType: 'ADDRESS' })

    expect(structProps).toHaveBeenCalledTimes(1)
    expect(singleProps).not.toHaveBeenCalled()
  })

  it('honours inputMode for a real ADDRESS_STRUCT field', () => {
    renderFromSchemaField({ fieldType: 'ADDRESS_STRUCT' })

    expect(singleProps).toHaveBeenCalledTimes(1)
    expect(structProps).not.toHaveBeenCalled()
  })
})

/**
 * The options tests above all render with an EMPTY value, which is how a real
 * bug shipped green: `parseAddressValue` rebuilds the struct from scratch on
 * every render, and it listed only the original six keys. `name` and
 * `residential` were therefore deleted on the render following any edit.
 *
 * It presented to the user as "the residential picker will not move off
 * unknown" rather than as data loss, because the select falls back to
 * `'unknown'` when the key is missing. Nothing about it was visible to a
 * typecheck, and no options test could have caught it.
 */
describe('the stored value survives the round trip', () => {
  function renderWithValue(value: Record<string, unknown>, inputMode = 'structured') {
    const { fieldOptions } = mapFieldToVarEditorProps({ type: 'address', inputMode })
    const specificProps = getSpecificPropsForType(BaseType.ADDRESS, { fieldOptions })
    const onChange = vi.fn()
    const view = render(
      <AddressInput
        inputs={{ _value: value }}
        errors={{}}
        onChange={onChange}
        onError={vi.fn()}
        name='_value'
        {...specificProps}
      />
    )
    return { onChange, view, specificProps }
  }

  it('carries name and residential into the structured editor', () => {
    renderWithValue({ street1: '1 Example St', name: 'Jane Roe', residential: 'yes' })

    const { value } = structProps.mock.calls[0]![0] as { value: Record<string, unknown> }
    expect(value.name).toBe('Jane Roe')
    expect(value.residential).toBe('yes')
    expect(value.street1).toBe('1 Example St')
  })

  it('carries them into the single-input editor too', () => {
    renderWithValue({ city: 'Austin', name: 'Jane Roe', residential: 'no' }, 'single')

    const { value } = singleProps.mock.calls[0]![0] as { value: Record<string, unknown> }
    expect(value.name).toBe('Jane Roe')
    expect(value.residential).toBe('no')
  })

  it('keeps residential across a re-render, which is the bug that shipped', () => {
    const { onChange, view, specificProps } = renderWithValue({ street1: '1 Example St' })

    // What the child does when the picker moves off "unknown".
    const stored = { street1: '1 Example St', residential: 'yes' }
    onChange('_value', stored)

    view.rerender(
      <AddressInput
        inputs={{ _value: stored }}
        errors={{}}
        onChange={onChange}
        onError={vi.fn()}
        name='_value'
        {...specificProps}
      />
    )

    const last = structProps.mock.calls.at(-1)![0] as { value: Record<string, unknown> }
    expect(last.value.residential).toBe('yes')
  })

  it('treats an unrecognised residential as unanswered, never as commercial', () => {
    // `'no'` suppresses a carrier surcharge, so a junk value must not become one.
    renderWithValue({ street1: '1 Example St', residential: 'Residential' })

    const { value } = structProps.mock.calls[0]![0] as { value: Record<string, unknown> }
    expect(value.residential).toBeUndefined()
  })
})
