// packages/lib/src/ai/kopilot/capabilities/kb/tools/get-article.ts

import { KBService } from '../../../../../kb/kb-service'
import { parseArticleIdArg, parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'
import { canViewKb } from '../kb-access'
import { buildActiveArticleSnapshot } from '../snapshot-pipeline'

/**
 * Read a KB article — title, body markdown, outline, hash, recordId.
 *
 * Three lookup modes, picked by which arg is provided:
 *   1. `articleId` — bare id or `article:<id>` / `<defId>:<id>` recordId form.
 *   2. `slug` — URL-safe segment, scoped to `knowledgeBaseId` (defaults to the
 *      active KB ref).
 *   3. No args — falls back to the active article ref (`@`-mention or open
 *      editor).
 *
 * id beats slug when both are provided; a warning is attached.
 */
export function createGetArticleTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_article',
    permission: {
      target: 'instance',
      keys: ['kb'],
      level: 'read',
      enforcement: 'enforced',
      note: 'canViewKb on the article’s KB. Gates only the AGENT’s caps — no invoker clamp, no visibility/isPublished check (doc 18); safe today only because the tool is not registered on visitor chat.',
    },
    displayName: 'Get article',
    toolsetSlug: 'auxx:knowledge',
    idempotent: true,
    exampleOutput: {
      recordId: 'entdef_article:art_4Kp9wZ',
      displayName: 'How to track your order',
      secondaryInfo: 'how-to-track-your-order',
      articleId: 'art_4Kp9wZ',
      knowledgeBaseId: 'kb_2Lm8xR',
      title: 'How to track your order',
      slug: 'how-to-track-your-order',
      description: 'Step-by-step guide to finding your order tracking number and status.',
      status: 'PUBLISHED',
      hasUnpublishedChanges: false,
      contentHash: 'a1b2c3d4e5f60718',
      bodyMarkdown:
        '# How to track your order\n\nOnce your order ships, you will receive a confirmation email with a tracking number.\n\n## Finding your tracking number\n\nOpen the shipping confirmation email and click **Track package**.',
      bodyTruncated: false,
      outline: [
        { id: 'b1', type: 'heading', level: 1, preview: 'How to track your order' },
        {
          id: 'b2',
          type: 'paragraph',
          preview: 'Once your order ships, you will receive a confirm',
        },
        { id: 'b3', type: 'heading', level: 2, preview: 'Finding your tracking number' },
        {
          id: 'b4',
          type: 'paragraph',
          preview: 'Open the shipping confirmation email and click Tr',
        },
      ],
    },
    description:
      'Read a KB article — title, body markdown, outline, hash, recordId. Three lookup modes: (1) pass `articleId` (bare or `article:<id>` recordId form), (2) pass `slug` (optionally with `knowledgeBaseId`), or (3) pass nothing to load the article currently in focus (from a `@`-mention or the active KB editor). Use this first whenever the user references "this article", "the article", or `@`-mentions one.',
    parameters: {
      type: 'object',
      properties: {
        articleId: {
          type: 'string',
          description: 'Optional. Bare articleId or `article:<id>` recordId form.',
        },
        slug: {
          type: 'string',
          description: 'Optional. URL-safe slug. Not a full path — only the segment.',
        },
        knowledgeBaseId: {
          type: 'string',
          description:
            'Optional. Scopes a `slug` lookup to a specific KB. Defaults to the active KB ref.',
        },
      },
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const out: Record<string, unknown> = { ...args }
      if (args.articleId !== undefined) {
        const id = parseArticleIdArg(args.articleId, { name: 'articleId' })
        if (!id.ok) return { ok: false, error: id.error }
        out.articleId = id.value
      }
      if (args.slug !== undefined) {
        const s = parseStringArg(args.slug, { name: 'slug', max: 200 })
        if (!s.ok) return { ok: false, error: s.error }
        out.slug = s.value
      }
      const warnings: string[] = []
      if (out.articleId && out.slug) {
        warnings.push('both articleId and slug provided — using articleId, ignoring slug')
      }
      return warnings.length > 0 ? { ok: true, args: out, warnings } : { ok: true, args: out }
    },
    execute: async (args, agentDeps) => {
      const { db, sessionContext, capabilities } = getDeps()
      const explicitId = args.articleId as string | undefined
      const slug = args.slug as string | undefined
      const knowledgeBaseId =
        (args.knowledgeBaseId as string | undefined) ?? findRef(sessionContext, 'kb')?.id

      // Modes 1 + 3: id (explicit, or via the active-article ref) wins.
      const articleId = explicitId ?? (slug ? undefined : findRef(sessionContext, 'article')?.id)
      if (articleId) {
        const snapshot = await buildActiveArticleSnapshot({
          db,
          organizationId: agentDeps.organizationId,
          articleId,
        })
        if (!snapshot || !canViewKb(capabilities, snapshot.knowledgeBaseId)) {
          return { success: false, output: null, error: `article "${articleId}" not found` }
        }
        return { success: true, output: snapshot }
      }

      // Mode 2: slug lookup.
      if (slug) {
        if (!knowledgeBaseId) {
          return {
            success: false,
            output: null,
            error: 'slug lookup needs a knowledge base — pass `knowledgeBaseId` or open a KB first',
          }
        }
        const kb = new KBService(db, agentDeps.organizationId)
        try {
          const article = await kb.getArticleBySlug(slug, knowledgeBaseId)
          const snapshot = await buildActiveArticleSnapshot({
            db,
            organizationId: agentDeps.organizationId,
            articleId: article.id,
          })
          if (!snapshot || !canViewKb(capabilities, snapshot.knowledgeBaseId)) {
            return { success: false, output: null, error: `article "${slug}" not found` }
          }
          return { success: true, output: snapshot }
        } catch (error) {
          return {
            success: false,
            output: null,
            error: error instanceof Error ? error.message : 'lookup failed',
          }
        }
      }

      return {
        success: false,
        output: null,
        error:
          'no article specified — pass `articleId`, `slug`, or `@`-mention one in the composer first',
      }
    },
  }
}
