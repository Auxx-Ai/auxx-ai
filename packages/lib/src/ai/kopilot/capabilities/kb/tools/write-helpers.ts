// packages/lib/src/ai/kopilot/capabilities/kb/tools/write-helpers.ts

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { type ArticlePatch, applyPatch, PatchError } from '../../../../../kb/blocks'
import { KBService } from '../../../../../kb/kb-service'
import {
  captureKopilotSnapshot,
  type KopilotPreTurnSnapshot,
  readKopilotSnapshot,
} from '../../../../../kb/kopilot-snapshot'
import { createBlockIdAllocator, reassignIds } from '../../../../../kb/markdown/block-id'
import { computeArticleJsonHash } from '../../../../../kb/markdown/hash'
import { mdToBlocks } from '../../../../../kb/markdown/md-to-blocks'
import type { ArticleNodeJSON, PanelJSON } from '../../../../../kb/markdown/types'
import { publishKbArticleEvent } from '../../../../../kb/realtime'
import type { AgentDeps, AgentToolResult } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { ToolDeps } from '../../types'
import { planMarkdownReplace } from './replace-plan'

const logger = createScopedLogger('kb-write-helpers')

/**
 * Optional concurrency guard shared by every KB write tool. The agent passes
 * back the `postHash` it received from its previous edit on the same article;
 * `runBlockCrudOp` rejects the op if the draft changed since (a concurrent
 * write), so the agent re-reads instead of patching stale content. Omit on the
 * first edit of a turn.
 */
export const EXPECTED_HASH_PARAM = {
  type: 'string',
  description:
    'Optional concurrency guard. Pass the `postHash` returned by your previous edit to this article; if the article changed since then, the edit is rejected so you can re-read (get_article / get_article_section) and retry. Omit on your first edit of a turn.',
} as const

/**
 * Parse an agent-supplied markdown string into article nodes. The write
 * tools speak markdown only — `mdToBlocks` already stamps a fresh id on
 * every parsed block/panel, and containers (table/tabs/accordion) flow
 * through as top-level nodes. `applyPatch` rejects containers at nested
 * anchors with a clear error.
 */
export function expandMarkdown(markdown: string): ArticleNodeJSON[] {
  return mdToBlocks(markdown)
}

/**
 * Run `replace_block` from a markdown string. Expands the markdown, plans
 * the patch sequence (see {@link planMarkdownReplace}), and applies each op
 * in order — threading the CAS hash so the final `postHash` reflects the
 * fully-spliced result and the agent can chain its next edit.
 */
export async function runMarkdownReplace(args: {
  agentDeps: AgentDeps
  toolDeps: ToolDeps
  blockId: string
  markdown: string
  expectedHash?: string
}): Promise<
  | { ok: true; ctx: KopilotWriteContext; effect: { blockIds: string[] } }
  | { ok: false; error: string }
> {
  const { agentDeps, toolDeps, blockId, markdown, expectedHash } = args
  // Empty/whitespace markdown removes the block — short-circuit to zero nodes
  // before parsing, since `mdToBlocks('')` yields a stray empty paragraph.
  const nodes = markdown.trim() === '' ? [] : expandMarkdown(markdown)
  const patches = planMarkdownReplace(blockId, nodes)
  return runPatchSequence({ agentDeps, toolDeps, patches, expectedHash })
}

/**
 * Apply a sequence of patches as one logical edit. Each op chains the prior
 * op's `postHash` as its CAS `expectedHash`, so a concurrent write between
 * ops is still caught. Returns the last op's context with the union of all
 * affected block ids. Bails on the first failure.
 */
async function runPatchSequence(args: {
  agentDeps: AgentDeps
  toolDeps: ToolDeps
  patches: ArticlePatch[]
  expectedHash?: string
}): Promise<
  | { ok: true; ctx: KopilotWriteContext; effect: { blockIds: string[] } }
  | { ok: false; error: string }
> {
  const { agentDeps, toolDeps, patches } = args
  let expectedHash = args.expectedHash
  let ctx: KopilotWriteContext | undefined
  const blockIds = new Set<string>()
  let opIndex = 0
  for (const patch of patches) {
    const res = await runBlockCrudOp({ agentDeps, toolDeps, patch, opIndex, expectedHash })
    if (!res.ok) return res
    expectedHash = res.ctx.postHash
    ctx = res.ctx
    for (const id of res.effect.blockIds) blockIds.add(id)
    opIndex++
  }
  if (!ctx) return { ok: false, error: 'no patches to apply' }
  return { ok: true, ctx, effect: { blockIds: [...blockIds] } }
}

export interface KopilotWriteContext {
  articleId: string
  knowledgeBaseId: string
  preHash: string
  postHash: string
}

/**
 * Run a single block-CRUD op against the active article. Handles:
 *
 *  1. Read draft + current hash.
 *  2. CAS the pre-turn snapshot in Redis on the FIRST write of a turn
 *     (subsequent ops on the same turn skip — same snapshot stays).
 *  3. Acquire the article lock + publish lock event on first write.
 *  4. Apply the patch (pure splice).
 *  5. Persist the updated draft via KBService (with snapshot-clear bypass).
 *  6. Publish the kb-article-patch event.
 *  7. Return the new content hash so the agent can validate.
 *
 * Hash discipline (CAS): when the caller passes `expectedHash` (the
 * `postHash` the agent last saw for this article), we compare it against the
 * live draft hash BEFORE applying. On mismatch the op is rejected fail-soft
 * with a re-read instruction — a concurrent write won't get clobbered. The
 * lock still guards in-turn races; this adds cross-session safety. Omitting
 * `expectedHash` preserves the old unconditional behavior (e.g. the first
 * write of a turn, which has no prior hash to chain from).
 */
export async function runBlockCrudOp(args: {
  agentDeps: AgentDeps
  toolDeps: ToolDeps
  patch: ArticlePatch
  opIndex: number
  expectedHash?: string
}): Promise<
  | { ok: true; ctx: KopilotWriteContext; effect: { blockIds: string[] } }
  | { ok: false; error: string }
> {
  const { agentDeps, toolDeps, patch, opIndex, expectedHash } = args
  const articleId = findRef(toolDeps.sessionContext, 'article')?.id
  if (!articleId) {
    return { ok: false, error: 'no active article' }
  }
  const turnId = agentDeps.turnId
  if (!turnId) {
    return { ok: false, error: 'no turnId on agent deps — cannot scope kopilot writes' }
  }

  const article = await toolDeps.db.query.Article.findFirst({
    where: and(
      eq(schema.Article.id, articleId),
      eq(schema.Article.organizationId, agentDeps.organizationId)
    ),
    with: { draftRevision: true },
  })
  if (!article || !article.draftRevision) {
    return { ok: false, error: 'article not found' }
  }
  const knowledgeBaseId = article.homeKnowledgeBaseId
  const draftJson = (article.draftRevision.contentJson as ArticleNodeJSON[] | null) ?? []
  const preHash = computeArticleJsonHash(draftJson)

  // Insert blocks arrive with sequential ids minted by `mdToBlocks` against a
  // fresh `b1…` counter, so they can collide with ids already in the draft.
  // Re-stamp them above the draft's current max BEFORE applying, so the
  // persisted content and the patch we publish to editors carry the same
  // final ids (no divergence, and the CAS hash we return stays authoritative).
  const effectivePatch: ArticlePatch =
    patch.op === 'insert'
      ? { ...patch, blocks: reassignIds(patch.blocks, createBlockIdAllocator(draftJson)) }
      : patch

  // CAS precondition: if the agent told us the hash it last observed and the
  // draft has since changed (a concurrent edit), reject before capturing a
  // snapshot, locking, or applying — so we never patch stale content.
  if (expectedHash && expectedHash !== preHash) {
    return {
      ok: false,
      error:
        `stale_content: the article changed since your last edit (you expected hash ${expectedHash}, current is ${preHash}). ` +
        'Re-read it with get_article or get_article_section, then retry your edit against the fresh content.',
    }
  }

  // First-write-of-turn: capture snapshot + emit lock event. We use the
  // existing snapshot key as a soft idempotency guard — if a snapshot
  // for THIS turnId already exists, this isn't actually the first write.
  const existing = await readKopilotSnapshot(articleId, turnId)
  if (!existing) {
    const snapshot: KopilotPreTurnSnapshot = {
      turnId,
      sessionId: agentDeps.sessionId,
      contentJson: draftJson,
      contentHash: preHash,
      capturedAt: Date.now(),
    }
    await captureKopilotSnapshot(articleId, snapshot)
    void publishKbArticleEvent(articleId, {
      type: 'kb-article-lock',
      articleId,
      locked: true,
      by: 'kopilot',
      turnId,
    })
  }

  // Apply the patch.
  let nextContent: ArticleNodeJSON[]
  let effectIds: string[]
  try {
    const result = applyPatch(draftJson, effectivePatch)
    nextContent = result.content
    effectIds = result.effect.blockIds
  } catch (error) {
    if (error instanceof PatchError) {
      return { ok: false, error: `${error.code}: ${error.message}` }
    }
    throw error
  }

  // Persist via KBService. We pass through `bypassSnapshotClear` so the
  // agent's own writes don't wipe the pre-turn snapshot we just captured.
  const kb = new KBService(toolDeps.db, agentDeps.organizationId)
  await kb.updateArticleDraft(
    articleId,
    { contentJson: nextContent as unknown as ArticleNodeJSON[] },
    agentDeps.userId,
    knowledgeBaseId,
    { bypassSnapshotClear: true, suppressResyncEvent: true }
  )

  const postHash = computeArticleJsonHash(nextContent)

  // Publish patch event so subscribed editors apply incrementally
  // (or fall back to invalidate via the hook stub).
  void publishKbArticleEvent(articleId, {
    type: 'kb-article-patch',
    articleId,
    patch: effectivePatch,
    preHash,
    postHash,
    cause: { kind: 'kopilot', turnId, opIndex },
  })

  logger.debug('Kopilot write op committed', {
    articleId,
    op: patch.op,
    turnId,
    opIndex,
    effectIds,
  })

  return {
    ok: true,
    ctx: { articleId, knowledgeBaseId, preHash, postHash },
    effect: { blockIds: effectIds },
  }
}

/**
 * Wrap a block-CRUD op result for the agent. Carries enough info for
 * the model to chain ops + emit `auxx:kb-block` fences.
 */
export function buildOpToolResult(
  patchOp: ArticlePatch['op'],
  result:
    | { ok: true; ctx: KopilotWriteContext; effect: { blockIds: string[] } }
    | { ok: false; error: string }
): AgentToolResult {
  if (!result.ok) {
    return { success: false, output: null, error: result.error }
  }
  return {
    success: true,
    output: {
      ok: true,
      op: patchOp,
      articleId: result.ctx.articleId,
      preHash: result.ctx.preHash,
      postHash: result.ctx.postHash,
      affectedBlockIds: result.effect.blockIds,
    },
  }
}

/**
 * Called by the SSE route after the engine completes its turn. If a
 * pre-turn snapshot is present for `articleId`, that means at least one
 * write tool fired and the lock is held; release it now. On failure
 * mode the caller has already attempted a rollback via
 * `revertKopilotKbTurn`.
 */
export async function finalizeKopilotKbTurn(args: { articleId: string }): Promise<void> {
  const snapshot = await readKopilotSnapshot(args.articleId)
  if (!snapshot) return
  void publishKbArticleEvent(args.articleId, {
    type: 'kb-article-lock',
    articleId: args.articleId,
    locked: false,
    by: 'kopilot',
    turnId: snapshot.turnId,
    // Snapshot is kept (not cleared) so the user can review/undo this turn.
    reviewable: true,
  })
}

/**
 * Restore the article to its pre-turn snapshot. Used by:
 *  - the `revertKopilotTurn` tRPC mutation when the user clicks Undo
 *  - the SSE route's failure path (auto-revert before lock release)
 *
 * Verifies the snapshot's `turnId` matches the requested `expectedTurnId`
 * (so a stale Undo button doesn't clobber a newer turn's edits). On
 * success, clears the snapshot, persists the rollback via
 * KBService.updateArticleDraft, and emits a `kb-article-resync` so the
 * editor swaps back.
 */
export async function revertKopilotKbTurn(args: {
  db: import('@auxx/database').Database
  organizationId: string
  userId: string
  articleId: string
  expectedTurnId?: string
}): Promise<
  | { ok: true; reverted: true }
  | { ok: false; reason: 'no_snapshot' | 'turn_mismatch' | 'persist_failed' }
> {
  const { db, organizationId, userId, articleId, expectedTurnId } = args
  const { clearKopilotSnapshot } = await import('../../../../../kb/kopilot-snapshot')
  const { KBService } = await import('../../../../../kb/kb-service')
  const { computeArticleJsonHash } = await import('../../../../../kb/markdown/hash')

  const snapshot = await readKopilotSnapshot(articleId, expectedTurnId)
  if (!snapshot) {
    return { ok: false, reason: expectedTurnId ? 'turn_mismatch' : 'no_snapshot' }
  }
  try {
    const kb = new KBService(db, organizationId)
    await kb.updateArticleDraft(
      articleId,
      { contentJson: snapshot.contentJson as unknown as ArticleNodeJSON[] },
      userId,
      undefined,
      // Clear our own snapshot AFTER the persist (we'll do that below
      // explicitly); suppress the resync this method emits because we
      // emit our own with the `revert` cause.
      { bypassSnapshotClear: true, suppressResyncEvent: true }
    )
    void publishKbArticleEvent(articleId, {
      type: 'kb-article-resync',
      articleId,
      contentJson: snapshot.contentJson as unknown as ArticleNodeJSON[],
      contentHash: computeArticleJsonHash(snapshot.contentJson as unknown as ArticleNodeJSON[]),
      cause: { kind: 'revert', turnId: snapshot.turnId },
    })
    void publishKbArticleEvent(articleId, {
      type: 'kb-article-lock',
      articleId,
      locked: false,
      by: 'kopilot',
      turnId: snapshot.turnId,
    })
    await clearKopilotSnapshot(articleId)
    return { ok: true, reverted: true }
  } catch (error) {
    logger.error('Kopilot turn revert failed', {
      articleId,
      turnId: snapshot.turnId,
      error: (error as Error).message,
    })
    return { ok: false, reason: 'persist_failed' }
  }
}

// Re-export PanelJSON so tools that build container payloads have it handy.
export type { PanelJSON }
