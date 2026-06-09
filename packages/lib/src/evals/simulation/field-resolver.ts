// packages/lib/src/evals/simulation/field-resolver.ts
//
// The Simulation field overlay: builds the turn's `Subject` from a case's
// configured records and layers its `startingFields` on top, WITHOUT writing CRM
// data. Wired onto the executor's `ToolContext` as `evalFieldResolver`, so every
// production read path (prompt context, tool bindings, in-procedure conditions,
// code inputs, `crm_field` grading) sees the overlaid values through the shared
// `buildSubjectFieldResolver`. See plans/evals/phase-1-agent-simulation.md §1.5.

import type { FieldReference, VarRef } from '@auxx/types/field'
import {
  fieldRefToKey,
  getFieldDefinitionId,
  isFieldPath,
  type ResourceFieldId,
} from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId } from '@auxx/types/resource'
import { err, ok, type Result } from 'neverthrow'
import { buildResolveVarSource } from '../../agents/bindings/resolve'
import type { EvalFieldResolver, Subject, ToolContext } from '../../ai/agent-framework/tool-context'
import type { EvalServiceError } from '../types'

export interface SimulationSubjectInput {
  recordIds: RecordId[]
  identityVerified: boolean
  claimed?: { name?: string; email?: string }
}

export interface StartingFieldInput {
  ref: FieldReference
  value: unknown
}

export interface SimulationFieldOverlay {
  /** The turn subject the executor assigns to `ctx.subject`. */
  subject: Subject
  /**
   * Bind the overlay to a built {@link ToolContext}. The returned resolver layers
   * `startingFields` first, then delegates to the subject-backed resolver — call
   * it as `ctx.evalFieldResolver = makeResolver(ctx)`.
   */
  makeResolver: (ctx: ToolContext) => EvalFieldResolver
}

/**
 * Root entity-type key a field reference resolves against (the subject anchor
 * key). `null` for a bare `FieldId` (no `:` root) — it can't anchor, exactly like
 * the binding resolver's `toVarRef`.
 */
function rootEntityKey(ref: FieldReference): string | null {
  const segment = isFieldPath(ref) ? ref[0] : ref
  if (typeof segment === 'string' && !segment.includes(':')) return null
  return getFieldDefinitionId(segment as ResourceFieldId)
}

const validationError = (message: string): EvalServiceError => ({
  code: 'EVAL_VALIDATION',
  message,
})

/**
 * Build `Subject.anchors` keyed by entity type (rejecting duplicates — a Subject
 * holds one record per type), canonicalize `startingFields`, and verify each
 * rooted field has a matching anchor. Returns the subject plus a resolver
 * factory; the executor wires both onto the `ToolContext`.
 *
 * Org safety is enforced downstream, not here: every field read goes through
 * {@link buildResolveVarSource} → `FieldValueService`, which scopes all reads to
 * `ctx.organizationId`. A foreign or nonexistent `recordId` therefore resolves to
 * absent (gated to `undefined`) rather than leaking — so no dedicated existence
 * query is needed on this hot path.
 */
export function buildSimulationFieldResolver(input: {
  organizationId: string
  subject: SimulationSubjectInput
  startingFields: StartingFieldInput[]
}): Result<SimulationFieldOverlay, EvalServiceError> {
  const { subject, startingFields } = input

  // 1. One anchor per entity type — duplicates are a config error.
  const anchors: Partial<Record<string, RecordId>> = {}
  for (const recordId of subject.recordIds) {
    const { entityDefinitionId } = parseRecordId(recordId)
    if (anchors[entityDefinitionId]) {
      return err(
        validationError(`Duplicate subject anchor for entity type "${entityDefinitionId}"`)
      )
    }
    anchors[entityDefinitionId] = recordId
  }

  // 2. Canonicalize startingFields by ref key; every rooted field needs an anchor.
  const overlay = new Map<string, unknown>()
  for (const field of startingFields) {
    const root = rootEntityKey(field.ref)
    if (!root || !anchors[root]) {
      return err(
        validationError(
          `Starting field "${fieldRefToKey(field.ref)}" has no matching subject anchor for "${root ?? '(no entity root)'}"`
        )
      )
    }
    overlay.set(fieldRefToKey(field.ref), field.value)
  }

  const builtSubject: Subject = {
    anchors,
    identityVerified: subject.identityVerified,
    ...(subject.claimed ? { claimed: subject.claimed } : {}),
  }

  const makeResolver = (ctx: ToolContext): EvalFieldResolver => {
    const resolveSubject = buildResolveVarSource(ctx)
    return async (ref) => {
      // 3. Overlay first.
      const key = fieldRefToKey(ref)
      if (overlay.has(key)) return overlay.get(key)
      // 4. Delegate missing values to the subject-backed resolver (read-only).
      return resolveSubject({ kind: 'var', ref: ref as VarRef }, builtSubject)
    }
  }

  return ok({ subject: builtSubject, makeResolver })
}
