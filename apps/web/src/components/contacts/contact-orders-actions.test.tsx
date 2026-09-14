// apps/web/src/components/contacts/contact-orders-actions.test.tsx
//
// The Orders section's action on the contact drawer. What is pinned here is the
// WIRING between the two identifiers the `actionsComponent` seam hands over and
// the create dialog this component reuses:
//
//  1. The dialog is seeded with the host contact on `order_contact`, keyed by
//     FIELD ID and wrapped in an array. `order.contact` is REQUIRED, so a preset
//     that is dropped or mis-keyed opens a dialog that refuses to save on a
//     field the user already answered by opening it from this contact.
//  2. The write gate is on the ORDER definition, not the contact: a viewer who
//     may read a customer but not write orders keeps the list and loses the
//     button.
//
// `RecordEditorDialog` is stubbed to a leaf that publishes its props — it is
// covered by its own surface, and mounting it here would drag the record,
// resource and field-value stores in.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CONTACT_DEF = 'edf_contact000000000000000000'
const CONTACT_ROW = 'ein_contactrow00000000000000'
const CONTACT_RECORD_ID = `${CONTACT_DEF}:${CONTACT_ROW}`
const ORDER_DEF = 'edf_order00000000000000000000'
const ORDER_CONTACT_FIELD_ID = 'cf_ordercontact00000000000000'
const NEW_ORDER_ROW = 'ein_neworderrow0000000000000'

const h = vi.hoisted(() => ({
  /** Slug -> EntityDefinition id, i.e. what `useResourceProperty(slug, 'id')` answers. */
  definitionIds: {} as Record<string, string | undefined>,
  /** The org's own CustomField id for `order_contact`, or undefined when unresolved. */
  contactFieldId: undefined as string | undefined,
  /** Whether the viewer may write the `order` definition. */
  canEdit: true,
  /** Every record-store list invalidation, in order. */
  invalidatedLists: [] as string[],
  /** How many times the tRPC list query was invalidated. */
  listFilteredInvalidations: 0,
  /** RecordIds pushed onto the record stack, in order. */
  opened: [] as string[],
}))

vi.mock('~/components/resources', () => ({
  useResourceProperty: (slug: string) => h.definitionIds[slug],
  toRecordId: (definitionId: string, instanceId: string) => `${definitionId}:${instanceId}`,
}))

vi.mock('~/components/records/record-drill-panels', () => ({
  useOpenRecord: () => (recordId: string) => h.opened.push(recordId),
}))

vi.mock('~/components/resources/hooks/use-field', () => ({
  useSystemField: () => (h.contactFieldId ? { id: h.contactFieldId } : undefined),
}))

vi.mock('~/components/resources/store/record-store', () => ({
  getRecordStoreState: () => ({
    invalidateLists: (definitionId: string) => h.invalidatedLists.push(definitionId),
  }),
}))

vi.mock('~/providers/capabilities-provider', () => ({
  useAccess: () => ({ canEditEntity: () => h.canEdit }),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      record: {
        listFiltered: {
          invalidate: () => {
            h.listFilteredInvalidations += 1
            return Promise.resolve()
          },
        },
      },
    }),
  },
}))

vi.mock('~/components/records/record-editor-dialog', () => ({
  RecordEditorDialog: ({
    open,
    entityDefinitionId,
    presetValues,
    onSaved,
  }: {
    open: boolean
    entityDefinitionId: string
    presetValues?: Record<string, unknown>
    onSaved?: (instanceId?: string) => void
  }) => (
    <div
      data-testid='record-editor-dialog'
      data-open={String(open)}
      data-definition={entityDefinitionId}
      data-presets={JSON.stringify(presetValues ?? null)}>
      <button type='button' data-testid='saved' onClick={() => onSaved?.(NEW_ORDER_ROW)}>
        saved
      </button>
    </div>
  ),
}))

import ContactOrdersActions from './contact-orders-actions'

beforeEach(() => {
  h.definitionIds = { order: ORDER_DEF }
  h.contactFieldId = ORDER_CONTACT_FIELD_ID
  h.canEdit = true
  h.invalidatedLists = []
  h.listFilteredInvalidations = 0
  h.opened = []
})

function renderActions() {
  return render(
    <ContactOrdersActions recordId={CONTACT_RECORD_ID as never} entityInstanceId={CONTACT_ROW} />
  )
}

describe('the seam', () => {
  it('renders the create affordance from the two identifiers the block hands over', () => {
    renderActions()

    expect(screen.getByRole('button', { name: 'Create order' })).toBeInTheDocument()
  })

  it('offers no link affordance', () => {
    // `order.contact` is required, so every existing order already names a
    // buyer and linking one here would MOVE it off another customer.
    renderActions()

    expect(screen.queryByRole('button', { name: /link/i })).not.toBeInTheDocument()
  })

  it('renders nothing without write on the ORDER definition, not the contact', () => {
    h.canEdit = false
    const { container } = renderActions()

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing before the order definition resolves', () => {
    h.definitionIds = {}
    const { container } = renderActions()

    expect(container).toBeEmptyDOMElement()
  })
})

describe('create', () => {
  it('seeds the host contact onto order_contact, keyed by field id', async () => {
    renderActions()
    await userEvent.click(screen.getByRole('button', { name: 'Create order' }))

    const dialog = screen.getByTestId('record-editor-dialog')
    expect(dialog).toHaveAttribute('data-open', 'true')
    expect(dialog).toHaveAttribute('data-definition', ORDER_DEF)
    expect(JSON.parse(dialog.getAttribute('data-presets') ?? 'null')).toEqual({
      [ORDER_CONTACT_FIELD_ID]: [CONTACT_RECORD_ID],
    })
  })

  it('passes no presets at all rather than a preset keyed by something else', () => {
    h.contactFieldId = undefined
    renderActions()

    // A preset keyed by the systemAttribute would be accepted by the form and
    // dropped by the create call, which is worse than an unseeded dialog.
    expect(screen.getByTestId('record-editor-dialog')).toHaveAttribute('data-presets', 'null')
  })

  it('re-queries the order lists once the record is saved', async () => {
    renderActions()
    await userEvent.click(screen.getByTestId('saved'))

    expect(h.invalidatedLists).toEqual([ORDER_DEF])
    expect(h.listFilteredInvalidations).toBe(1)
  })

  it('drills into the new order, which is where its line items get added', async () => {
    renderActions()
    await userEvent.click(screen.getByTestId('saved'))

    expect(h.opened).toEqual([`${ORDER_DEF}:${NEW_ORDER_ROW}`])
  })
})
