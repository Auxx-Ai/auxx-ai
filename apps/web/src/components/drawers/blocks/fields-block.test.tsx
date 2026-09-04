// apps/web/src/components/drawers/blocks/fields-block.test.tsx
//
// One interesting case, and it is a silent-wrong-output case rather than a
// crash: `EntityFields.includeFields` treats an EMPTY array as "no filter" and
// renders the entire record. So a promoted field group whose members were all
// deleted, or whose group id no longer exists in the stored panel view, would
// dump every field of the record into a section still labelled with that one
// group's name. The block has to render nothing instead.
//
// The second case is the keyspace mismatch behind it: `fieldGroups[].fieldIds`
// holds resourceFieldIds while `includeFields` matches `field.key`, so the
// membership must be TRANSLATED. Passing it straight through resolves to zero
// keys, which is the bug above wearing a different hat.

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEF = 'edf_contact00000000000000000'
const RECORD_ID = `${DEF}:ein_row000000000000000000000`

const h = vi.hoisted(() => ({
  fields: [] as { resourceFieldId: string; key: string }[],
  fieldGroups: undefined as { id: string; label: string; fieldIds: string[] }[] | undefined,
}))

vi.mock('~/components/resources', () => ({
  useResourceFields: () => ({ fields: h.fields, isLoading: false }),
}))

vi.mock('~/components/fields/hooks/use-field-view', () => ({
  useFieldView: () => ({
    config: { fieldVisibility: {}, fieldOrder: [], fieldGroups: h.fieldGroups },
  }),
}))

vi.mock('~/components/fields/entity-fields', () => ({
  default: ({ includeFields }: { includeFields?: string[] }) => (
    <div
      data-testid='entity-fields'
      data-include={includeFields ? includeFields.join(',') : 'ALL'}
    />
  ),
}))

vi.mock('@auxx/lib/resources/client', () => ({
  parseRecordId: (recordId: string) => {
    const colon = recordId.indexOf(':')
    return {
      entityDefinitionId: recordId.slice(0, colon),
      entityInstanceId: recordId.slice(colon + 1),
    }
  },
}))

import { FieldsBlock } from './fields-block'

beforeEach(() => {
  h.fields = [
    { resourceFieldId: `${DEF}:fld_street`, key: 'street' },
    { resourceFieldId: `${DEF}:fld_city`, key: 'city' },
    { resourceFieldId: `${DEF}:fld_email`, key: 'email' },
  ]
  h.fieldGroups = [
    { id: 'grp_address', label: 'Address', fieldIds: [`${DEF}:fld_street`, `${DEF}:fld_city`] },
  ]
})

describe('FieldsBlock', () => {
  it('renders the whole record when no group is named (core:details)', () => {
    render(<FieldsBlock recordId={RECORD_ID as never} />)
    expect(screen.getByTestId('entity-fields')).toHaveAttribute('data-include', 'ALL')
  })

  it('translates group membership from resourceFieldId to field key', () => {
    render(<FieldsBlock recordId={RECORD_ID as never} config={{ fieldGroupId: 'grp_address' }} />)
    expect(screen.getByTestId('entity-fields')).toHaveAttribute('data-include', 'street,city')
  })

  it('renders NOTHING for a group id the stored view no longer has', () => {
    render(<FieldsBlock recordId={RECORD_ID as never} config={{ fieldGroupId: 'grp_gone' }} />)
    expect(screen.queryByTestId('entity-fields')).not.toBeInTheDocument()
  })

  it('renders NOTHING for a group whose every member was deleted', () => {
    h.fieldGroups = [{ id: 'grp_address', label: 'Address', fieldIds: [`${DEF}:fld_deleted`] }]
    render(<FieldsBlock recordId={RECORD_ID as never} config={{ fieldGroupId: 'grp_address' }} />)
    // NOT `includeFields: []`. That is "no filter" to EntityFields and would
    // render every field of the record under one group's name.
    expect(screen.queryByTestId('entity-fields')).not.toBeInTheDocument()
  })

  it('renders nothing when the panel view carries no groups at all', () => {
    h.fieldGroups = undefined
    render(<FieldsBlock recordId={RECORD_ID as never} config={{ fieldGroupId: 'grp_address' }} />)
    expect(screen.queryByTestId('entity-fields')).not.toBeInTheDocument()
  })
})
