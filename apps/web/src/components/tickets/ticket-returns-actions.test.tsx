// apps/web/src/components/tickets/ticket-returns-actions.test.tsx
//
// The first consumer of `RecordsBlockConfig.actionsComponent`
// (plans/money/tasks/54-returns.md §4.1), so what is pinned here is the WIRING
// between the two identifiers the seam hands over and the two existing pieces
// this component reuses:
//
//  1. The create dialog is seeded with the host ticket on `return_ticket`,
//     keyed by FIELD ID and wrapped in an array. That preset is the only reason
//     the §4.2 pre-create hook fires at all - it is registered under
//     `return_ticket`, so a preset that is dropped or mis-keyed silently
//     produces a return with no ticket AND no contact.
//  2. Linking writes `return_ticket` on the PICKED return, never on the ticket.
//     The FK is on the return; a write against the host would land on the
//     read-only inverse mirror and do nothing.
//
// The two heavy UI pieces (`RecordEditorDialog`, `RecordPicker`) are stubbed to
// leaves that publish their props: both are covered by their own surfaces, and
// mounting them here would drag the record, resource and field-value stores in.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const TICKET_DEF = 'edf_ticket0000000000000000000'
const TICKET_ROW = 'ein_ticketrow000000000000000'
const TICKET_RECORD_ID = `${TICKET_DEF}:${TICKET_ROW}`
const RETURN_DEF = 'edf_return0000000000000000000'
const RETURN_TICKET_FIELD_ID = 'cf_returnticket00000000000000'
const EXISTING_RETURN = `${RETURN_DEF}:ein_returnrow000000000000000`
const NEW_RETURN_ROW = 'ein_newreturnrow000000000000'

const h = vi.hoisted(() => ({
  /** Slug -> EntityDefinition id, i.e. what `useResourceProperty(slug, 'id')` answers. */
  definitionIds: {} as Record<string, string | undefined>,
  /** The org's own CustomField id for `return_ticket`, or undefined when unresolved. */
  ticketFieldId: undefined as string | undefined,
  /** Whether the viewer may write the `return` definition. */
  canEdit: true,
  /** What the host's `ticket_returns` mirror holds. */
  mirror: [] as { recordId: string }[],
  /** Every `saveFieldValue` call, in order. */
  saves: [] as unknown[][],
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
  useSystemField: () => (h.ticketFieldId ? { id: h.ticketFieldId } : undefined),
}))

vi.mock('~/components/resources/hooks/use-system-values', () => ({
  useSystemValues: (_recordId: string, attrs: readonly string[]) => ({
    values: Object.fromEntries(attrs.map((attr) => [attr, h.mirror])),
    isLoading: false,
  }),
}))

vi.mock('~/components/resources/hooks/use-save-field-value', () => ({
  useSaveFieldValue: () => ({
    saveFieldValue: (...args: unknown[]) => h.saves.push(args),
    isPending: false,
  }),
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

vi.mock('~/components/pickers/record-picker', () => ({
  RecordPicker: ({
    children,
    onSelectSingle,
    entityDefinitionId,
    excludeIds,
  }: {
    children: React.ReactNode
    onSelectSingle?: (recordId: string) => void
    entityDefinitionId?: string
    excludeIds?: string[]
  }) => (
    <div
      data-testid='record-picker'
      data-definition={entityDefinitionId}
      data-exclude={JSON.stringify(excludeIds ?? [])}>
      {children}
      <button type='button' data-testid='pick' onClick={() => onSelectSingle?.(EXISTING_RETURN)}>
        pick
      </button>
    </div>
  ),
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
      <button type='button' data-testid='saved' onClick={() => onSaved?.(NEW_RETURN_ROW)}>
        saved
      </button>
    </div>
  ),
}))

import TicketReturnsActions from './ticket-returns-actions'

beforeEach(() => {
  h.definitionIds = { return: RETURN_DEF }
  h.ticketFieldId = RETURN_TICKET_FIELD_ID
  h.canEdit = true
  h.mirror = []
  h.saves = []
  h.invalidatedLists = []
  h.listFilteredInvalidations = 0
  h.opened = []
})

function renderActions() {
  return render(
    <TicketReturnsActions recordId={TICKET_RECORD_ID as never} entityInstanceId={TICKET_ROW} />
  )
}

describe('the seam', () => {
  it('renders both affordances from the two identifiers the block hands over', () => {
    renderActions()

    expect(screen.getByRole('button', { name: 'Create return' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link existing return' })).toBeInTheDocument()
  })

  it('renders nothing without write on the RETURN definition, not the ticket', () => {
    h.canEdit = false
    const { container } = renderActions()

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing before the return definition resolves', () => {
    h.definitionIds = {}
    const { container } = renderActions()

    expect(container).toBeEmptyDOMElement()
  })
})

describe('create', () => {
  it('seeds the host ticket onto return_ticket, keyed by field id', async () => {
    renderActions()
    await userEvent.click(screen.getByRole('button', { name: 'Create return' }))

    const dialog = screen.getByTestId('record-editor-dialog')
    expect(dialog).toHaveAttribute('data-open', 'true')
    expect(dialog).toHaveAttribute('data-definition', RETURN_DEF)
    // The array wrapper matters: `readRecordId` in `return-hooks.ts` unwraps
    // one, and `computePresetValues` produces the same shape.
    expect(JSON.parse(dialog.getAttribute('data-presets') ?? 'null')).toEqual({
      [RETURN_TICKET_FIELD_ID]: [TICKET_RECORD_ID],
    })
  })

  it('passes no presets at all rather than a preset keyed by something else', () => {
    h.ticketFieldId = undefined
    renderActions()

    // A preset keyed by the systemAttribute would be accepted by the form and
    // dropped by the create call, which is worse than an unseeded dialog.
    expect(screen.getByTestId('record-editor-dialog')).toHaveAttribute('data-presets', 'null')
  })

  it('re-queries the return lists once the record is saved', async () => {
    renderActions()
    await userEvent.click(screen.getByTestId('saved'))

    expect(h.invalidatedLists).toEqual([RETURN_DEF])
    expect(h.listFilteredInvalidations).toBe(1)
  })

  it('drills into the new return, which is where its lines get added', async () => {
    renderActions()
    await userEvent.click(screen.getByTestId('saved'))

    expect(h.opened).toEqual([`${RETURN_DEF}:${NEW_RETURN_ROW}`])
  })
})

describe('link', () => {
  it('writes return_ticket on the PICKED return, with the host as the value', async () => {
    renderActions()
    await userEvent.click(screen.getByTestId('pick'))

    expect(h.saves).toEqual([[EXISTING_RETURN, 'return_ticket', TICKET_RECORD_ID, 'RELATIONSHIP']])
  })

  it('hides returns already on this ticket, so a pick cannot be a no-op', () => {
    h.mirror = [{ recordId: EXISTING_RETURN }]
    renderActions()

    expect(screen.getByTestId('record-picker')).toHaveAttribute(
      'data-exclude',
      JSON.stringify([EXISTING_RETURN])
    )
    expect(screen.getByTestId('record-picker')).toHaveAttribute('data-definition', RETURN_DEF)
  })
})
