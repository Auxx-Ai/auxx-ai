// apps/web/src/components/fields/property-provider.name-commit.test.tsx
//
// The property row has TWO commit paths and they used to disagree about NAME.
// `commitValue` (reached by clicking away to dismiss the popover) split the
// composite into its two TEXT part fields; `commitValueAndClose` (reached by
// pressing Enter or arrowing to the next row) had no NAME branch at all and
// wrote the composite raw, leaving the parts stale. Same field, same value,
// different key pressed.
//
// The split now lives below both of them, in the save funnel, so this file
// drives BOTH paths and asserts the same thing of each: two part-field writes,
// no NAME-field write. It is the guard on the deletion — if a NAME branch ever
// grows back into one commit path and not the other, these two cases stop
// agreeing.
//
// Everything below the funnel runs for real (the funnel, both stores, the
// resource registry); only the wire and the value read are stubbed.

import type { CustomResource, RecordId, ResourceField } from '@auxx/lib/resources/client'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getResourceStoreState } from '~/components/resources/store/resource-store'

const DEF = 'def_contact00000000000000000'
const RECORD_ID = `${DEF}:ein_anita0000000000000000000` as RecordId

const NAME_ID = 'fld_full_name000000000000000'
const FIRST_ID = 'fld_first_name00000000000000'
const LAST_ID = 'fld_last_name0000000000000000'

interface BulkInput {
  recordIds: string[]
  values: Array<{ fieldId: string; value: unknown }>
}

const h = vi.hoisted(() => ({
  set: [] as unknown[],
  bulk: [] as unknown[],
}))

vi.mock('~/trpc/react', () => {
  const record = (sink: unknown[]) => ({
    useMutation: () => ({
      mutate: (input: unknown, opts?: { onSuccess?: (result: unknown) => void }) => {
        sink.push(input)
        opts?.onSuccess?.({ values: [] })
      },
      mutateAsync: async (input: unknown) => {
        sink.push(input)
        return { values: [] }
      },
      isPending: false,
    }),
  })
  return { api: { fieldValue: { set: record(h.set), setBulk: record(h.bulk) } } }
})

// The row opens over an empty value — what it reads back is not what is under
// test, and the real hook auto-fetches through tRPC.
vi.mock('~/components/resources/hooks/use-field-values', () => ({
  useFieldValue: () => ({ value: undefined, isLoading: false }),
}))

const { PropertyProvider, usePropertyContext } = await import('./property-provider')

type Ctx = ReturnType<typeof usePropertyContext>

/** The NAME composite exactly as the record drawer hands it down. */
const nameField = {
  id: NAME_ID,
  key: 'fullName',
  label: 'Full Name',
  type: 'string',
  fieldType: 'NAME',
  systemAttribute: 'full_name',
  capabilities: { updatable: true },
  options: { name: { firstNameFieldId: FIRST_ID, lastNameFieldId: LAST_ID } },
} as unknown as ResourceField

function partField(id: string, key: string): ResourceField {
  return {
    id,
    key,
    label: key,
    type: 'string',
    fieldType: 'TEXT',
    capabilities: { updatable: true },
  } as unknown as ResourceField
}

/** Mount the row and hand back its context. */
function mountRow(): Ctx {
  let ctx: Ctx | undefined
  function Probe() {
    ctx = usePropertyContext()
    return null
  }
  render(
    <PropertyProvider field={nameField} providerId='p1' recordId={RECORD_ID}>
      <Probe />
    </PropertyProvider>
  )
  if (!ctx) throw new Error('PropertyProvider rendered no context')
  return ctx
}

/** Every `{ fieldId, value }` the row put on the wire, across both mutations. */
function wireEntries(): Array<{ fieldId: string; value: unknown }> {
  return [
    ...(h.set as Array<{ fieldId: string; value: unknown }>).map((i) => ({
      fieldId: i.fieldId,
      value: i.value,
    })),
    ...(h.bulk as BulkInput[]).flatMap((i) => i.values),
  ]
}

beforeEach(() => {
  h.set.length = 0
  h.bulk.length = 0
  getResourceStoreState().reset()
  getResourceStoreState().setResources([
    {
      id: DEF,
      type: 'custom',
      apiSlug: 'contacts',
      entityType: 'contact',
      entityDefinitionId: DEF,
      organizationId: 'org_1',
      label: 'Contact',
      plural: 'Contacts',
      icon: 'user',
      color: 'blue',
      isVisible: true,
      fields: [nameField, partField(FIRST_ID, 'firstName'), partField(LAST_ID, 'lastName')],
      display: {
        primaryDisplayField: null,
        secondaryDisplayField: null,
        avatarField: null,
        defaultSortField: 'updatedAt',
        defaultSortDirection: 'desc',
        orgScopingStrategy: 'direct',
      },
    } as unknown as CustomResource,
  ])
})

describe('PropertyProvider — a NAME row writes its parts from EITHER commit path', () => {
  // The click-away path. This one always worked.
  it('commitValue writes both part fields and never the composite', () => {
    const ctx = mountRow()

    act(() => ctx.commitValue({ firstName: 'Anita', lastName: 'Bicknell' }))

    expect(wireEntries()).toEqual([
      { fieldId: FIRST_ID, value: 'Anita' },
      { fieldId: LAST_ID, value: 'Bicknell' },
    ])
  })

  // THE regression. Enter / ArrowDown lands here, and this path wrote
  // `{ recordId, fieldId: <NAME>, value: { firstName, lastName } }` raw.
  it('commitValueAndClose writes both part fields and never the composite', () => {
    const ctx = mountRow()

    act(() => ctx.commitValueAndClose({ firstName: 'Anita', lastName: 'Bicknell' }))

    expect(wireEntries()).toEqual([
      { fieldId: FIRST_ID, value: 'Anita' },
      { fieldId: LAST_ID, value: 'Bicknell' },
    ])
    expect(h.set).toHaveLength(0)
  })

  // The two paths are only safe while they agree, so compare them directly
  // rather than trusting two separate expectations to stay in sync.
  it('both paths put the same thing on the wire', () => {
    const clickAway = mountRow()
    act(() => clickAway.commitValue({ firstName: 'Anita', lastName: 'Bicknell' }))
    const fromCommitValue = wireEntries()

    h.set.length = 0
    h.bulk.length = 0
    const enterKey = mountRow()
    act(() => enterKey.commitValueAndClose({ firstName: 'Anita', lastName: 'Bicknell' }))

    expect(wireEntries()).toEqual(fromCommitValue)
  })

  // Both parts in ONE request: each part write recomposes `displayName` by
  // reading its sibling from the DB, so two concurrent single-field writes can
  // persist an outdated composed name.
  it('sends one request per commit, carrying both parts', () => {
    const ctx = mountRow()

    act(() => ctx.commitValueAndClose({ firstName: 'Anita', lastName: 'Bicknell' }))

    expect(h.bulk).toHaveLength(1)
    expect((h.bulk[0] as BulkInput).recordIds).toEqual([RECORD_ID])
  })
})
