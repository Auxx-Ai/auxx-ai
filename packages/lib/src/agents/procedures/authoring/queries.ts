// packages/lib/src/agents/procedures/authoring/queries.ts

import { createHash } from 'node:crypto'
import { database, schema } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { stableStringify, type TiptapDoc } from '../nodes'
import {
  attachProcedureTx,
  createProcedureTx,
  type ProcedureDefaults,
  updateProcedure,
  writeDraftDocTx,
} from '../queries'

/**
 * Authoring-specific data access for the Kopilot procedure tools (Phase 7 §4.0).
 * These enforce the **access invariant**: every read/write goes through an
 * AgentProcedure link to the SESSION agent, so a guessed org procedure id that
 * isn't attached to this agent is rejected. Transactions keep create+attach+draft
 * atomic (no orphans) and make the draft write a compare-and-set (lost-update
 * guard). All return `neverthrow` Results, mirroring `../queries`.
 */

/**
 * SHA-256 of a draft doc — the content hash used for the tools' compare-and-set.
 * Matches `compileProcedure().contentHash`. Serializes with {@link stableStringify}
 * (sorted keys) so the hash is stable across the `jsonb` round-trip: a write
 * returns the hash of the in-memory doc, and the next read recomputes it from the
 * key-reordered jsonb column — they must agree or the model gets a false stale.
 */
export function hashDoc(doc: TiptapDoc): string {
  return createHash('sha256').update(stableStringify(doc), 'utf8').digest('hex')
}

/**
 * Emit the `procedure:updated` UI-refresh event after a chat-authoring write.
 * Lazily imports the realtime module — a static import would pull the
 * realtime→cache graph into this module at load time and create an import
 * cycle back into the kopilot capability modules that import these queries
 * (same pattern as `cache/providers/ai-provider-configs-provider.ts`).
 */
async function emitProcedureUpdated(
  organizationId: string,
  data: { procedureId: string; agentId: string }
): Promise<void> {
  const { getRealtimeService, publishProcedureUpdated } = await import('../../../realtime')
  await publishProcedureUpdated(getRealtimeService(), organizationId, data)
}

export interface AttachedProcedureDraft {
  procedureId: string
  name: string
  whenToUse: string
  triggerExamples: unknown[]
  ruleset: unknown[]
  hasUnpublishedChanges: boolean
  activeVersionId: string | null
  enabled: boolean
  draftDoc: TiptapDoc
  draftContentHash: string
}

/**
 * Load a procedure's draft doc + metadata, but ONLY if it is attached to the
 * session agent. Rejects an unattached / cross-agent procedure id.
 */
export async function getAttachedProcedureDraft(input: {
  organizationId: string
  agentId: string
  procedureId: string
}) {
  const { organizationId, agentId, procedureId } = input

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const [link] = await tx
        .select({
          enabled: schema.AgentProcedure.enabled,
        })
        .from(schema.AgentProcedure)
        .where(
          and(
            eq(schema.AgentProcedure.agentId, agentId),
            eq(schema.AgentProcedure.procedureId, procedureId),
            eq(schema.AgentProcedure.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!link) throw new Error('PROCEDURE_NOT_ATTACHED')

      const procedure = await tx.query.Procedure.findFirst({
        where: and(
          eq(schema.Procedure.id, procedureId),
          eq(schema.Procedure.organizationId, organizationId)
        ),
      })
      if (!procedure?.draftVersionId) throw new Error('PROCEDURE_OR_DRAFT_NOT_FOUND')

      const draft = await tx.query.ProcedureVersion.findFirst({
        where: eq(schema.ProcedureVersion.id, procedure.draftVersionId),
        columns: { doc: true },
      })
      if (!draft) throw new Error('DRAFT_NOT_FOUND')

      const draftDoc = (draft.doc ?? { type: 'doc', content: [] }) as TiptapDoc
      return {
        procedureId: procedure.id,
        name: procedure.name,
        whenToUse: procedure.whenToUse,
        triggerExamples: procedure.triggerExamples,
        ruleset: procedure.ruleset,
        hasUnpublishedChanges: procedure.hasUnpublishedChanges,
        activeVersionId: procedure.activeVersionId,
        enabled: link.enabled,
        draftDoc,
        draftContentHash: hashDoc(draftDoc),
      } satisfies AttachedProcedureDraft
    }),
    'get-attached-procedure-draft'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value)
}

export interface AuthoringProcedureSummary {
  procedureId: string
  name: string
  whenToUse: string
  enabled: boolean
  hasUnpublishedChanges: boolean
  activeVersionId: string | null
}

/**
 * All procedures attached to the agent — INCLUDING unpublished drafts (which the
 * org-cache projection excludes). Drives the inlined attached-procedure list so
 * the model knows what exists and can edit vs create.
 */
export async function listAgentProceduresForAuthoring(input: {
  organizationId: string
  agentId: string
}) {
  const { organizationId, agentId } = input
  const result = await fromDatabase(
    database
      .select({
        procedureId: schema.Procedure.id,
        name: schema.Procedure.name,
        whenToUse: schema.Procedure.whenToUse,
        enabled: schema.AgentProcedure.enabled,
        hasUnpublishedChanges: schema.Procedure.hasUnpublishedChanges,
        activeVersionId: schema.Procedure.activeVersionId,
      })
      .from(schema.AgentProcedure)
      .innerJoin(schema.Procedure, eq(schema.Procedure.id, schema.AgentProcedure.procedureId))
      .where(
        and(
          eq(schema.AgentProcedure.agentId, agentId),
          eq(schema.AgentProcedure.organizationId, organizationId)
        )
      ),
    'list-agent-procedures-for-authoring'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value as AuthoringProcedureSummary[])
}

/**
 * Atomically create a Procedure, wire its draft version, attach it to the session
 * agent (enabled, priority 0), and optionally seed a prevalidated initial doc — in
 * one transaction so a failure leaves no orphan procedure or half-created link.
 */
export async function createAttachedProcedureDraft(input: {
  organizationId: string
  agentId: string
  name: string
  defaults?: ProcedureDefaults
  doc?: TiptapDoc
}) {
  const { organizationId, agentId, name, defaults, doc } = input
  const seededDoc: TiptapDoc = doc ?? { type: 'doc', content: [] }

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const { procedure } = await createProcedureTx(tx, {
        organizationId,
        name,
        defaults,
        doc: seededDoc,
        markDirty: true,
      })
      await attachProcedureTx(tx, {
        organizationId,
        agentId,
        procedureId: procedure.id,
        enabled: true,
        priority: 0,
      })
      return { procedureId: procedure.id, draftContentHash: hashDoc(seededDoc) }
    }),
    'create-attached-procedure-draft'
  )
  if (result.isErr()) return err(result.error)
  // UI refresh signal for an open editor/rail — only after the tx committed.
  await emitProcedureUpdated(organizationId, {
    procedureId: result.value.procedureId,
    agentId,
  })
  return ok(result.value)
}

/**
 * Compare-and-set draft write: in one transaction, verify attachment, lock+reload
 * the draft version, recompute its content hash, reject on mismatch (a concurrent
 * editor autosave / chat edit landed since the read), else write the new doc and
 * flag `hasUnpublishedChanges`. This is the authoritative lost-update guard — an
 * earlier in-tool hash check is only advisory. Never publishes the procedure;
 * never fires the runtime cache event (drafts can't affect live runs) — but does
 * emit the `procedure:updated` UI-refresh event so an open editor re-seeds.
 */
export async function updateAttachedProcedureDraftIfHash(input: {
  organizationId: string
  agentId: string
  procedureId: string
  expectedHash: string
  doc: TiptapDoc
}) {
  const { organizationId, agentId, procedureId, expectedHash, doc } = input

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const [link] = await tx
        .select({ id: schema.AgentProcedure.id })
        .from(schema.AgentProcedure)
        .where(
          and(
            eq(schema.AgentProcedure.agentId, agentId),
            eq(schema.AgentProcedure.procedureId, procedureId),
            eq(schema.AgentProcedure.organizationId, organizationId)
          )
        )
        .limit(1)
      if (!link) throw new Error('PROCEDURE_NOT_ATTACHED')

      const procedure = await tx.query.Procedure.findFirst({
        where: and(
          eq(schema.Procedure.id, procedureId),
          eq(schema.Procedure.organizationId, organizationId)
        ),
        columns: { draftVersionId: true },
      })
      if (!procedure?.draftVersionId) throw new Error('PROCEDURE_OR_DRAFT_NOT_FOUND')

      // Lock the draft row so a concurrent autosave can't slip between read+write.
      const [current] = await tx
        .select({ doc: schema.ProcedureVersion.doc })
        .from(schema.ProcedureVersion)
        .where(eq(schema.ProcedureVersion.id, procedure.draftVersionId))
        .for('update')
        .limit(1)
      if (!current) throw new Error('DRAFT_NOT_FOUND')

      const currentHash = hashDoc((current.doc ?? { type: 'doc', content: [] }) as TiptapDoc)
      if (currentHash !== expectedHash) throw new StaleDraftError()

      await writeDraftDocTx(tx, { procedureId, draftVersionId: procedure.draftVersionId, doc })

      return { draftContentHash: hashDoc(doc) }
    }),
    'update-attached-procedure-draft-if-hash'
  )
  if (result.isErr()) {
    // `fromDatabase` wraps the thrown error as `{ code: 'DATABASE_ERROR', cause }`
    // — the StaleDraftError instance is on `cause`, not the result error itself.
    if (result.error.cause instanceof StaleDraftError) {
      return err({ code: 'STALE_DRAFT' as const, message: result.error.cause.message })
    }
    return err(result.error)
  }
  // UI refresh signal for an open editor/rail — only after the tx committed.
  await emitProcedureUpdated(organizationId, { procedureId, agentId })
  return ok(result.value)
}

/**
 * Update a procedure's name / selection criteria from the chat-authoring path.
 * A thin wrapper over `updateProcedure` that also emits the `procedure:updated`
 * UI-refresh event. The editor's own tRPC save path calls `updateProcedure`
 * directly and must NOT emit — it would invalidate the author's own in-flight
 * editing. Attachment must already be verified by the caller (the tools
 * authorize via `getAttachedProcedureDraft`).
 */
export async function updateAttachedProcedureCriteria(input: {
  organizationId: string
  agentId: string
  procedureId: string
  patch: { name?: string } & ProcedureDefaults
}) {
  const { organizationId, agentId, procedureId, patch } = input
  const result = await updateProcedure({ organizationId, procedureId, patch })
  if (result.isErr()) return result
  await emitProcedureUpdated(organizationId, { procedureId, agentId })
  return result
}

/** Thrown inside the compare-and-set txn when the persisted draft moved since the read. */
export class StaleDraftError extends Error {
  constructor() {
    super('The draft changed since you read it. Call read_procedure again, reapply, and retry.')
    this.name = 'StaleDraftError'
  }
}
