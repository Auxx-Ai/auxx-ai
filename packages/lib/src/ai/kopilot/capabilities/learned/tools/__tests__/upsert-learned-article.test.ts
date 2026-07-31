// packages/lib/src/ai/kopilot/capabilities/learned/tools/__tests__/upsert-learned-article.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ensureLearnedKbSpy = vi.fn()
const createArticleSpy = vi.fn()
const updateArticleDraftSpy = vi.fn()
const publishArticleSpy = vi.fn()

vi.mock('../../../../../../kb/learned/ensure-learned-kb', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    ensureLearnedKb: (...args: unknown[]) => ensureLearnedKbSpy(...args),
  }
})
vi.mock('../../../../../../kb/articles/create-article', () => ({
  createArticle: (...args: unknown[]) => createArticleSpy(...args),
}))
vi.mock('../../../../../../kb/articles/update-article', () => ({
  updateArticleDraft: (...args: unknown[]) => updateArticleDraftSpy(...args),
}))
vi.mock('../../../../../../kb/articles/publish-article', () => ({
  publishArticle: (...args: unknown[]) => publishArticleSpy(...args),
}))

import { runTool } from '../../../../../agent-framework/__test-helpers'
import type { ToolContext } from '../../../../../agent-framework/tool-context'
import { createUpsertLearnedArticleTool, withRecordChip } from '../upsert-learned-article'

const LEARNED_KB = { id: 'kb_learned', createdById: 'u_sys' }
const CATEGORY_IDS = { policies: 'art_pol', companies: 'art_com', contacts: 'art_con' }

function makeFakeDb(articleRow: Record<string, unknown> | undefined) {
  return {
    query: {
      Article: { findFirst: vi.fn().mockResolvedValue(articleRow) },
    },
  }
}

function makeTool(db: unknown) {
  return createUpsertLearnedArticleTool(() => ({ db }) as never)
}

const agentDeps = { organizationId: 'org_1', userId: 'u_1' } as ToolContext

const baseArgs = {
  title: 'Refund policy',
  description: 'How we handle refund requests.',
  markdown: '# Refund policy\n\nRefunds within 30 days.',
}

beforeEach(() => {
  vi.clearAllMocks()
  ensureLearnedKbSpy.mockResolvedValue({ kb: LEARNED_KB, categoryIds: CATEGORY_IDS })
  createArticleSpy.mockResolvedValue({ id: 'art_new' })
  updateArticleDraftSpy.mockResolvedValue({})
  publishArticleSpy.mockResolvedValue({ article: {}, version: null })
})

describe('withRecordChip', () => {
  it('appends a reference chip when the markdown lacks it', () => {
    const out = withRecordChip('Some facts.', 'def_1:inst_1')
    expect(out).toContain('@[def_1:inst_1]')
  })

  it('leaves markdown untouched when the chip is already present', () => {
    const md = 'Facts about @[def_1:inst_1] here.'
    expect(withRecordChip(md, 'def_1:inst_1')).toBe(md)
  })

  it('is a no-op without a recordId', () => {
    expect(withRecordChip('Some facts.')).toBe('Some facts.')
  })
})

describe('validateInputs', () => {
  it('requires category when creating (no articleId)', async () => {
    const tool = makeTool(makeFakeDb(undefined))
    const result = await tool.validateInputs!({ ...baseArgs }, agentDeps)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('category is required')
  })

  it('accepts an update without category and collapses article recordId form', async () => {
    const tool = makeTool(makeFakeDb(undefined))
    const result = await tool.validateInputs!(
      { ...baseArgs, articleId: 'article:art_42' },
      agentDeps
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.args.articleId).toBe('art_42')
  })

  it('rejects an unknown category on create', async () => {
    const tool = makeTool(makeFakeDb(undefined))
    const result = await tool.validateInputs!({ ...baseArgs, category: 'random' }, agentDeps)
    expect(result.ok).toBe(false)
  })
})

describe('execute — create path', () => {
  it('files the article under the category and publishes it', async () => {
    const tool = makeTool(makeFakeDb(undefined))
    const result = await runTool(tool, { ...baseArgs, category: 'policies' }, agentDeps)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ articleId: 'art_new', created: true, published: true })

    const [, kbId, input, authorId] = createArticleSpy.mock.calls[0] ?? []
    expect(kbId).toBe('kb_learned')
    expect(input).toMatchObject({
      articleKind: 'page',
      parentId: 'art_pol',
      title: 'Refund policy',
      description: 'How we handle refund requests.',
    })
    expect(input.contentJson).toBeTruthy()
    expect(authorId).toBe('u_1')
    expect(publishArticleSpy).toHaveBeenCalledWith(
      expect.anything(),
      'art_new',
      'u_1',
      [],
      'kb_learned'
    )
  })
})

describe('execute — update path', () => {
  it('rejects an article outside the learned KB', async () => {
    const tool = makeTool(
      makeFakeDb({ id: 'art_42', homeKnowledgeBaseId: 'kb_other', articleKind: 'page' })
    )
    const result = await runTool(tool, { ...baseArgs, articleId: 'art_42' }, agentDeps)
    expect(result.success).toBe(false)
    expect(result.error).toContain('not in the learned knowledge base')
    expect(updateArticleDraftSpy).not.toHaveBeenCalled()
  })

  it('rejects category articles', async () => {
    const tool = makeTool(
      makeFakeDb({ id: 'art_pol', homeKnowledgeBaseId: 'kb_learned', articleKind: 'category' })
    )
    const result = await runTool(tool, { ...baseArgs, articleId: 'art_pol' }, agentDeps)
    expect(result.success).toBe(false)
    expect(result.error).toContain('category')
  })

  it('updates the draft and publishes', async () => {
    const tool = makeTool(
      makeFakeDb({ id: 'art_42', homeKnowledgeBaseId: 'kb_learned', articleKind: 'page' })
    )
    const result = await runTool(tool, { ...baseArgs, articleId: 'art_42' }, agentDeps)

    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ articleId: 'art_42', created: false, published: true })

    const [, articleId, fields, editorId, kbId] = updateArticleDraftSpy.mock.calls[0] ?? []
    expect(articleId).toBe('art_42')
    expect(fields).toMatchObject({ title: 'Refund policy' })
    expect(fields.contentJson).toBeTruthy()
    expect(editorId).toBe('u_1')
    expect(kbId).toBe('kb_learned')
    expect(publishArticleSpy).toHaveBeenCalledWith(
      expect.anything(),
      'art_42',
      'u_1',
      [],
      'kb_learned'
    )
  })
})

describe('captureMint', () => {
  it('mints a temp id for creates and echoes the id for updates', () => {
    const tool = makeTool(makeFakeDb(undefined))
    expect(
      tool.captureMint!({ ...baseArgs, category: 'policies' }, { localIndex: 3 })
    ).toMatchObject({ articleId: 'temp_3', created: true, published: true })
    expect(
      tool.captureMint!({ ...baseArgs, articleId: 'art_42' }, { localIndex: 0 })
    ).toMatchObject({ articleId: 'art_42', created: false })
  })
})
