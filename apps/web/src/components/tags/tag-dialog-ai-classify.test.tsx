// apps/web/src/components/tags/tag-dialog-ai-classify.test.tsx
//
// Mail-classification plan 05 §6.1 — the tag dialog's AI-eligibility card.
//
// Two behaviours here are decisions, not styling, and both fail silently if a
// later refactor loses them:
//
//   C3 — `tag_description` stops being decorative copy and becomes the label's
//        definition in the classifier prompt. The field itself does not change,
//        so the RELABEL is the only place a user can learn that. A test that
//        only asserted "a textarea exists" would pass with the relabel deleted.
//
//   Q5 — an eligible tag with no description WARNS but is still saved eligible.
//        The tempting "fix" is to disable the toggle or block submit; that
//        silently drops a tag whose switch is visibly on, which is the worse
//        failure. So the assertion is that the warning appears AND the save
//        still carries `tag_ai_classify: true`.
//
// The harness mocks only the three data hooks the dialog talks to. The form,
// the ToggleCard, the relabel branch and the save-payload assembly are all the
// shipped code.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEF = 'edf_tag00000000000000000000000'
const AI_FIELD_ID = 'fld_ai_classify00000000000000'

const h = vi.hoisted(() => ({
  /** Field-value payloads handed to `saveMultipleAsync`. */
  saved: [] as Array<Array<{ fieldId: string; value: unknown; fieldType: string }>>,
  /** `values` objects handed to `record.create`. */
  created: [] as Array<Record<string, unknown>>,
  /** Whether the entity migration has run for this org. */
  hasAiField: true,
}))

vi.mock('~/components/tags/hooks/use-tag-hierarchy', () => ({
  useTagHierarchy: () => ({
    hierarchy: [],
    flatTags: [],
    tagMap: new Map(),
    fields: {
      title: { id: 'fld_title0000000000000000000', key: 'title', type: 'TEXT' },
      tag_description: {
        id: 'fld_desc00000000000000000000',
        key: 'description',
        type: 'RICH_TEXT',
      },
      tag_emoji: { id: 'fld_emoji0000000000000000000', key: 'emoji', type: 'TEXT' },
      tag_color: { id: 'fld_color0000000000000000000', key: 'color', type: 'TEXT' },
      tag_parent: { id: 'fld_parent000000000000000000', key: 'tag_parent', type: 'RELATIONSHIP' },
      ...(h.hasAiField
        ? { tag_ai_classify: { id: AI_FIELD_ID, key: 'ai_classify', type: 'CHECKBOX' } }
        : {}),
    },
    isLoading: false,
    error: null,
    entityDefinitionId: DEF,
    refresh: vi.fn(),
  }),
}))

vi.mock('~/components/resources/hooks/use-create-record', () => ({
  useCreateRecord: () => ({
    create: async ({ values }: { values: Record<string, unknown> }) => {
      h.created.push(values)
      return { instanceId: 'ein_new00000000000000000000000' }
    },
    isPending: false,
  }),
}))

vi.mock('~/components/resources/hooks/use-save-field-value', () => ({
  useSaveFieldValue: () => ({
    saveMultipleAsync: async (
      _recordId: string,
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType: string }>
    ) => {
      h.saved.push(fieldValues)
      return true
    },
    isPending: false,
  }),
}))

import { TagDialog } from '~/components/tags/ui/tag-dialog'

/**
 * The eligibility switch inside the ToggleCard header.
 *
 * Queried by ACCESSIBLE NAME, which doubles as a regression test on
 * `@auxx/ui`'s `ToggleCard`: it names its switch via `aria-labelledby` pointing
 * at the card title. This used to walk the DOM up from the title text because
 * the primitive left the switch nameless — a screen reader announced a bare
 * "switch, off". If that wiring is ever removed, this query fails here.
 *
 * A bare `getByRole('switch')` would not do either way: create mode also
 * renders the footer's "Create more" switch.
 */
function aiSwitch(): HTMLElement {
  return screen.getByRole('switch', { name: /let ai apply this tag/i })
}

/** Is the eligibility card rendered at all? */
function hasAiCard() {
  return screen.queryByText('Let AI apply this tag') !== null
}

describe('tag dialog — AI eligibility', () => {
  beforeEach(() => {
    h.saved.length = 0
    h.created.length = 0
    h.hasAiField = true
  })

  it('keeps the description a plain description while eligibility is off', () => {
    render(<TagDialog open onOpenChange={vi.fn()} />)

    // Editable, and NOT presented as an instruction to the model.
    const textarea = screen.getByPlaceholderText('Optional description')
    expect(textarea).toBeEnabled()
    expect(screen.queryByText(/when should this tag apply\?/i)).not.toBeInTheDocument()
    expect(aiSwitch()).not.toBeChecked()
  })

  it('relabels the description as the classifier instruction when switched on (C3)', async () => {
    const user = userEvent.setup()
    render(<TagDialog open onOpenChange={vi.fn()} />)

    await user.click(aiSwitch())

    // The relabel IS the feature: the field is unchanged, its meaning is not.
    expect(screen.getByText(/when should this tag apply\?/i)).toBeInTheDocument()
    expect(screen.getByText(/auxx reads this to decide/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Optional description')).not.toBeInTheDocument()
  })

  it('warns on an empty description but never blocks the toggle or the save (Q5)', async () => {
    const user = userEvent.setup()
    render(<TagDialog open onOpenChange={vi.fn()} />)

    await user.click(aiSwitch())

    expect(screen.getByText(/without a description the classifier only sees/i)).toBeInTheDocument()
    // Warn, don't disqualify — the switch stays on and stays operable.
    expect(aiSwitch()).toBeChecked()
    expect(aiSwitch()).toBeEnabled()

    await user.type(screen.getByPlaceholderText(/questions about invoices/i), 'Billing questions')
    expect(
      screen.queryByText(/without a description the classifier only sees/i)
    ).not.toBeInTheDocument()
  })

  it('creates an eligible tag even with an empty description (Q5)', async () => {
    const user = userEvent.setup()
    render(<TagDialog open onOpenChange={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Tag name'), 'Refunds')
    await user.click(aiSwitch())
    await user.click(screen.getByRole('button', { name: /create tag/i }))

    expect(h.created).toHaveLength(1)
    expect(h.created[0]).toMatchObject({ title: 'Refunds', tag_ai_classify: true })
  })

  it('saves the flag as a CHECKBOX field value under its resolved field id', async () => {
    const user = userEvent.setup()
    render(
      <TagDialog open onOpenChange={vi.fn()} recordId={`${DEF}:ein_tag00000000000000000000`} />
    )

    await user.type(screen.getByPlaceholderText('Tag name'), 'Billing')
    await user.click(aiSwitch())
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(h.saved).toHaveLength(1)
    expect(h.saved[0]).toContainEqual({
      fieldId: AI_FIELD_ID,
      value: true,
      fieldType: 'CHECKBOX',
    })
  })

  it('hides the card — and sends no flag — before the entity migration has run', async () => {
    h.hasAiField = false
    const user = userEvent.setup()
    render(
      <TagDialog open onOpenChange={vi.fn()} recordId={`${DEF}:ein_tag00000000000000000000`} />
    )

    // No dead control, and the description stays a plain description.
    expect(hasAiCard()).toBe(false)
    expect(screen.getByPlaceholderText('Optional description')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Tag name'), 'Billing')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    // The key-string fallback would fail the whole multi-save, taking the four
    // real fields down with it — so the flag must be absent, not sent bare.
    expect(h.saved).toHaveLength(1)
    expect(h.saved[0].some((v) => v.fieldId === 'tag_ai_classify')).toBe(false)
  })
})
