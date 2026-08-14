// apps/web/src/components/records/ui/record-identity-header.test.tsx
//
// The identity block is the one place in the app where a **heading** is also a
// write affordance, so it has to answer two questions correctly at once: "is
// there anything here worth showing?" and "is this row allowed to be written?".
// Every case below is one of those two answers.
//
// The single most important one is §5 (`primaryHydrated: false` + a row
// fallback): the record row already carries a denormalized `displayName`, and
// the field value lands one tick later. If the header preferred its own empty
// state during that window, every drawer open would flash `Untitled` over a name
// the client already had.
//
// Strategy: the DATA layer is mocked (resource registry, record row, field-value
// store, the save hook), and everything that makes the decisions runs for real —
// `useRecordDisplayFields`, `toPanelField`, `PropertyProvider`,
// `getEditModeForFieldType`, and the real input/display components. That keeps
// the assertions on behaviour ("clicking opens an editor") rather than on which
// component happened to render it.

import type { RecordId } from '@auxx/lib/resources/client'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEF = 'edf_contact000000000000000000'
const ROW = 'ein_row0000000000000000000000'
const RECORD_ID = `${DEF}:${ROW}` as RecordId

const PRIMARY_ID = 'fld_primary00000000000000000'
const SECONDARY_ID = 'fld_secondary0000000000000000'

interface TestField {
  id: string
  key: string
  label: string
  type: string
  fieldType: string
  capabilities: { updatable: boolean; [k: string]: unknown }
  options?: Record<string, unknown>
}

const h = vi.hoisted(() => ({
  /** The registry's answer for this definition — drives `toPanelField`. */
  fields: [] as unknown[],
  /** Which fields the resource nominates for each slot (null = unconfigured). */
  primaryDisplayFieldId: null as string | null,
  secondaryDisplayFieldId: null as string | null,
  /** The cached record ROW: `displayName` / `secondaryDisplayValue` / `createdAt`. */
  record: null as Record<string, unknown> | null,
  isRecordLoading: false,
  /**
   * The field-value store, keyed by field id. A MISSING key is the meaningful
   * state: `undefined` means "never fetched", which is what `primaryHydrated`
   * is derived from. An explicit `null` is "fetched, and genuinely empty".
   */
  values: {} as Record<string, unknown>,
}))

// ── data layer ───────────────────────────────────────────────────────────────
vi.mock('~/components/resources', () => ({
  useResource: () => ({
    resource: {
      id: DEF,
      icon: 'circle',
      color: 'gray',
      display: {
        primaryDisplayField: h.primaryDisplayFieldId ? { id: h.primaryDisplayFieldId } : null,
        secondaryDisplayField: h.secondaryDisplayFieldId ? { id: h.secondaryDisplayFieldId } : null,
        avatarField: null,
      },
    },
  }),
  useResourceFields: () => ({ fields: h.fields }),
  useRecord: () => ({ record: h.record, isLoading: h.isRecordLoading }),
}))

// Both `useRecordDisplayFields` and `PropertyProvider` read through this, so one
// stub decides hydration for the hook AND the value the editor opens over.
vi.mock('~/components/resources/hooks/use-field-values', () => ({
  useFieldValue: (_recordId: string, fieldRef: unknown) => ({
    value: fieldRef ? h.values[String(fieldRef)] : undefined,
    isLoading: false,
  }),
}))

// The write path itself is out of scope here — this file is about whether an
// editor is OFFERED, not what it saves. (It also reaches tRPC.)
vi.mock('~/components/resources/hooks/use-save-field-value', () => ({
  useSaveFieldValue: () => ({
    saveFieldValue: vi.fn(),
    saveFieldValueAsync: vi.fn(),
    saveMultipleAsync: vi.fn(),
    isPending: false,
  }),
}))

// Avatar slot: a different decision, with its own upload plumbing.
vi.mock('~/components/resources/ui/avatar-upload-icon', () => ({ AvatarUploadIcon: () => null }))
vi.mock('~/components/resources/ui/record-icon', () => ({ RecordIcon: () => null }))

// `TextInputField` asks the table whether it is a cell (to size itself). It is
// not, and the real module drags in the table's selection/indexer contexts.
vi.mock('~/components/dynamic-table/components/inline-cell-editor', () => ({
  useIsInlineEditor: () => false,
}))

const { RecordIdentityHeader } = await import('./record-identity-header')
const { toPanelField } = await import('~/components/fields/rows/to-panel-field')
const { getEditModeForFieldType } = await import('~/components/fields/utils/edit-mode')

/** A registry field, updatable by default — the interesting cases override. */
function makeField(overrides: Partial<TestField> = {}): TestField {
  return {
    id: PRIMARY_ID,
    key: 'name',
    label: 'Name',
    type: 'string',
    fieldType: 'TEXT',
    capabilities: { updatable: true },
    options: {},
    ...overrides,
  }
}

/** A hydrated, non-empty TEXT value as the store holds it. */
function textValue(value: string) {
  return { type: 'text', value }
}

/**
 * Configure the primary slot with `field`.
 *
 * Called with ONE argument the field value is left unfetched (`undefined` in the
 * store ⇒ `primaryHydrated: false`); called with two it is hydrated to `value`,
 * where `null` is the hydrated-but-empty case.
 */
function givenPrimary(field: TestField, ...hydratedTo: [unknown] | []) {
  h.fields = [field]
  h.primaryDisplayFieldId = field.id
  if (hydratedTo.length === 1) h.values[field.id] = hydratedTo[0]
}

/**
 * The rendered marker for "this line is an edit target" — the header only emits
 * it for a value it is willing to write.
 *
 * Asserted alongside "no editor appeared" because "no editor appeared" alone is
 * not discriminating for every type: a `FILE` editor is a file picker and a
 * `JSON` editor is a code surface, so neither would answer to `role=textbox`
 * even if the denylist stopped blocking them. This marker would appear.
 */
function editTargets(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('[data-slot="record-header-value"]')]
}

beforeEach(() => {
  h.fields = []
  h.primaryDisplayFieldId = null
  h.secondaryDisplayFieldId = null
  h.isRecordLoading = false
  h.values = {}
  h.record = { id: ROW, displayName: null, secondaryDisplayValue: null, createdAt: new Date() }
})

describe('RecordIdentityHeader — what it shows', () => {
  // §5. THE no-flash guarantee. The row value is what the client already knows;
  // the placeholder is what it would otherwise invent for a value still in
  // flight. Losing this is invisible in review and obvious to every user.
  it('shows the row displayName while the field value is unhydrated, never the placeholder', async () => {
    givenPrimary(makeField()) // no entry in `h.values` ⇒ never fetched
    h.record = { ...h.record, displayName: 'Ada Lovelace' }

    render(<RecordIdentityHeader recordId={RECORD_ID} />)

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByText('Untitled')).not.toBeInTheDocument()

    // And it is inert in that window — opening an editor over a value that has
    // not landed risks committing a blank over a real name.
    await userEvent.click(screen.getByText('Ada Lovelace'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  // §6. Once the value HAS landed and is genuinely empty, the header stops
  // deferring and offers the empty state as the way in.
  it('shows the Untitled placeholder once hydrated-and-empty, and edits from it', async () => {
    givenPrimary(makeField(), null) // fetched, empty

    const { container } = render(<RecordIdentityHeader recordId={RECORD_ID} />)

    const placeholder = screen.getByText('Untitled')
    expect(placeholder).toBeInTheDocument()
    // Positive control for the marker the read-only cases assert the absence of.
    expect(editTargets(container)).toHaveLength(1)

    await userEvent.click(placeholder)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  // §4. Nothing is configured for the slot, so there is no field to write to.
  // Inventing one is how the three copies of this block drifted apart.
  it('falls back to the row displayName as static text when no primary field is configured', async () => {
    h.primaryDisplayFieldId = null
    h.record = { ...h.record, displayName: 'Unconfigured Co' }

    render(<RecordIdentityHeader recordId={RECORD_ID} />)

    const name = screen.getByText('Unconfigured Co')
    expect(name).toBeInTheDocument()

    await userEvent.click(name)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  // §8. The second line has no placeholder, so "hydrated and empty" would render
  // literally nothing. `Created …` is strictly better than a blank line.
  it('keeps the Created… line on the secondary slot when its value is hydrated-and-empty', () => {
    const secondary = makeField({ id: SECONDARY_ID, key: 'company', label: 'Company' })
    h.fields = [secondary]
    h.secondaryDisplayFieldId = SECONDARY_ID
    h.values[SECONDARY_ID] = null // fetched, empty
    h.record = {
      ...h.record,
      secondaryDisplayValue: null,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    }

    render(<RecordIdentityHeader recordId={RECORD_ID} />)

    expect(screen.getByText(/^Created /)).toBeInTheDocument()
  })
})

describe('RecordIdentityHeader — what it lets you write', () => {
  // §1. The host resolved read-only per row; the header does not second-guess it.
  it('renders the value but opens no editor when the host passes readOnly', async () => {
    givenPrimary(makeField(), textValue('Acme Corp'))

    const { container } = render(<RecordIdentityHeader recordId={RECORD_ID} readOnly />)

    const value = screen.getByText('Acme Corp')
    expect(value).toBeInTheDocument()

    await userEvent.click(value)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(editTargets(container)).toHaveLength(0)
  })

  // §2. The capability half of the same answer — the question the SERVER
  // answers. Offering an editor here means offering a write that gets rejected.
  it('opens no editor for a field the server says is not updatable, even when the surface is writable', async () => {
    const locked = makeField({ capabilities: { updatable: false } })
    givenPrimary(locked, textValue('Acme Corp'))

    // The fold that decides this, stated directly.
    expect(toPanelField(locked as never, false).readOnly).toBe(true)

    const { container } = render(<RecordIdentityHeader recordId={RECORD_ID} />)

    await userEvent.click(screen.getByText('Acme Corp'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(editTargets(container)).toHaveLength(0)
  })

  // §3. CALC is the load-bearing member of the denylist: it is NOT read-only by
  // capability (defaults to updatable, and there is no CALC input component to
  // fall into), so if the header ever dropped its own list, a computed value
  // would quietly open a plain text editor over itself.
  it('treats a CALC primary field as non-editable despite the capability saying otherwise', async () => {
    const calc = makeField({
      fieldType: 'CALC',
      capabilities: { updatable: true },
      options: { calc: { resultFieldType: 'TEXT' } },
    })
    givenPrimary(calc, { type: 'text', value: '42 orders' })

    // Nothing upstream blocked it — the header's own denylist has to.
    expect(toPanelField(calc as never, false).readOnly).toBe(false)

    const { container } = render(<RecordIdentityHeader recordId={RECORD_ID} />)

    await userEvent.click(screen.getByText('42 orders'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(editTargets(container)).toHaveLength(0)
  })

  // The rest of the denylist: panel-sized editors that do not belong in a
  // heading. Same hydrated-and-empty state as §6 above, where a TEXT field DOES
  // open an editor — the contrast is the point.
  it.each([
    'FILE',
    'JSON',
    'RICH_TEXT',
  ])('does not open a %s editor from the heading', async (fieldType) => {
    givenPrimary(makeField({ fieldType }), null)

    const { container } = render(<RecordIdentityHeader recordId={RECORD_ID} />)

    await userEvent.click(screen.getByText('Untitled'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(editTargets(container)).toHaveLength(0)
  })
})

describe('RecordIdentityHeader — multi-value secondary line (options.multi)', () => {
  // The value-list picker (cmdk + base-ui ScrollArea) needs two jsdom shims.
  class NoopIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    global.IntersectionObserver = NoopIntersectionObserver as unknown as typeof IntersectionObserver
  })

  function givenMultiEmailSecondary(emails: string[]) {
    const secondary = makeField({
      id: SECONDARY_ID,
      key: 'primaryEmail',
      label: 'Email',
      fieldType: 'EMAIL',
      options: { multi: true },
    })
    h.fields = [secondary]
    h.secondaryDisplayFieldId = SECONDARY_ID
    h.values[SECONDARY_ID] = emails.map((value, i) => ({ id: `fv-${i}`, type: 'text', value }))
  }

  // The heading compresses a multi-value field to primary + `+N` — the full
  // list is the panel's job, and a three-chip list does not belong in a
  // text-xs secondary line.
  it('renders the primary value plus a +N badge, never the full list', () => {
    givenMultiEmailSecondary(['a@x.com', 'b@x.com', 'c@x.com'])

    render(<RecordIdentityHeader recordId={RECORD_ID} />)

    expect(screen.getByText('a@x.com')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.queryByText('b@x.com')).not.toBeInTheDocument()
    expect(screen.queryByText('c@x.com')).not.toBeInTheDocument()
  })

  // Multi leaves inline edit: the answer that routes the heading (and table
  // cells) to the popover picker instead of a single-line input.
  it('multi EMAIL answers popover edit mode while scalar EMAIL stays inline', () => {
    expect(getEditModeForFieldType('EMAIL')).toBe('inline')
    expect(getEditModeForFieldType('EMAIL', { multi: true })).toBe('popover')
    expect(getEditModeForFieldType('URL', { multi: true })).toBe('popover')
    expect(getEditModeForFieldType('PHONE_INTL', { multi: true })).toBe('popover')
  })

  it('editing routes to the popover value-list picker, outside the heading', async () => {
    givenMultiEmailSecondary(['a@x.com', 'b@x.com'])

    const { container } = render(<RecordIdentityHeader recordId={RECORD_ID} />)

    await userEvent.click(screen.getByText('a@x.com'))

    // The picker's combined filter/entry input mounts in the popover overlay —
    // not inline inside the heading.
    const pickerInput = screen.getByPlaceholderText('Search or add email...')
    expect(container.contains(pickerInput)).toBe(false)
  })
})

describe('RecordIdentityHeader — which editor the field type calls for', () => {
  // §7. Text-like types replace the value in the heading itself; everything else
  // gets the shared field popover, which is why a NAME primary field lands on
  // the first/last name editor rather than a single-line rename.
  it('edits a TEXT primary field in place, inside the heading', async () => {
    expect(getEditModeForFieldType('TEXT')).toBe('inline')
    givenPrimary(makeField(), textValue('Acme Corp'))

    const { container } = render(<RecordIdentityHeader recordId={RECORD_ID} />)

    await userEvent.click(screen.getByText('Acme Corp'))

    const editor = screen.getByRole('textbox')
    expect(container.contains(editor)).toBe(true)
  })

  it('edits a NAME primary field in an overlay outside the heading, as first/last name', async () => {
    expect(getEditModeForFieldType('NAME')).toBe('popover')
    givenPrimary(
      makeField({
        fieldType: 'NAME',
        options: { name: { firstNameFieldId: 'fld_first', lastNameFieldId: 'fld_last' } },
      }),
      null
    )

    const { container } = render(<RecordIdentityHeader recordId={RECORD_ID} />)

    await userEvent.click(screen.getByText('Untitled'))

    const firstName = screen.getByLabelText('First Name')
    expect(screen.getByLabelText('Last Name')).toBeInTheDocument()
    expect(container.contains(firstName)).toBe(false)
  })
})
