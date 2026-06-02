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
import { computeArticleJsonHash } from '../../../../../kb/markdown/hash'
import { mdToBlocks } from '../../../../../kb/markdown/md-to-blocks'
import { stampBlockIds } from '../../../../../kb/markdown/stamp-ids'
import type { ArticleNodeJSON, BlockJSON, PanelJSON } from '../../../../../kb/markdown/types'
import { publishKbArticleEvent } from '../../../../../kb/realtime'
import type { AgentDeps, AgentToolResult } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { ToolDeps } from '../../types'

const logger = createScopedLogger('kb-write-helpers')

/**
 * Block-input payload accepted by write tools — agents pass either a
 * markdown string (server expands to one or more nodes) or a structured
 * node JSON. `kind:'block'` accepts any top-level article node:
 * `type:'block'` (leaf), `type:'table'`, `type:'tabs'`, or `type:'accordion'`.
 * Containers can only be inserted at top-level anchors (panels/cells
 * hold leaf blocks only).
 */
export type BlockInput =
  | { kind: 'markdown'; markdown: string }
  | { kind: 'block'; block: ArticleNodeJSON }

const ALLOWED_NODE_TYPES = new Set(['block', 'table', 'tabs', 'accordion'])

/**
 * Expand a list of BlockInput into a flat ArticleNodeJSON[] with ids
 * stamped. Used by insert / replace tools that accept the mixed payload
 * shape. Containers (table/tabs/accordion) flow through as-is so they
 * can be inserted at top-level anchors; `applyPatch` rejects them at
 * nested anchors with a clear error.
 */
export function expandBlockInputs(inputs: BlockInput[]): ArticleNodeJSON[] {
  const out: ArticleNodeJSON[] = []
  for (const input of inputs) {
    if (input.kind === 'markdown') {
      const nodes = mdToBlocks(input.markdown)
      for (const node of nodes) out.push(node)
      continue
    }
    // Stamp ids on agent-supplied node (recurses into panels / table cells).
    const { content } = stampBlockIds([input.block])
    if (content[0]) out.push(content[0])
  }
  return out
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
 * Hash discipline: we don't enforce a `turnExpectedHash` precondition
 * here yet (the lock prevents user races; future work adds it for
 * cross-session safety). Manual edits clear the snapshot and the next
 * write fails-soft via the apply-patch error path.
 */
export async function runBlockCrudOp(args: {
  agentDeps: AgentDeps
  toolDeps: ToolDeps
  patch: ArticlePatch
  opIndex: number
}): Promise<
  | { ok: true; ctx: KopilotWriteContext; effect: { blockIds: string[] } }
  | { ok: false; error: string }
> {
  const { agentDeps, toolDeps, patch, opIndex } = args
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
  const knowledgeBaseId = article.knowledgeBaseId
  const draftJson = (article.draftRevision.contentJson as ArticleNodeJSON[] | null) ?? []
  const preHash = computeArticleJsonHash(draftJson)

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
    const result = applyPatch(draftJson, patch)
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
    patch,
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
 * Type guard — ensure agent-supplied input matches BlockInput shape.
 * Returns a normalized array or an error string.
 */
export function parseBlockInputs(
  raw: unknown,
  fieldName: string
):
  | {
      ok: true
      value: BlockInput[]
    }
  | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: `${fieldName} must be an array` }
  }
  const out: BlockInput[] = []
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i]
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: `${fieldName}[${i}] must be an object` }
    }
    const kind = (entry as { kind?: unknown }).kind
    if (kind === 'markdown') {
      const md = (entry as { markdown?: unknown }).markdown
      if (typeof md !== 'string' || md.length === 0) {
        return { ok: false, error: `${fieldName}[${i}].markdown must be a non-empty string` }
      }
      out.push({ kind: 'markdown', markdown: md })
      continue
    }
    if (kind === 'block') {
      const block = (entry as { block?: unknown }).block
      const nodeType = (block as { type?: unknown } | null | undefined)?.type
      if (
        !block ||
        typeof block !== 'object' ||
        typeof nodeType !== 'string' ||
        !ALLOWED_NODE_TYPES.has(nodeType)
      ) {
        return {
          ok: false,
          error: `${fieldName}[${i}].block must have type ∈ {'block','table','tabs','accordion'}`,
        }
      }
      out.push({ kind: 'block', block: block as ArticleNodeJSON })
      continue
    }
    return { ok: false, error: `${fieldName}[${i}].kind must be 'markdown' or 'block'` }
  }
  return { ok: true, value: out }
}

/**
 * For tools where the client passes a full BlockJSON (replace), validate
 * shape and stamp an id if missing.
 */
export function parseSingleBlock(
  raw: unknown,
  fieldName: string
):
  | {
      ok: true
      value: BlockJSON
    }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: `${fieldName} must be an object` }
  }
  if ((raw as { type?: unknown }).type !== 'block') {
    return { ok: false, error: `${fieldName}.type must be 'block'` }
  }
  const { content } = stampBlockIds([raw as BlockJSON])
  if (content[0]?.type !== 'block') {
    return { ok: false, error: `${fieldName} did not normalize to a block` }
  }
  return { ok: true, value: content[0] as BlockJSON }
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
