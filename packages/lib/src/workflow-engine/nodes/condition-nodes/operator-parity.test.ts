// packages/lib/src/workflow-engine/nodes/condition-nodes/operator-parity.test.ts

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  OPERATOR_DEFINITIONS,
  type OperatorDefinition,
} from '../../../conditions/operator-definitions'
import { ExecutionContextManager } from '../../core/execution-context'
import type { WorkflowNode } from '../../core/types'
import { WorkflowNodeType } from '../../core/types'
import { IfElseProcessor } from './if-else'
import type { NodeCase } from './if-else-types'
import { KNOWN_BROKEN_OPERATORS } from './operator-parity-allowlist'

// Silence the logger. Partial mock: `@auxx/logger/run-log` imports sink-registration
// helpers from this barrel at module load, so a full replacement breaks collection.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE OPERATOR HALF OF THE BUILDER↔ENGINE PARITY SUITE
//
// Modelled on `mail-query/__tests__/condition-query-builder.test.ts:377` — at
// audit time the only assertion in the repo that "everything the UI offers
// actually dispatches", and the only condition surface that had not drifted.
//
// `OPERATOR_DEFINITIONS` is the SINGLE SOURCE OF TRUTH the shared condition
// editor derives its operator menu from (`getOperatorsForFieldType` /
// `getOperatorsForBaseType`, and `TYPE_OPERATOR_MAP` on the engine side). So the
// set the if-else panel offers IS `OPERATOR_DEFINITIONS`, and every member of it
// must reach a real evaluator case.
//
// An operator the evaluator has no case for does NOT error. It falls through to
// `default: return false` — the condition is silently false, the branch never
// fires, and the run looks healthy. That fail-quiet is exactly what this suite
// exists to catch, and it is why "adding an operator" and "implementing an
// operator" have to fail together.
//
// This half lives in `packages/lib` because BOTH sides are here: the registry
// (`conditions/operator-definitions.ts`) and the evaluator
// (`conditions/evaluate-operator.ts`, which if-else dispatches into). The other two halves —
// output variables and config keys — cannot live here, because the builder's
// declarations are in `apps/web` (tier 5) and lib is tier 3.
// See `apps/web/src/components/workflow/parity/`.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The evaluator source the static half reads.
 *
 * Was `./if-else.ts`, which carried its own copy of the nine category evaluators.
 * They now live in `conditions/evaluate-operator.ts` — ONE implementation shared with
 * `conditions/evaluate.ts` (mail views, record rules, procedures, sequences) and the
 * list node's filter. The assertion is unchanged in meaning: the evaluator the if-else
 * node dispatches into must have a case for every operator the registry offers. The
 * behavioural half below still drives the real `IfElseProcessor` end to end.
 */
const EVALUATOR_SOURCE = readFileSync(
  fileURLToPath(new URL('../../../conditions/evaluate-operator.ts', import.meta.url)),
  'utf8'
)

/**
 * `evaluateCondition` routes on `def.category`; each arm calls exactly one
 * method. This is that routing table, restated so a renamed or removed arm
 * shows up here rather than as a silently-false condition in production.
 */
const CATEGORY_EVALUATORS: Record<NonNullable<OperatorDefinition['category']>, string> = {
  equality: 'evaluateEqualityOperator',
  comparison: 'evaluateComparisonOperator',
  string: 'evaluateStringOperator',
  set: 'evaluateSetOperator',
  existence: 'evaluateExistenceOperator',
  file: 'evaluateFileOperator',
  date: 'evaluateDateOperator',
  array: 'evaluateArrayOperator',
  object: 'evaluateObjectOperator',
}

/**
 * Slice out a method body by brace-matching from its declaration.
 *
 * Deliberately textual rather than AST-based: the only thing asserted about the
 * body is which `case '<operator>':` labels it carries, and a regex over the
 * sliced text answers that without adding a parser dependency to `packages/lib`.
 * Limitation worth knowing: a `case` label inside a nested switch in the same
 * method would also count. None of the nine evaluators nest a switch today, and
 * a false PASS here is caught by the behavioural suite below anyway.
 */
function methodBody(source: string, methodName: string): string {
  // Anchored at line start so this matches the DECLARATION and not the first
  // `this.<method>(` call site — which for `evaluateCondition` appears earlier
  // in the file than its own declaration does.
  const declaration = new RegExp(
    `^[ \\t]*(?:export )?(?:private |protected |public )?(?:async )?(?:function )?${methodName}\\s*\\(`,
    'm'
  ).exec(source)
  if (!declaration) throw new Error(`${methodName} is not declared in evaluate-operator.ts`)

  // Walk the parameter list first — the body `{` is the first brace AFTER it.
  let index = source.indexOf('(', declaration.index)
  let parens = 0
  for (; index < source.length; index++) {
    if (source[index] === '(') parens++
    else if (source[index] === ')') {
      parens--
      if (parens === 0) break
    }
  }

  const open = source.indexOf('{', index)
  if (open === -1) throw new Error(`${methodName} has no body`)

  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${methodName}`)
}

/** Every `case '<literal>':` label in a method body. */
function caseLabels(body: string): Set<string> {
  return new Set(Array.from(body.matchAll(/case\s+'([^']*)'\s*:/g), (m) => m[1] as string))
}

const OPERATORS = Object.values(OPERATOR_DEFINITIONS) as OperatorDefinition[]

// ───────────────────────────────────────────────────────────────────────────
// Behavioural fixtures
//
// A `case` label proves dispatch; it does not prove the operator WORKS. Each
// operator therefore also gets an input pair for which a correct implementation
// must return `true`. `null` means "no input can make this operator true" —
// which is itself the drift signal, not a gap in the fixtures.
//
// The table is exhaustive by assertion: a new key in `OPERATOR_DEFINITIONS`
// with no entry here fails the suite, so adding an operator forces someone to
// state what a passing comparison looks like.
// ───────────────────────────────────────────────────────────────────────────

type Fixture = { value: unknown; target?: unknown }

const file = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'f1',
  fileId: 'f1',
  assetId: 'a1',
  versionId: 'v1',
  filename: 'report-2024-01-05-v2.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  url: 'https://example.com/report.pdf',
  nodeId: 'n1',
  uploadedAt: new Date(),
  ...over,
})

const todayIso = () => new Date().toISOString()
const daysAgoIso = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

const TRUE_FIXTURES: Record<string, Fixture | null> = {
  // equality
  is: { value: 'shipped', target: 'shipped' },
  'is not': { value: 'shipped', target: 'pending' },
  // 🔴 Scope pseudo-operators from the mail search bar. They carry
  // `supportedFieldTypes: ['SCOPE']` and an EMPTY `supportedTypes`, so no
  // workflow variable type ever offers them — but they are in the same
  // registry the if-else panel reads, and `category: 'equality'` routes them
  // into an evaluator with no case for either. Nothing can make them true.
  this_mailbox: null,
  everywhere: null,

  // comparison
  '>': { value: 5, target: 3 },
  '<': { value: 3, target: 5 },
  '>=': { value: 5, target: 5 },
  '<=': { value: 5, target: 5 },

  // string
  contains: { value: 'hello world', target: 'world' },
  'not contains': { value: 'hello world', target: 'goodbye' },
  'starts with': { value: 'hello world', target: 'hello' },
  'ends with': { value: 'hello world', target: 'world' },

  // set
  in: { value: 'open', target: ['open', 'pending'] },
  'not in': { value: 'closed', target: ['open', 'pending'] },

  // date
  before: { value: '2020-01-01T00:00:00Z', target: '2021-01-01T00:00:00Z' },
  after: { value: '2021-01-01T00:00:00Z', target: '2020-01-01T00:00:00Z' },
  within_days: { value: daysAgoIso(2), target: 5 },
  older_than_days: { value: daysAgoIso(10), target: 5 },
  today: { value: todayIso() },
  yesterday: { value: daysAgoIso(1) },
  this_week: { value: todayIso() },
  this_month: { value: todayIso() },
  on_date: { value: todayIso(), target: todayIso() },
  not_on_date: { value: todayIso(), target: '2000-01-01T00:00:00Z' },

  // existence
  empty: { value: '' },
  'not empty': { value: 'something' },

  // file
  is_valid: { value: file() },
  is_invalid: { value: file({ url: '' }) },
  uploaded_today: { value: file() },
  uploaded_within_days: { value: file(), target: 5 },
  matches_pattern: { value: file(), target: 'report' },
  contains_numbers: { value: file() },
  contains_date: { value: file() },
  has_version: { value: file() },
  is_office_document: { value: file({ filename: 'quarterly.docx' }) },
  is_image_format: { value: file({ filename: 'photo.png' }) },
  is_text_format: { value: file({ filename: 'notes.txt' }) },
  is_compressed: { value: file({ filename: 'archive.zip' }) },
  is_executable: { value: file({ filename: 'setup.exe' }) },
  // Size limits are expressed in MB (`isWithinSizeLimit` multiplies by 1024²).
  within_size_limit: { value: file({ size: 1024 }), target: 1 },
  exceeds_limit: { value: file({ size: 5 * 1024 * 1024 }), target: 1 },

  // array
  'length =': { value: [1, 2], target: 2 },
  'length >': { value: [1, 2], target: 1 },
  'length <': { value: [1, 2], target: 3 },
  'length >=': { value: [1, 2], target: 2 },
  'length <=': { value: [1, 2], target: 2 },

  // object
  'has key': { value: { orderId: '1012' }, target: 'orderId' },
  'key equals': { value: { status: 'paid' }, target: 'status:paid' },
}

/** Run one condition through the real processor, exactly as the engine does. */
async function evaluateOne(operator: string, fixture: Fixture): Promise<boolean> {
  const processor = new IfElseProcessor()
  const contextManager = new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', 'user-1')
  contextManager.setVariable('subject.value', fixture.value)

  const cases: NodeCase[] = [
    {
      id: 'c1',
      case_id: 'true',
      logical_operator: 'and',
      conditions: [
        {
          id: 'cond',
          variableId: 'subject.value',
          comparison_operator: operator as NodeCase['conditions'][number]['comparison_operator'],
          value: fixture.target as NodeCase['conditions'][number]['value'],
        },
      ],
    },
  ]

  const node = {
    id: 'node-1',
    workflowId: 'workflow-1',
    nodeId: 'gate-1',
    type: WorkflowNodeType.IF_ELSE,
    name: 'Gate',
    data: { id: 'gate-1', type: WorkflowNodeType.IF_ELSE, title: 'Gate', cases },
  } as unknown as WorkflowNode

  const preprocessed = await processor.preprocessNode(node, contextManager)
  const result = await processor.execute(node, contextManager, preprocessed)
  return result.output?.matched === true
}

// ───────────────────────────────────────────────────────────────────────────
// Allowlist plumbing — shared discipline with the web half.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Diff the observed failure set against the allowlist and fail on EITHER side.
 *
 * - A failure not in the allowlist is new drift.
 * - An allowlist entry that no longer fails is stale: the bug is fixed and the
 *   line has to go, or the list grows forever and stops meaning anything.
 */
function assertAgainstAllowlist(observed: Map<string, string>, allowlist: Record<string, string>) {
  if (process.env.WORKFLOW_PARITY_PRINT_ALLOWLIST) {
    const literal = Array.from(observed.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, detail]) => `  ${JSON.stringify(key)}: ${JSON.stringify(detail)},`)
      .join('\n')
    console.log(`\n// regenerated allowlist\n{\n${literal}\n}\n`)
  }

  const unexpectedFailures = Array.from(observed.keys())
    .filter((key) => !(key in allowlist))
    .sort()
  const unexpectedPasses = Object.keys(allowlist)
    .filter((key) => !observed.has(key))
    .sort()

  // Keyed so a failure names the exact entries rather than printing two sets.
  expect({ unexpectedFailures, unexpectedPasses }).toEqual({
    unexpectedFailures: [],
    unexpectedPasses: [],
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// The suite
// ═══════════════════════════════════════════════════════════════════════════

describe('operator parity — every offered operator dispatches', () => {
  it('routes every category the registry declares', () => {
    // The `switch (def.category)` in `evaluateCondition` is the only routing
    // step. A category with no arm hits `default: return false` and takes every
    // operator in it down at once — the widest possible version of this bug.
    const routing = methodBody(EVALUATOR_SOURCE, 'evaluateOperator')
    const declared = new Set(OPERATORS.map((op) => op.category))

    expect(Array.from(declared).sort()).toEqual(
      Array.from(declared)
        .filter((category) => category && routing.includes(`case '${category}':`))
        .sort()
    )
  })

  it('declares a category for every operator', () => {
    // `category` is optional on `OperatorDefinition`. An operator without one
    // falls straight through the routing switch — dead on arrival.
    const uncategorised = OPERATORS.filter((op) => !op.category).map((op) => op.key)
    expect(uncategorised).toEqual([])
  })

  it('has a behavioural fixture for every operator in the registry', () => {
    // Forces the fixture table to stay exhaustive: a new operator cannot be
    // added to the registry without stating what a passing comparison is (or
    // declaring, with `null`, that none exists).
    const missing = OPERATORS.map((op) => op.key).filter((key) => !(key in TRUE_FIXTURES))
    expect(missing).toEqual([])
  })

  it('implements every operator in the evaluator for its declared category', () => {
    // Static half: the `case` label must exist in the method the category
    // routes to. Cheap, and it names the operator AND the method it is missing
    // from, which is what you need to fix it.
    const bodies = new Map(
      Object.entries(CATEGORY_EVALUATORS).map(([category, method]) => [
        category,
        caseLabels(methodBody(EVALUATOR_SOURCE, method)),
      ])
    )

    const observed = new Map<string, string>()
    for (const op of OPERATORS) {
      if (!op.category) continue
      const labels = bodies.get(op.category)
      if (!labels?.has(op.key)) {
        observed.set(
          `operator:${op.key}`,
          `no case in ${CATEGORY_EVALUATORS[op.category]} (category "${op.category}")`
        )
      }
    }

    assertAgainstAllowlist(observed, KNOWN_BROKEN_OPERATORS)
  })

  it('evaluates every operator to true for an input that should match', async () => {
    // Behavioural half: a `case` label that computes the wrong thing still
    // passes the static check. This one runs the real processor end to end
    // (preprocess → execute), so it also covers value resolution, category
    // routing and the `default: return false` fall-through in one go.
    const observed = new Map<string, string>()

    for (const op of OPERATORS) {
      const fixture = TRUE_FIXTURES[op.key]
      if (fixture === null || fixture === undefined) {
        observed.set(`operator:${op.key}`, 'no input can make this operator match')
        continue
      }
      const matched = await evaluateOne(op.key, fixture)
      if (!matched) {
        observed.set(
          `operator:${op.key}`,
          `evaluated false for a matching input (${JSON.stringify(fixture.value)} / ${JSON.stringify(fixture.target)})`
        )
      }
    }

    assertAgainstAllowlist(observed, KNOWN_BROKEN_OPERATORS)
  })
})
