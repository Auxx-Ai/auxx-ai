// apps/web/src/components/tags/tag-dialog-template-category.test.tsx
//
// Mail-categories plan 06 §4 + §7.1 — the tag dialog's treatment of a SEEDED
// category (an ordinary tag carrying `tag_template_key`).
//
// Three things here are decisions rather than styling, and each one fails
// silently if a later refactor loses it:
//
//   D4 vs D5 — a seeded category is FULLY EDITABLE. The obvious "cleanup" is to
//        fold `templateKey` into `isReadOnly` beside `isSystemTag`; that freezes
//        `tag_description`, which is the classifier's instruction and the one
//        field this whole feature exists to make the customer's. So the
//        assertion is that every input stays enabled and the save button is
//        still there.
//
//   §4.1 — the shipped default is the PLACEHOLDER, never the value. A cleared
//        description must stay cleared through a save; showing the default as
//        the value would silently re-write text the user deleted on purpose.
//
//   §3.2 — `rejectDeleteIfTemplateTag` 403s any delete of a marked tag, so the
//        UI must state that rather than offer an action that will fail. That
//        statement keys off the MARKER, not off this build's defaults map — a
//        category seeded by a newer deploy resolves to no known default and is
//        still undeletable.
//
// Plus a DRIFT TEST: `category-defaults.ts` is a hand-copy of the seed
// definitions (the seed module imports `@auxx/database`, so the client cannot
// import it — CLAUDE.md "Client vs Server Imports"). A copy that drifts makes
// "Reset to default" write something a fresh seed would not, so the test reads
// the seed source and asserts every string still appears in it verbatim.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getTagTemplateDefault,
  TAG_TEMPLATE_DEFAULTS,
  TEMPLATE_TAG_UNDELETABLE_REASON,
} from '~/components/tags/category-defaults'
import type { TagNode } from '~/components/tags/types'

const DEF = 'edf_tag00000000000000000000000'
const INSTANCE = 'ein_tag00000000000000000000000'
const RECORD_ID = `${DEF}:${INSTANCE}` as const
const AI_FIELD_ID = 'fld_ai_classify00000000000000'
const DESCRIPTION_FIELD_ID = 'fld_desc00000000000000000000'

const BILLING = TAG_TEMPLATE_DEFAULTS['category:billing']!

/** A tag row as `useTagHierarchy` would shape it. */
function tagNode(overrides: Partial<TagNode> = {}): TagNode {
  return {
    id: INSTANCE,
    recordId: RECORD_ID,
    title: 'Billing',
    tag_description: BILLING.description,
    tag_emoji: '💳',
    tag_color: 'green',
    parentId: null,
    isSystemTag: false,
    aiClassify: true,
    templateKey: BILLING.templateKey,
    scope: 'thread',
    children: [],
    ...overrides,
  }
}

const h = vi.hoisted(() => ({
  /** The tag under edit, or null for "not found". */
  tag: null as TagNode | null,
  /** Field-value payloads handed to `saveMultipleAsync`. */
  saved: [] as Array<Array<{ fieldId: string; value: unknown; fieldType: string }>>,
}))

vi.mock('~/components/tags/hooks/use-tag-hierarchy', () => ({
  useTagHierarchy: () => ({
    hierarchy: [],
    flatTags: [],
    tagMap: new Map<string, TagNode>(h.tag ? [[h.tag.id, h.tag]] : []),
    fields: {
      title: { id: 'fld_title0000000000000000000', key: 'title', type: 'TEXT' },
      tag_description: { id: DESCRIPTION_FIELD_ID, key: 'description', type: 'RICH_TEXT' },
      tag_emoji: { id: 'fld_emoji0000000000000000000', key: 'emoji', type: 'TEXT' },
      tag_color: { id: 'fld_color0000000000000000000', key: 'color', type: 'TEXT' },
      tag_parent: { id: 'fld_parent000000000000000000', key: 'tag_parent', type: 'RELATIONSHIP' },
      tag_ai_classify: { id: AI_FIELD_ID, key: 'ai_classify', type: 'CHECKBOX' },
    },
    isLoading: false,
    error: null,
    entityDefinitionId: DEF,
    refresh: vi.fn(),
  }),
}))

vi.mock('~/components/resources/hooks/use-create-record', () => ({
  useCreateRecord: () => ({ create: vi.fn(), isPending: false }),
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

/** The description textarea, wherever the eligibility card has mounted it. */
function descriptionField(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: /when should this tag apply\?/i })
}

function resetButton() {
  return screen.queryByRole('button', { name: /reset to default/i })
}

/** The `tag_description` entry of the most recent save. */
function savedDescription() {
  return h.saved.at(-1)?.find((v) => v.fieldId === DESCRIPTION_FIELD_ID)
}

function openDialog() {
  render(<TagDialog open onOpenChange={vi.fn()} recordId={RECORD_ID} />)
}

describe('tag dialog — seeded mail category', () => {
  beforeEach(() => {
    h.tag = tagNode()
    h.saved.length = 0
  })

  it('stays fully editable — this is not the system-tag treatment (D4 vs D5)', () => {
    openDialog()

    // The whole point of `tag_template_key` being a provenance marker rather
    // than a lock. If `isReadOnly` ever grows a `|| templateKey` this fails.
    expect(screen.getByPlaceholderText('Tag name')).toBeEnabled()
    expect(descriptionField()).toBeEnabled()
    expect(screen.getByRole('switch', { name: /let ai apply this tag/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()

    // …and none of the system-tag copy, which says the opposite.
    expect(screen.queryByText(/it cannot be modified or deleted/i)).not.toBeInTheDocument()
    expect(screen.queryByText('System Tag')).not.toBeInTheDocument()
  })

  it('states that the category cannot be deleted (§3.2)', () => {
    openDialog()

    // `rejectDeleteIfTemplateTag` 403s the delete, so no surface may imply one
    // is available.
    expect(screen.getByText(new RegExp(TEMPLATE_TAG_UNDELETABLE_REASON, 'i'))).toBeInTheDocument()
  })

  it('says nothing about built-in categories for an ordinary tag', () => {
    h.tag = tagNode({ templateKey: null, tag_description: 'Ours.' })
    openDialog()

    expect(screen.queryByText(/built-in mail category/i)).not.toBeInTheDocument()
    expect(resetButton()).toBeNull()
  })

  it('shows the shipped default as the PLACEHOLDER once the description is cleared (§4.1)', () => {
    h.tag = tagNode({ tag_description: '' })
    openDialog()

    const field = descriptionField()
    // Placeholder, never value: a cleared description stays cleared. Showing it
    // as the value would silently rewrite text the user deleted on purpose.
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', BILLING.description)
  })

  it('keeps a cleared description cleared through a save', async () => {
    const user = userEvent.setup()
    h.tag = tagNode({ tag_description: '' })
    openDialog()

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(savedDescription()).toMatchObject({ value: null })
  })

  it('offers no reset while the description is still the shipped default', () => {
    openDialog()

    expect(resetButton()).toBeNull()
  })

  it('offers "Reset to default" once the description has drifted (§4.2)', async () => {
    const user = userEvent.setup()
    h.tag = tagNode({ tag_description: 'Only invoices, nothing else.' })
    openDialog()

    const button = resetButton()
    expect(button).not.toBeNull()

    await user.click(button!)

    // Resolved through `tag_template_key`, which is the only reason we know
    // WHICH default applies to a tag the user may have renamed.
    expect(descriptionField()).toHaveValue(BILLING.description)
    // …and the affordance retires itself the moment the text matches again,
    // without waiting for a save.
    expect(resetButton()).toBeNull()
  })

  it('writes the restored default only when the user saves', async () => {
    const user = userEvent.setup()
    h.tag = tagNode({ tag_description: 'Only invoices, nothing else.' })
    openDialog()

    await user.click(resetButton()!)
    expect(h.saved).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(savedDescription()).toMatchObject({ value: BILLING.description })
  })

  it('offers a reset on a cleared description too — the empty case is drift (§4.1)', () => {
    h.tag = tagNode({ tag_description: '' })
    openDialog()

    expect(resetButton()).not.toBeNull()
  })

  it('resets the description even after the category has been renamed', async () => {
    const user = userEvent.setup()
    // The marker survives a rename; the title does not identify the default.
    h.tag = tagNode({ title: 'Invoices & payments', tag_description: 'drifted' })
    openDialog()

    await user.click(resetButton()!)

    expect(descriptionField()).toHaveValue(BILLING.description)
    // The rename is the user's and is never reverted by a description reset.
    expect(screen.getByPlaceholderText('Tag name')).toHaveValue('Invoices & payments')
  })

  it('degrades to "undeletable, no default" for a key this build does not know', () => {
    // An org seeded by a newer deploy. The delete guard reads the MARKER, so the
    // statement must survive even though no shipped text resolves.
    h.tag = tagNode({ templateKey: 'category:from-the-future', tag_description: 'whatever' })
    openDialog()

    expect(screen.getByText(new RegExp(TEMPLATE_TAG_UNDELETABLE_REASON, 'i'))).toBeInTheDocument()
    expect(resetButton()).toBeNull()
    expect(descriptionField()).toBeEnabled()
    expect(getTagTemplateDefault('category:from-the-future')).toBeUndefined()
  })
})

describe('category-defaults drift', () => {
  // Resolved from this file rather than from cwd so the test does not depend on
  // which package vitest was invoked in.
  const seedSource = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../packages/lib/src/seed/ai-category-tags.ts'
    ),
    'utf8'
  )

  it.each(
    Object.values(TAG_TEMPLATE_DEFAULTS)
  )('keeps $templateKey byte-identical to the seed definition', (entry) => {
    // Verbatim, because the descriptions are PROMPT TEXT (05 C3) and "Reset to
    // default" must write exactly what a fresh seed would have written.
    expect(seedSource).toContain(`'${entry.templateKey}'`)
    expect(seedSource).toContain(`'${entry.title}'`)
    expect(seedSource).toContain(entry.description)
  })
})
