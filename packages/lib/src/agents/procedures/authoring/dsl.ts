// packages/lib/src/agents/procedures/authoring/dsl.ts

/**
 * The LLM-facing intermediate representation (IR) for authoring procedures — a
 * structured, id-stable JSON document the Kopilot emits via `set_procedure_body`
 * and reads back via `read_procedure`. `buildProcedureDoc` lowers it to the
 * editor's TipTap doc; `docToDsl` reads a draft doc back into it. This module is
 * client-safe (pure types + a runtime validator, no server imports) so the tool
 * JSON Schema and the builder can share one source of truth.
 *
 * The model never emits raw TipTap and never sees code source, output bindings,
 * structured `ConditionGroup` payloads, or local attributes — those are
 * server-owned and carried through as read-only `opaque` steps. See
 * plans/chat/v9/phase-7-procedure-authoring-kopilot.md §3.
 */

/** The step discriminant kinds the model can emit. */
export type ProcedureDslStepKind = 'instruction' | 'condition' | 'route' | 'call' | 'opaque'

/**
 * One authored step. Authored ids round-trip across read→write cycles; `opaque`
 * ids are stable for exactly one read/write cycle (occurrence keys, regenerated
 * on the next read).
 */
export type ProcedureDslStep =
  | { id: string; kind: 'instruction'; text: string }
  | { id: string; kind: 'condition'; cases: ProcedureDslCase[]; else?: ProcedureDslStep[] }
  | { id: string; kind: 'route'; outcome: 'finished' | 'handoff' }
  | { id: string; kind: 'route'; outcome: 'switch'; switchToProcedureId: string }
  | { id: string; kind: 'call'; subProcedureId: string }
  | { id: string; kind: 'opaque'; label: string }

/** One IF / ELSE-IF arm of a text-mode condition. */
export interface ProcedureDslCase {
  id: string
  /** NL predicate the runtime classifier evaluates, e.g. "the order has already shipped". */
  when: string
  steps: ProcedureDslStep[]
}

/** A named, reusable sub-procedure body, callable via a `call` step. */
export interface ProcedureDslSubProcedure {
  id: string
  name: string
  steps: ProcedureDslStep[]
}

/** The full authoring document. */
export interface ProcedureDsl {
  steps: ProcedureDslStep[]
  subProcedures?: ProcedureDslSubProcedure[]
}

// ── invariants ─────────────────────────────────────────────────────────────

/** Max total authored steps across the whole document (main + all sub-procedures + arm bodies). */
export const DSL_MAX_STEPS = 400
/** Max number of named sub-procedures. */
export const DSL_MAX_SUBPROCEDURES = 50
/** Max length of one instruction's text / a predicate. */
export const DSL_MAX_TEXT_LEN = 12_000

const STEP_KINDS: ReadonlySet<string> = new Set([
  'instruction',
  'condition',
  'route',
  'call',
  'opaque',
])
const ROUTE_OUTCOMES: ReadonlySet<string> = new Set(['finished', 'handoff', 'switch'])

/** Allowed property keys per step kind — anything else is "unknown property". */
const ALLOWED_KEYS: Record<string, ReadonlySet<string>> = {
  instruction: new Set(['id', 'kind', 'text']),
  condition: new Set(['id', 'kind', 'cases', 'else']),
  route_terminal: new Set(['id', 'kind', 'outcome']),
  route_switch: new Set(['id', 'kind', 'outcome', 'switchToProcedureId']),
  call: new Set(['id', 'kind', 'subProcedureId']),
  opaque: new Set(['id', 'kind', 'label']),
}

// ── runtime validator ────────────────────────────────────────────────────────

/**
 * Validate a value as a {@link ProcedureDsl}. Returns `[]` when valid, else a
 * list of human-readable error strings. Enforces the §3.1 invariants: known
 * discriminants, non-empty ids/text/predicates, globally-unique ids, valid route
 * fields, calls targeting a declared sub-procedure, no condition nested inside
 * another condition (extract into a sub-procedure), a bounded total step count,
 * and no unknown properties. Do NOT rely on the model provider to honor the tool
 * JSON Schema — this runs server-side before lowering.
 *
 * Opaque occurrence-key resolution against the persisted draft (unknown /
 * duplicate / missing keys) is validated separately in `buildProcedureDoc`,
 * which has the draft in hand; this validator only checks structural shape.
 */
export function validateProcedureDsl(value: unknown): string[] {
  const errors: string[] = []
  if (!isPlainObject(value)) return ['body must be an object with a `steps` array.']

  const root = value as Record<string, unknown>
  for (const key of Object.keys(root)) {
    if (key !== 'steps' && key !== 'subProcedures') {
      errors.push(`Unknown top-level property "${key}".`)
    }
  }
  if (!Array.isArray(root.steps)) {
    errors.push('body.steps must be an array.')
  }

  const seenIds = new Set<string>()
  const declaredSubProcIds = new Set<string>()
  let stepCount = 0

  const requireId = (id: unknown, where: string): string | null => {
    if (typeof id !== 'string' || id.trim() === '') {
      errors.push(`${where} is missing a non-empty string "id".`)
      return null
    }
    if (seenIds.has(id)) {
      errors.push(
        `Duplicate id "${id}" (${where}). Every step/case/sub-procedure id must be unique.`
      )
      return null
    }
    seenIds.add(id)
    return id
  }

  // First pass: collect declared sub-procedure ids so `call` targets can resolve.
  const subProcedures = Array.isArray(root.subProcedures) ? root.subProcedures : []
  if (root.subProcedures !== undefined && !Array.isArray(root.subProcedures)) {
    errors.push('body.subProcedures must be an array when present.')
  }
  if (subProcedures.length > DSL_MAX_SUBPROCEDURES) {
    errors.push(`Too many sub-procedures (${subProcedures.length} > ${DSL_MAX_SUBPROCEDURES}).`)
  }
  for (const sp of subProcedures) {
    if (isPlainObject(sp) && typeof sp.id === 'string') declaredSubProcIds.add(sp.id)
  }

  const validateStep = (raw: unknown, where: string, insideCondition: boolean): void => {
    stepCount++
    if (!isPlainObject(raw)) {
      errors.push(`${where} must be an object.`)
      return
    }
    const step = raw as Record<string, unknown>
    const kind = step.kind
    if (typeof kind !== 'string' || !STEP_KINDS.has(kind)) {
      errors.push(`${where} has an unknown kind "${String(kind)}".`)
      return
    }
    const id = requireId(step.id, `${where} (${kind})`)
    const here = id ? `step "${id}"` : where

    if (kind === 'instruction') {
      assertKeys(step, ALLOWED_KEYS.instruction, here, errors)
      if (typeof step.text !== 'string' || step.text.trim() === '') {
        errors.push(`${here}: instruction "text" must be a non-empty string.`)
      } else if (step.text.length > DSL_MAX_TEXT_LEN) {
        errors.push(`${here}: instruction "text" exceeds ${DSL_MAX_TEXT_LEN} chars.`)
      }
    } else if (kind === 'opaque') {
      assertKeys(step, ALLOWED_KEYS.opaque, here, errors)
      if (typeof step.label !== 'string' || step.label.trim() === '') {
        errors.push(`${here}: opaque "label" must be a non-empty string.`)
      }
    } else if (kind === 'call') {
      assertKeys(step, ALLOWED_KEYS.call, here, errors)
      const target = step.subProcedureId
      if (typeof target !== 'string' || target.trim() === '') {
        errors.push(`${here}: call "subProcedureId" must be a non-empty string.`)
      } else if (!declaredSubProcIds.has(target)) {
        errors.push(`${here}: call targets undeclared sub-procedure "${target}".`)
      }
    } else if (kind === 'route') {
      const outcome = step.outcome
      if (typeof outcome !== 'string' || !ROUTE_OUTCOMES.has(outcome)) {
        errors.push(`${here}: route "outcome" must be one of finished|handoff|switch.`)
      } else if (outcome === 'switch') {
        assertKeys(step, ALLOWED_KEYS.route_switch, here, errors)
        if (
          typeof step.switchToProcedureId !== 'string' ||
          step.switchToProcedureId.trim() === ''
        ) {
          errors.push(`${here}: a "switch" route requires a non-empty "switchToProcedureId".`)
        }
      } else {
        assertKeys(step, ALLOWED_KEYS.route_terminal, here, errors)
      }
    } else if (kind === 'condition') {
      assertKeys(step, ALLOWED_KEYS.condition, here, errors)
      // Conditions cannot be nested: the editor renders a single level of
      // branching (a case body holds only instruction/route/call nodes, never
      // another condition). Reject it here so the model gets a retry signal and
      // extracts the inner branching into a sub-procedure instead.
      if (insideCondition) {
        errors.push(
          `${here}: a condition cannot be nested inside another condition. Extract this branch into a named entry in "subProcedures" and run it with a "call" step.`
        )
        return
      }
      if (!Array.isArray(step.cases) || step.cases.length === 0) {
        errors.push(`${here}: condition "cases" must be a non-empty array.`)
      } else {
        for (let i = 0; i < step.cases.length; i++) {
          const c = step.cases[i]
          const cWhere = `${here} case[${i}]`
          if (!isPlainObject(c)) {
            errors.push(`${cWhere} must be an object.`)
            continue
          }
          for (const k of Object.keys(c)) {
            if (k !== 'id' && k !== 'when' && k !== 'steps') {
              errors.push(`${cWhere}: unknown property "${k}".`)
            }
          }
          requireId((c as Record<string, unknown>).id, cWhere)
          const when = (c as Record<string, unknown>).when
          if (typeof when !== 'string' || when.trim() === '') {
            errors.push(`${cWhere}: "when" must be a non-empty predicate string.`)
          } else if (when.length > DSL_MAX_TEXT_LEN) {
            errors.push(`${cWhere}: "when" exceeds ${DSL_MAX_TEXT_LEN} chars.`)
          }
          const armSteps = (c as Record<string, unknown>).steps
          if (armSteps !== undefined) {
            if (!Array.isArray(armSteps)) {
              errors.push(`${cWhere}: "steps" must be an array when present.`)
            } else {
              for (const s of armSteps) validateStep(s, `${cWhere} step`, true)
            }
          }
        }
      }
      if (step.else !== undefined) {
        if (!Array.isArray(step.else)) {
          errors.push(`${here}: "else" must be an array when present.`)
        } else {
          for (const s of step.else) validateStep(s, `${here} else step`, true)
        }
      }
    }
  }

  if (Array.isArray(root.steps)) {
    for (const s of root.steps) validateStep(s, 'top-level step', false)
  }

  for (let i = 0; i < subProcedures.length; i++) {
    const sp = subProcedures[i]
    const where = `sub-procedure[${i}]`
    if (!isPlainObject(sp)) {
      errors.push(`${where} must be an object.`)
      continue
    }
    const record = sp as Record<string, unknown>
    for (const k of Object.keys(record)) {
      if (k !== 'id' && k !== 'name' && k !== 'steps') {
        errors.push(`${where}: unknown property "${k}".`)
      }
    }
    requireId(record.id, where)
    if (typeof record.name !== 'string' || record.name.trim() === '') {
      errors.push(`${where}: "name" must be a non-empty string.`)
    }
    if (!Array.isArray(record.steps)) {
      errors.push(`${where}: "steps" must be an array.`)
    } else {
      for (const s of record.steps) validateStep(s, `${where} step`, false)
    }
  }

  if (stepCount > DSL_MAX_STEPS) {
    errors.push(`Too many steps (${stepCount} > ${DSL_MAX_STEPS}).`)
  }

  return errors
}

function assertKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  where: string,
  errors: string[]
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) errors.push(`${where}: unknown property "${key}".`)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ── tool JSON Schema ─────────────────────────────────────────────────────────

/**
 * JSON Schema for a {@link ProcedureDsl} `body` parameter. Recursive via `$defs`.
 * The runtime {@link validateProcedureDsl} is authoritative — this schema is the
 * model-facing hint only (providers don't reliably honor `additionalProperties`
 * or `oneOf` discriminants).
 */
export const PROCEDURE_DSL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
  properties: {
    steps: { type: 'array', items: { $ref: '#/$defs/step' } },
    subProcedures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'steps'],
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          steps: { type: 'array', items: { $ref: '#/$defs/step' } },
        },
      },
    },
  },
  $defs: {
    step: {
      type: 'object',
      required: ['id', 'kind'],
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          description: 'Stable id — reuse the id you read for steps you keep unchanged.',
        },
        kind: { enum: ['instruction', 'condition', 'route', 'call', 'opaque'] },
        text: {
          type: 'string',
          description:
            'instruction: the prose. Supports inline `@[tool:x]` / `@[field:e:f]` / `@[entity:e]` chips.',
        },
        outcome: {
          enum: ['finished', 'handoff', 'switch'],
          description: 'route: finished ends the procedure, handoff escalates, switch jumps.',
        },
        switchToProcedureId: {
          type: 'string',
          description:
            'route+switch: id of the procedure to switch to (must be one you were given).',
        },
        subProcedureId: {
          type: 'string',
          description: 'call: id of a declared sub-procedure to run.',
        },
        label: {
          type: 'string',
          description:
            'opaque (read-only): keep this and its id exactly as read; never edit or drop.',
        },
        cases: {
          type: 'array',
          description: 'condition: IF / ELSE-IF arms, evaluated in order.',
          items: {
            type: 'object',
            required: ['id', 'when', 'steps'],
            properties: {
              id: { type: 'string', minLength: 1 },
              when: {
                type: 'string',
                description:
                  'Plain-English test the runtime evaluates, e.g. "the order has shipped".',
              },
              steps: {
                type: 'array',
                description:
                  'Arm body — instruction/route/call steps only. A condition may NOT be nested here; extract nested branching into a sub-procedure and invoke it with a "call" step.',
                items: { $ref: '#/$defs/step' },
              },
            },
          },
        },
        else: {
          type: 'array',
          description:
            'condition: the fallthrough body when no case matches. instruction/route/call steps only — no nested condition (use a sub-procedure + "call").',
          items: { $ref: '#/$defs/step' },
        },
      },
    },
  },
} as const
