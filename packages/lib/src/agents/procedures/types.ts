// packages/lib/src/agents/procedures/types.ts

import type { FieldType } from '@auxx/database/types'
import type { ConditionGroup } from '../../conditions/types'
import type { FieldOptions } from '../../custom-fields/field-options'

/**
 * The shared contract for v9 procedures — the compiled step tree, the local
 * scratch + sub-procedure declarations, and the runtime frame stack. Rich types
 * live HERE in lib (tier-3) because `FieldType`, `ConditionGroup`, and
 * `FieldOptions` all resolve as ordinary lib imports; `@auxx/database` keeps the
 * columns generic jsonb and the service layer casts on read.
 *
 * See plans/chat/v9/phase-0-schema-types-compiler.md §2.
 */

export type StepId = string
export type SubProcedureId = string

/** A selection trigger example: a phrase the procedure should `use` for or `avoid`. */
export type TriggerExample = { text: string; behavior: 'use' | 'avoid' }

/**
 * How a `tool` step's arguments are sourced: a literal `const` value, a
 * `var:<ref>` from the Context-Variables store, or a `model`-decided argument.
 */
export type ArgBindingMap = Record<
  string,
  { kind: 'const' | 'var' | 'model'; ref?: string; value?: unknown }
>

/**
 * One declared output of a code block. `name` MUST be a declared {@link LocalAttribute}
 * — `result[name]` writes to `var:<name>`. `surfaceToModel` (D4) decides whether the
 * value is fed into the model's prose context or stays branch-only.
 */
export type CodeOutput = { name: string; surfaceToModel: boolean }

/**
 * The compiled runtime step. The v9 union is `instruction | condition | routing | code`.
 * **Tool calls stay inline ops** carried inside an `instruction` step's `doc` (the model
 * acts on them inside the engine loop; a tool result binds to a local attribute). **Code
 * is its OWN deterministic step** (D2): the stepper walks *through* it — runs the block,
 * writes its outputs to `var:*`, advances to `next`, never rests on it — so on resume the
 * cursor is past the code and it does not re-fire (plan §"Why deterministic").
 *
 * A `code` step carries NO input config: the block's `main(inputs)` receives a whole-procedure
 * ambient `inputs` bag (`{ vars, subject }`, built by `buildCodeInputs`), reaching values by
 * path rather than pre-wired refs. Outputs stay declared (`result[name]` → `var:<name>`).
 */
export type ProcedureStep =
  | { id: StepId; kind: 'instruction'; doc: unknown /* TiptapFragment */; next: StepId | null }
  | {
      id: StepId
      kind: 'code'
      codeBlockId: string // → compiled.codeBlocks[id]
      outputs: CodeOutput[] // result[name] → scopedVar(frame, name)
      next: StepId | null // deterministic — always advances, never stops
    }
  | {
      id: StepId
      kind: 'condition'
      // The block-level evaluation mode (decision D1/D3). BOTH modes branch via
      // `thenStep`/`elseStep` — the bodies are always real steps; only HOW the
      // predicate is tested differs.
      //   'structured' → each case carries a `group: ConditionGroup`, evaluated by
      //                  `evaluateConditions` (deterministic, first true arm wins).
      //   'text'       → each case carries a `predicate: string` (the compiled NL
      //                  test); the stepper picks the arm via a classify-style call.
      mode: 'text' | 'structured'
      // IF / ELSE-IF chain, evaluated in array order, first match wins.
      // `thenStep` = first step of the arm's body.
      cases: { thenStep: StepId | null; group?: ConditionGroup; predicate?: string }[]
      elseStep: StepId | null // ELSE fallthrough (no test)
      next: StepId | null // join after the block
    }
  | {
      id: StepId
      kind: 'routing'
      outcome: 'finished' | 'handoff' | 'switch' | 'call'
      // 'call'   → run a LOCAL sub-procedure (subProcedureId), same version, return to `next` on finish.
      // 'switch' → replace the frame with another standalone Procedure (switchToProcedureId), NO return.
      // 'finished'/'handoff' → terminal end-reasons for the frame (`next: null`).
      switchToProcedureId?: string
      subProcedureId?: SubProcedureId
      next: StepId | null
    }

/**
 * A declared procedure-local scratch variable — Lyra's `local_attributes`. Each
 * compiles to a `var:<name>` ref in the Context-Variables store. This is the
 * ONLY way a tool/connector result becomes addressable in procedure logic — we
 * deliberately do NOT key procedure reads by `tool:<name>` (latest-wins is
 * ambiguous when a tool is called more than once). An inline tool op's bound
 * result and a code block's outputs write into these; `condition`/prose read them.
 *
 * `dataType` is the app-wide `FieldType` (`@auxx/database`), so a `var:<name>`
 * ref becomes a conditions-UI `FieldDefinition` for free (`fieldType = dataType`,
 * `type = mapFieldTypeToBaseType(dataType)`). The TYPE admits all of `FieldType`;
 * the Phase-2 editor curates the choices it offers, but the compiler accepts any.
 *
 * `options` is the SAME unified `FieldOptions` bag a `CustomField` carries —
 * reused wholesale for consistency. Most attributes leave it undefined.
 */
export type LocalAttribute = { name: string; dataType: FieldType; options?: FieldOptions }

/**
 * A named, LOCAL sub-procedure (Lyra's `taskSection`) — a reusable block of
 * steps defined INSIDE one procedure's body. Invoked by a `routing` step with
 * `outcome: 'call'` + `subProcedureId`; the engine pushes a frame whose
 * `cursor = entryStepId` on the SAME `procedureVersionId`, runs the steps, and
 * pops back to the calling step's `next` on finish (subroutine semantics).
 *
 * It is NOT a separate `Procedure` row — its steps live in the same flat `steps`
 * map and it shares the parent's `localAttributes` namespace (data flows through
 * that shared scratch, no cross-procedure I/O contract). Cross-PROCEDURE
 * transitions are separate: `switch` (no return) and customer `digression`
 * (push another Procedure, return) — only those isolate namespaces.
 */
export type SubProcedure = { id: SubProcedureId; name: string; entryStepId: StepId }

export interface CompiledProcedure {
  entryStepId: StepId
  /** Shared by the main body AND every sub-procedure — one flat map. */
  steps: Record<StepId, ProcedureStep>
  /** Doc-level code sources; per-invocation input/output bindings live on the `code` step. */
  codeBlocks: Record<string, { language: 'javascript'; code: string }>
  /** Named local sub-procedures; each `entryStepId` ∈ `steps`. */
  subProcedures: Record<SubProcedureId, SubProcedure>
  /**
   * Declared procedure-local scratch (Lyra `local_attributes`). The stepper
   * namespaces each `var:<name>` under the running `procedureVersionId` (Phase 3),
   * so a LOCAL sub-procedure (same version) SHARES this namespace with the body
   * while a CROSS-procedure push (`switch`/`digression`, a different version)
   * gets an isolated one. An inline tool op's bound result and condition/prose
   * refs must name one.
   */
  localAttributes: LocalAttribute[]
}

// ── the stack ──────────────────────────────────────────────────────────
export interface ProcedureFrame {
  procedureId: string
  /** PINNED version — the run reads this exact ProcedureVersion throughout. */
  procedureVersionId: string
  cursor: StepId | null // null = finished
  status: 'running' | 'awaiting_customer' | 'finished'
  history: { stepId: StepId; outcome: string }[]
  pushedBy: 'selection' | 'digression' | 'call' | 'switch'
}

export interface ProcedureStack {
  frames: ProcedureFrame[] // top = last element; [] = free-form persona mode
}
