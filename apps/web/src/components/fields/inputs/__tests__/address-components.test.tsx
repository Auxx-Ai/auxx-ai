// apps/web/src/components/fields/inputs/__tests__/address-components.test.tsx
//
// `addressComponents` was fully declared - field-options schema, tRPC router, app-deployment
// schema, `defineField`, and a complete checkbox editor - and read by NOTHING. An admin could
// uncheck "Apartment/Suite", save, and every renderer still drew all six inputs
// (plans/apps/shipstation/shipstation-workflow-expansion-plan.md §5). These tests pin the
// wiring in both directions: the option now hides a sub-field, and an absent option still
// renders exactly the six an existing field has always shown.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseAddressComponents } from '~/components/custom-fields/ui/address-component-editor'
import { type AddressStruct, AddressStructFields } from '../address-struct-input-field'

const EMPTY: AddressStruct = {
  street1: '',
  street2: '',
  city: '',
  state: '',
  zipCode: '',
  country: '',
}

const ALL_SIX_PLACEHOLDERS = [
  'Street address',
  'Apartment, suite, etc. (optional)',
  'City',
  'State',
  'ZIP Code',
]

function renderFields(components?: string[]) {
  return render(<AddressStructFields value={EMPTY} onChange={vi.fn()} components={components} />)
}

describe('parseAddressComponents', () => {
  it('returns the original six when the option is absent', () => {
    expect(parseAddressComponents()).toEqual([
      'street1',
      'street2',
      'city',
      'state',
      'zipCode',
      'country',
    ])
  })

  it('returns the stored list verbatim when an admin configured one', () => {
    expect(parseAddressComponents({ addressComponents: ['street1', 'city'] })).toEqual([
      'street1',
      'city',
    ])
  })

  it('carries the opt-in name and residential ids through', () => {
    expect(
      parseAddressComponents({ addressComponents: ['name', 'street1', 'residential'] })
    ).toEqual(['name', 'street1', 'residential'])
  })

  // Five registry address fields ship `['street', 'city', 'state', 'country']` - written
  // before the editor's id set existed, naming `street` rather than `street1` and omitting
  // `street2`/`zipCode`. Honoring that literally would delete the ZIP line from every order,
  // work order and company address in every org.
  it('treats a pre-editor registry literal as un-configured', () => {
    expect(
      parseAddressComponents({ addressComponents: ['street', 'city', 'state', 'country'] })
    ).toEqual(['street1', 'street2', 'city', 'state', 'zipCode', 'country'])
  })

  it('treats an empty list as un-configured rather than rendering nothing', () => {
    expect(parseAddressComponents({ addressComponents: [] })).toHaveLength(6)
  })
})

describe('AddressStructFields honors addressComponents', () => {
  it('renders the original six, and neither opt-in key, with no components prop', () => {
    renderFields()
    for (const placeholder of ALL_SIX_PLACEHOLDERS) {
      expect(screen.getByPlaceholderText(placeholder)).toBeInTheDocument()
    }
    expect(screen.getByText('Country')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Residential')).not.toBeInTheDocument()
  })

  it('hides a sub-field the option leaves out', () => {
    renderFields(['street1', 'city', 'state', 'zipCode', 'country'])
    expect(
      screen.queryByPlaceholderText('Apartment, suite, etc. (optional)')
    ).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Street address')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('ZIP Code')).toBeInTheDocument()
  })

  it('renders the name input and the three-way residential select when opted in', () => {
    renderFields(['name', 'street1', 'city', 'state', 'zipCode', 'country', 'residential'])
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument()
    // A select, not a checkbox: `unknown` is a real, distinct state.
    expect(screen.getByLabelText('Residential')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders only what is asked for', () => {
    renderFields(['name', 'street1'])
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Street address')).toBeInTheDocument()
    for (const placeholder of ['City', 'State', 'ZIP Code']) {
      expect(screen.queryByPlaceholderText(placeholder)).not.toBeInTheDocument()
    }
  })
})
