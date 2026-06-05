// packages/lib/src/agents/procedures/queries.ts

import type { AgentProcedureEntity, ProcedureEntity, ProcedureVersionEntity } from '@auxx/database'
import { database, schema } from '@auxx/database'
import { fromDatabase } from '@auxx/services/shared/utils'
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import type { TiptapDoc } from './nodes'
import type { CompiledProcedure } from './types'

/**
 * Functional data access for v9 procedures (Drizzle + neverthrow). Mirrors
 * `@auxx/services` `ai-agent-sessions/session-queries`, but lives in lib so it
 * can speak the rich procedure contract directly — `doc` is a {@link TiptapDoc}
 * and `compiled` a {@link CompiledProcedure}, cast to the generic jsonb columns
 * at the DB boundary. The KB `Article`/`ArticleRevision` create/publish/revert
 * shape, reframed for `Procedure`/`ProcedureVersion`.
 *
 * See plans/chat/v9/phase-0-schema-types-compiler.md §6.
 */

type Jsonb = Record<string, unknown>

// ── Procedure (standalone) ──────────────────────────────────────────────

export interface ProcedureDefaults {
  whenToUse?: string
  triggerExamples?: unknown[]
  ruleset?: unknown[]
}

/** Insert a Procedure + its empty draft ProcedureVersion, then wire `draftVersionId`. */
export async function createProcedure(input: {
  organizationId: string
  name: string
  defaults?: ProcedureDefaults
}) {
  const { organizationId, name, defaults } = input

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const [procedure] = await tx
        .insert(schema.Procedure)
        .values({
          organizationId,
          name,
          whenToUse: defaults?.whenToUse ?? '',
          triggerExamples: defaults?.triggerExamples ?? [],
          ruleset: defaults?.ruleset ?? [],
          updatedAt: new Date(),
        })
        .returning()
      if (!procedure) throw new Error('Failed to insert procedure')

      const [draft] = await tx
        .insert(schema.ProcedureVersion)
        .values({ organizationId, procedureId: procedure.id, versionNumber: null, doc: {} })
        .returning()
      if (!draft) throw new Error('Failed to insert draft version')

      const [withPointer] = await tx
        .update(schema.Procedure)
        .set({ draftVersionId: draft.id, updatedAt: new Date() })
        .where(eq(schema.Procedure.id, procedure.id))
        .returning()
      if (!withPointer) throw new Error('Failed to wire draft pointer')

      return withPointer
    }),
    'create-procedure'
  )

  if (result.isErr()) return err(result.error)
  return ok(result.value)
}

export async function listProcedures(input: { organizationId: string }) {
  const result = await fromDatabase(
    database
      .select()
      .from(schema.Procedure)
      .where(eq(schema.Procedure.organizationId, input.organizationId))
      .orderBy(desc(schema.Procedure.updatedAt)),
    'list-procedures'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value)
}

export async function getProcedureById(input: { organizationId: string; procedureId: string }) {
  const result = await fromDatabase(
    database.query.Procedure.findFirst({
      where: and(
        eq(schema.Procedure.id, input.procedureId),
        eq(schema.Procedure.organizationId, input.organizationId)
      ),
    }),
    'get-procedure-by-id'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value ?? null)
}

/**
 * Update name + trigger DEFAULTS only (never touches version pointers). Editing a
 * selection-criteria field (whenToUse/triggerExamples/ruleset) marks the
 * procedure dirty so the publish pill flips amber — those fields are versioned and
 * only go live on publish. A name-only change does NOT flip the flag (name isn't
 * versioned).
 */
export async function updateProcedure(input: {
  organizationId: string
  procedureId: string
  patch: { name?: string } & ProcedureDefaults
}) {
  const { organizationId, procedureId, patch } = input
  const criteriaChanged =
    patch.whenToUse !== undefined ||
    patch.triggerExamples !== undefined ||
    patch.ruleset !== undefined
  const result = await fromDatabase(
    database
      .update(schema.Procedure)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.whenToUse !== undefined ? { whenToUse: patch.whenToUse } : {}),
        ...(patch.triggerExamples !== undefined ? { triggerExamples: patch.triggerExamples } : {}),
        ...(patch.ruleset !== undefined ? { ruleset: patch.ruleset } : {}),
        ...(criteriaChanged ? { hasUnpublishedChanges: true } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.Procedure.id, procedureId),
          eq(schema.Procedure.organizationId, organizationId)
        )
      )
      .returning(),
    'update-procedure'
  )
  if (result.isErr()) return err(result.error)
  const updated = result.value[0]
  if (!updated)
    return err({
      code: 'PROCEDURE_NOT_FOUND' as const,
      message: `Procedure not found: ${procedureId}`,
    })
  return ok(updated)
}

/** Write the draft version's `doc` in place and flag `hasUnpublishedChanges`. Never publishes. */
export async function updateDraftDoc(input: {
  organizationId: string
  procedureId: string
  doc: TiptapDoc
}) {
  const { organizationId, procedureId, doc } = input

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const procedure = await tx.query.Procedure.findFirst({
        where: and(
          eq(schema.Procedure.id, procedureId),
          eq(schema.Procedure.organizationId, organizationId)
        ),
        columns: { draftVersionId: true },
      })
      if (!procedure?.draftVersionId) throw new Error('PROCEDURE_OR_DRAFT_NOT_FOUND')

      await tx
        .update(schema.ProcedureVersion)
        .set({ doc: doc as Jsonb })
        .where(eq(schema.ProcedureVersion.id, procedure.draftVersionId))
      await tx
        .update(schema.Procedure)
        .set({ hasUnpublishedChanges: true, updatedAt: new Date() })
        .where(eq(schema.Procedure.id, procedureId))
    }),
    'update-draft-doc'
  )
  if (result.isErr()) return err(result.error)
  return ok(undefined)
}

/**
 * Throw away draft edits: copy the active version's `doc` back into the draft
 * version AND its selection criteria (whenToUse/triggerExamples/ruleset) back
 * onto the procedure row, then clear `hasUnpublishedChanges`. With nothing
 * published yet there's no live snapshot to revert to, so we just clear the flag.
 * Sibling of {@link revertProcedure}, but it never repoints `activeVersionId` — a
 * dedicated discard reads cleaner than a self-targeted revert.
 */
export async function discardProcedureDraft(input: {
  organizationId: string
  procedureId: string
}) {
  const { organizationId, procedureId } = input

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const procedure = await tx.query.Procedure.findFirst({
        where: and(
          eq(schema.Procedure.id, procedureId),
          eq(schema.Procedure.organizationId, organizationId)
        ),
        columns: { activeVersionId: true, draftVersionId: true },
      })
      if (!procedure) throw new Error('PROCEDURE_NOT_FOUND')

      let criteria: {
        whenToUse: string
        triggerExamples: unknown[]
        ruleset: unknown[]
      } | null = null
      if (procedure.activeVersionId && procedure.draftVersionId) {
        const active = await tx.query.ProcedureVersion.findFirst({
          where: eq(schema.ProcedureVersion.id, procedure.activeVersionId),
          columns: { doc: true, whenToUse: true, triggerExamples: true, ruleset: true },
        })
        if (active) {
          await tx
            .update(schema.ProcedureVersion)
            .set({ doc: active.doc })
            .where(eq(schema.ProcedureVersion.id, procedure.draftVersionId))
          criteria = {
            whenToUse: active.whenToUse,
            triggerExamples: active.triggerExamples,
            ruleset: active.ruleset,
          }
        }
      }

      const [updated] = await tx
        .update(schema.Procedure)
        .set({
          ...(criteria ?? {}),
          hasUnpublishedChanges: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.Procedure.id, procedureId))
        .returning()
      if (!updated) throw new Error('Failed to clear draft flag')
      return updated
    }),
    'discard-procedure-draft'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value)
}

/** How many agents have this procedure attached — the delete blast-radius. */
export async function countAgentsUsingProcedure(input: {
  organizationId: string
  procedureId: string
}) {
  const result = await fromDatabase(
    database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.AgentProcedure)
      .where(
        and(
          eq(schema.AgentProcedure.procedureId, input.procedureId),
          eq(schema.AgentProcedure.organizationId, input.organizationId)
        )
      ),
    'count-agents-using-procedure'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value[0]?.count ?? 0)
}

export async function deleteProcedure(input: { organizationId: string; procedureId: string }) {
  const result = await fromDatabase(
    database
      .delete(schema.Procedure)
      .where(
        and(
          eq(schema.Procedure.id, input.procedureId),
          eq(schema.Procedure.organizationId, input.organizationId)
        )
      ),
    'delete-procedure'
  )
  if (result.isErr()) return err(result.error)
  return ok(undefined)
}

// ── versions (history + revert + run-pin read) ──────────────────────────

/** Published versions (versionNumber not null), newest first. */
export async function listProcedureVersions(input: { procedureId: string }) {
  const result = await fromDatabase(
    database
      .select()
      .from(schema.ProcedureVersion)
      .where(
        and(
          eq(schema.ProcedureVersion.procedureId, input.procedureId),
          isNotNull(schema.ProcedureVersion.versionNumber)
        )
      )
      .orderBy(desc(schema.ProcedureVersion.versionNumber)),
    'list-procedure-versions'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value)
}

/**
 * The run-pin resume read — load the exact pinned version. The `compiled` blob
 * is the lib {@link CompiledProcedure} (null on the draft); the stepper reads it.
 */
export async function getProcedureVersionById(input: {
  organizationId: string
  procedureVersionId: string
}) {
  const result = await fromDatabase(
    database.query.ProcedureVersion.findFirst({
      where: and(
        eq(schema.ProcedureVersion.id, input.procedureVersionId),
        eq(schema.ProcedureVersion.organizationId, input.organizationId)
      ),
    }),
    'get-procedure-version-by-id'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value ?? null)
}

/** Read the compiled step tree off a version row, typed (null on the draft). */
export function readCompiled(version: ProcedureVersionEntity): CompiledProcedure | null {
  return (version.compiled as CompiledProcedure | null) ?? null
}

/**
 * Snapshot the draft into a new numbered version — its compiled tree AND the
 * procedure row's current selection criteria (whenToUse/triggerExamples/ruleset,
 * the draft working copy) — then repoint `activeVersionId`. No-op republish: if
 * the draft's `doc` AND all three criteria already match the active version, skip
 * the new version and return the active one.
 */
export async function publishProcedure(input: {
  organizationId: string
  procedureId: string
  doc: TiptapDoc
  compiled: CompiledProcedure
  editorId?: string
  label?: string
}) {
  const { organizationId, procedureId, doc, compiled, editorId, label } = input

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const procedure = await tx.query.Procedure.findFirst({
        where: and(
          eq(schema.Procedure.id, procedureId),
          eq(schema.Procedure.organizationId, organizationId)
        ),
      })
      if (!procedure) throw new Error('PROCEDURE_NOT_FOUND')

      // No-op republish: skip the new snapshot only if BOTH the doc and all three
      // selection criteria are identical to the active version — otherwise a
      // criteria-only edit (doc unchanged) would silently drop its snapshot. Then
      // just clear the dirty flag and return the active version.
      if (procedure.activeVersionId) {
        const active = await tx.query.ProcedureVersion.findFirst({
          where: eq(schema.ProcedureVersion.id, procedure.activeVersionId),
        })
        const unchanged =
          active &&
          JSON.stringify(active.doc) === JSON.stringify(doc) &&
          active.whenToUse === procedure.whenToUse &&
          JSON.stringify(active.triggerExamples) === JSON.stringify(procedure.triggerExamples) &&
          JSON.stringify(active.ruleset) === JSON.stringify(procedure.ruleset)
        if (unchanged) {
          if (procedure.hasUnpublishedChanges) {
            await tx
              .update(schema.Procedure)
              .set({ hasUnpublishedChanges: false, updatedAt: new Date() })
              .where(eq(schema.Procedure.id, procedureId))
          }
          return active
        }
      }

      const [{ next }] = await tx
        .select({
          next: sql<number>`COALESCE(MAX(${schema.ProcedureVersion.versionNumber}), 0) + 1`,
        })
        .from(schema.ProcedureVersion)
        .where(eq(schema.ProcedureVersion.procedureId, procedureId))

      const [published] = await tx
        .insert(schema.ProcedureVersion)
        .values({
          organizationId,
          procedureId,
          versionNumber: next ?? 1,
          label: label ?? null,
          doc: doc as Jsonb,
          compiled: compiled as unknown as Jsonb,
          whenToUse: procedure.whenToUse,
          triggerExamples: procedure.triggerExamples,
          ruleset: procedure.ruleset,
          editorId: editorId ?? null,
        })
        .returning()
      if (!published) throw new Error('Failed to insert published version')

      await tx
        .update(schema.Procedure)
        .set({ activeVersionId: published.id, hasUnpublishedChanges: false, updatedAt: new Date() })
        .where(eq(schema.Procedure.id, procedureId))

      return published
    }),
    'publish-procedure'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value)
}

/**
 * Repoint `activeVersionId` at an older published version, copy its `doc` into the
 * draft version, AND restore its selection criteria onto the procedure row (so the
 * draft working copy matches the version the user restored).
 */
export async function revertProcedure(input: {
  organizationId: string
  procedureId: string
  toVersionId: string
}) {
  const { organizationId, procedureId, toVersionId } = input

  const result = await fromDatabase(
    database.transaction(async (tx) => {
      const procedure = await tx.query.Procedure.findFirst({
        where: and(
          eq(schema.Procedure.id, procedureId),
          eq(schema.Procedure.organizationId, organizationId)
        ),
        columns: { draftVersionId: true },
      })
      if (!procedure) throw new Error('PROCEDURE_NOT_FOUND')

      const target = await tx.query.ProcedureVersion.findFirst({
        where: and(
          eq(schema.ProcedureVersion.id, toVersionId),
          eq(schema.ProcedureVersion.procedureId, procedureId)
        ),
      })
      if (!target) throw new Error('TARGET_VERSION_NOT_FOUND')

      await tx
        .update(schema.Procedure)
        .set({
          activeVersionId: toVersionId,
          whenToUse: target.whenToUse,
          triggerExamples: target.triggerExamples,
          ruleset: target.ruleset,
          hasUnpublishedChanges: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.Procedure.id, procedureId))

      if (procedure.draftVersionId) {
        await tx
          .update(schema.ProcedureVersion)
          .set({ doc: target.doc })
          .where(eq(schema.ProcedureVersion.id, procedure.draftVersionId))
      }
    }),
    'revert-procedure'
  )
  if (result.isErr()) return err(result.error)
  return ok(undefined)
}

// ── AgentProcedure (link + overrides) ───────────────────────────────────

/** Selection candidate source for an agent. */
export async function listAgentProcedures(input: { agentId: string }) {
  const result = await fromDatabase(
    database
      .select()
      .from(schema.AgentProcedure)
      .where(eq(schema.AgentProcedure.agentId, input.agentId)),
    'list-agent-procedures'
  )
  if (result.isErr()) return err(result.error)
  return ok(result.value)
}

export interface AgentProcedureOverrides {
  whenToUseOverride?: string | null
  triggerExamplesOverride?: unknown[] | null
  rulesetOverride?: unknown[] | null
}

export async function attachProcedure(input: {
  organizationId: string
  agentId: string
  procedureId: string
  enabled?: boolean
  priority?: number
  overrides?: AgentProcedureOverrides
}) {
  const { organizationId, agentId, procedureId, enabled, priority, overrides } = input
  const result = await fromDatabase(
    database
      .insert(schema.AgentProcedure)
      .values({
        organizationId,
        agentId,
        procedureId,
        enabled: enabled ?? true,
        priority: priority ?? 0,
        whenToUseOverride: overrides?.whenToUseOverride ?? null,
        triggerExamplesOverride: overrides?.triggerExamplesOverride ?? null,
        rulesetOverride: overrides?.rulesetOverride ?? null,
        updatedAt: new Date(),
      })
      .returning(),
    'attach-procedure'
  )
  if (result.isErr()) return err(result.error)
  const row = result.value[0]
  if (!row)
    return err({
      code: 'AGENT_PROCEDURE_CREATE_FAILED' as const,
      message: 'Failed to attach procedure',
    })
  return ok(row)
}

export async function updateAgentProcedure(input: {
  organizationId: string
  id: string
  patch: { enabled?: boolean; priority?: number } & AgentProcedureOverrides
}) {
  const { organizationId, id, patch } = input
  const result = await fromDatabase(
    database
      .update(schema.AgentProcedure)
      .set({
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.whenToUseOverride !== undefined
          ? { whenToUseOverride: patch.whenToUseOverride }
          : {}),
        ...(patch.triggerExamplesOverride !== undefined
          ? { triggerExamplesOverride: patch.triggerExamplesOverride }
          : {}),
        ...(patch.rulesetOverride !== undefined ? { rulesetOverride: patch.rulesetOverride } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.AgentProcedure.id, id),
          eq(schema.AgentProcedure.organizationId, organizationId)
        )
      )
      .returning(),
    'update-agent-procedure'
  )
  if (result.isErr()) return err(result.error)
  const row = result.value[0]
  if (!row)
    return err({
      code: 'AGENT_PROCEDURE_NOT_FOUND' as const,
      message: `AgentProcedure not found: ${id}`,
    })
  return ok(row)
}

export async function detachProcedure(input: { organizationId: string; id: string }) {
  const result = await fromDatabase(
    database
      .delete(schema.AgentProcedure)
      .where(
        and(
          eq(schema.AgentProcedure.id, input.id),
          eq(schema.AgentProcedure.organizationId, input.organizationId)
        )
      ),
    'detach-procedure'
  )
  if (result.isErr()) return err(result.error)
  return ok(undefined)
}

export type { AgentProcedureEntity, ProcedureEntity, ProcedureVersionEntity }
