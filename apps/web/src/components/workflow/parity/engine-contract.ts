// apps/web/src/components/workflow/parity/engine-contract.ts

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Static reader for the workflow ENGINE's side of the builder↔engine contract.
 *
 * The engine lives in `packages/lib` (tier 3) and the builder's declarations in
 * `apps/web` (tier 5). lib must never import upward, so the parity test lives
 * here — and here we cannot *execute* a processor (they pull in bullmq, redis,
 * the database and live AI providers). What we can do is read their source.
 *
 * ── WHAT THIS EXTRACTION SEES ───────────────────────────────────────────────
 *  - `contextManager.setNodeVariable(<any>, '<literal>', ...)` and the bulk
 *    `setNodeVariables(<any>, { ... })` — together the ONLY ways a value becomes
 *    addressable as `<nodeId>.<path>` downstream. `result.output`
 *    is stored on the node-execution row for the trace UI; nothing promotes it
 *    into the variable store (`workflow-engine.ts` only ever copies it into
 *    `nodeResults[].output` / `nodeExecutions[].outputs`). A variable the
 *    builder advertises that the engine only puts in `output` is unreachable.
 *  - Template literals, captured with their `${...}` holes intact, so
 *    `tool_${index}` is recorded as a pattern and matched on its literal stem.
 *  - `node.data.<key>` reads, including through a local alias
 *    (`const config = node.data as WaitNodeConfig` then `config.durationUnit`).
 *  - Reads that reach `.data.<key>` through a node pulled out of the GRAPH
 *    rather than through the processor's own `node`. Those go to
 *    `foreignDataReads`, not `dataReads` — see `foreignNodeBindings`.
 *  - Inherited writes: `AIProcessorV2 extends BaseAiNodeProcessor`, so the
 *    base's `output` / `text` / `structured_output` writes count for `ai`.
 *    Inherited READS additionally carry the ancestor file they came from, in
 *    `inheritedDataReads` — see `withInherited`.
 *  - Whether every call site for a path sits inside an `else` block — see
 *    `failurePathOnlyWrites`.
 *
 * ── WHAT IT CANNOT SEE ──────────────────────────────────────────────────────
 *  - Dynamically-computed paths: `setNodeVariable(nodeId, key, value)` inside a
 *    loop over a runtime object. These are recorded as `dynamicWrites` (the
 *    expression text) but are NOT treated as satisfying any advertised path —
 *    one dynamic write would otherwise whitewash a whole node. Where a dynamic
 *    write genuinely covers an advertised path (`information-extractor`'s
 *    per-field `extracted_data.*`, which is anyway covered by the literal
 *    `extracted_data` prefix) that belongs in the allowlist's
 *    `EXTRACTION_BLIND_SPOTS` map with a reason, not here.
 *  - A bulk `setNodeVariables` payload that is a spread, a function call or a
 *    parameter rather than a resolvable object literal. Those are reported as
 *    `unresolvedBulkWrites` so a caller can say "this node may well write it, I
 *    just cannot see the keys" instead of filing it as drift.
 *  - Nested config keys read through a helper's parameter:
 *    `executeFilter(list, node.data.filterConfig)` then `config.logic`. Only the
 *    TOP-LEVEL key (`filterConfig`) is seen, so the config-key assertion is a
 *    floor, not a ceiling.
 *  - Anything written outside `packages/lib/src/workflow-engine/`. A node's
 *    variables are not always published by its own processor —
 *    `human-confirmation`'s are written by `core/workflow-engine.ts` on resume,
 *    and `loop`'s iterator variables by `core/loop-context-extensions.ts` (the
 *    one case wired up explicitly, via `EXTRA_ENGINE_SOURCES`).
 *
 * ── 🔴 THE HOLE IN THE NET: REACHABILITY ────────────────────────────────────
 * This reader is textual, so it knows a `setNodeVariable(s)` call EXISTS in a
 * file. It does not know whether that call is reachable on the path production
 * actually takes. Seeing the call is treated as proof of the write, and that is
 * an over-approximation: this assertion can pass on a write that never runs.
 *
 * It has already bitten once. `human-confirmation.ts` published its five
 * decision variables from `handleTestMode` — so the builder's test runs were
 * fine while production, which resumes through `WorkflowEngine.resumeExecution`
 * and never re-enters the processor, wrote nothing. A reader that merely saw the
 * call would have handed production a pass it had not earned. (That specific gap
 * is closed — `workflow-engine.ts:2160` now publishes on resume — but the blind
 * spot that hid it is structural and is still here.)
 *
 * Closing it needs reachability analysis from each processor entry point, which
 * is a different tool than this. Until then: when a node's variables come from
 * one call site, open it and check WHICH branch it is on. The behavioural
 * operator suite in `packages/lib` does not have this problem — it runs the real
 * processor — and that is the shape to reach for when a contract matters enough.
 *
 * Two more structural limits of the same family, both now DETECTED rather than
 * silently mis-attributed — detection is not a fix, so they still need a human
 * to read the source before an entry is filed:
 *
 *  1. WHICH NODE a `.data` read targets. A processor can pull another node out
 *     of `sys.workflow.graph.nodes` and read that node's config — `manual.ts`
 *     does exactly this for the connected form-input node's `inputType` /
 *     `typeOptions` / `label`. Resolving the target statically needs the graph,
 *     which only exists at run time. `foreignNodeBindings` finds the LOCAL such
 *     a read goes through and routes it to `foreignDataReads`, so the finding
 *     carries a NOTE instead of quietly scoring against the wrong panel.
 *
 *  2. WHICH FILE an inherited read lives in. `withInherited` unions a class's
 *     reads with every ancestor's, so one legacy read on a shared base surfaces
 *     once per subclass and reads as N bugs. `inheritedDataReads` names the
 *     ancestor file, which collapses those N back into one.
 *
 * A third, still open and NOT detected: which CONFIG a node was evaluated under.
 * `outputVariables` is a function of `node.data`, so a branch the default config
 * never reaches advertises nothing and is never checked. That is what
 * `CONFIG_VARIANTS` in `node-definitions.ts` exists for, and it is hand-written —
 * a missing variant is an assertion that silently never runs. `manual.inputs`
 * was real drift hidden that way for the whole first pass of the burn-down.
 */

/** Walk up from this file until the monorepo root (the one with `packages/lib`). */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!existsSync(join(dir, 'packages', 'lib', 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error('could not locate the monorepo root')
    dir = parent
  }
  return dir
}

const ENGINE_ROOT = join(repoRoot(), 'packages/lib/src/workflow-engine')
const BUILDER_ROOT = join(repoRoot(), 'apps/web/src/components/workflow/nodes')

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) listSources(full, out)
    else if (full.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(full)) out.push(full)
  }
  return out
}

/**
 * Strip comments before scanning.
 *
 * Not cosmetic: `form-input-processor.ts` documents `setNodeVariable(` inside a
 * JSDoc block, and without this the scanner reads the prose that follows it as
 * an argument list.
 *
 * Offsets are preserved (comments are blanked, not removed) because the
 * `else`-block analysis below compares call-site offsets against block spans.
 */
function stripComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ')
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead: string) => lead + blank(_m.slice(lead.length)))
}

/** Parse `enum X { A = 'a', ... }` out of a source file: member name -> value. */
function parseEnum(source: string, name: string): Record<string, string> {
  const start = source.indexOf(`enum ${name} {`)
  if (start === -1) throw new Error(`enum ${name} not found in core/types.ts`)
  const end = source.indexOf('\n}', start)
  const body = source.slice(start, end)
  return Object.fromEntries(
    Array.from(body.matchAll(/(\w+)\s*=\s*'([^']*)'/g), (m) => [m[1] as string, m[2] as string])
  )
}

const CORE_TYPES = stripComments(readFileSync(join(ENGINE_ROOT, 'core/types.ts'), 'utf8'))

/**
 * `WorkflowNodeType` is not an enum — it is `{ ...WorkflowTriggerType,
 * ...WorkflowActionType }`, so a member reference has to be resolved against
 * both. `WorkflowActionType` is kept separate as well because several dataset
 * processors declare `readonly type = WorkflowActionType.X`.
 */
const ACTION_TYPE_VALUES = parseEnum(CORE_TYPES, 'WorkflowActionType')
const TRIGGER_TYPE_VALUES = parseEnum(CORE_TYPES, 'WorkflowTriggerType')
const NODE_TYPE_VALUES = { ...TRIGGER_TYPE_VALUES, ...ACTION_TYPE_VALUES }

/**
 * Engine files whose `setNodeVariable` calls target a node type OTHER than the
 * one the class in that file declares.
 *
 * Hand-maintained and deliberately tiny. The loop ITERATOR variables are
 * published by the execution context, not by `LoopProcessor` — `loop.ts` only
 * publishes the loop's summary outputs, and the audit confirmed the iterator
 * half (`item` / `index` / `count` / `total` / `isFirst` / `isLast`) works,
 * nested loops included. Without this entry the working half reads as drift.
 */
const EXTRA_ENGINE_SOURCES: Record<string, string[]> = {
  loop: ['core/loop-context-extensions.ts'],
  // A form-input node WIRED INTO A TRIGGER is NON_EXECUTABLE — its own processor
  // never runs (`form-input/form-input-processor.ts:83`). The manual trigger
  // publishes that node's variables instead, keyed by the FORM-INPUT node's id
  // (`trigger-nodes/manual.ts`: `setFileVariables(nodeId, …)` and
  // `applyFormInputOutputVariables({ nodeId, … })` over `Object.entries(triggerData)`).
  // Without this, `fileCount` — which only manual.ts writes; the processor's own
  // multi-file arm writes `files.count` — reads as drift on a variable that is in
  // fact populated on the only path that runs.
  //
  // The cost is over-attribution: manual.ts's own `timestamp` / `userId` /
  // `inputs` are folded in too. Bounded and acceptable here because `form-input`
  // advertises none of them; it would NOT be acceptable for a large shared file,
  // which is why `human-confirmation` is a blind-spot entry instead.
  'form-input': ['nodes/trigger-nodes/manual.ts'],
}

export interface EngineNodeContract {
  /** Engine source files attributed to this node type, engine-root-relative. */
  files: string[]
  /**
   * Literal variable paths the engine writes — from `setNodeVariable` (one path
   * per call) and from the resolvable keys of `setNodeVariables` (bulk).
   * Includes template-literal patterns.
   */
  writes: string[]
  /** Paths whose every call site sits inside an `else` block. */
  failurePathOnlyWrites: string[]
  /** Argument expressions for `setNodeVariable` calls with a computed path. */
  dynamicWrites: string[]
  /**
   * `setNodeVariables` payloads whose keys could not be read statically — a
   * spread, a function call, or a parameter. Any advertised path this node fails
   * on may in fact be written by one of these, so such findings belong in the
   * blind-spot map, never in the burn-down list.
   */
  unresolvedBulkWrites: string[]
  /** Top-level `node.data.<key>` reads, including via a local alias. */
  dataReads: string[]
  /**
   * Reads that reach `.data.<key>` through a local bound to a node pulled OUT of
   * the graph, not through the processor's own `node` parameter. Key -> the
   * expression the local was bound from. See `foreignNodeBindings`.
   */
  foreignDataReads: Record<string, string>
  /**
   * Reads contributed by an ANCESTOR class rather than by this node's own file.
   * Key -> the engine-root-relative path of the file that actually contains the
   * read. See `withInherited`.
   */
  inheritedDataReads: Record<string, string>
  /** Whether a processor for this type is constructed in `initializeWithDefaults`. */
  registered: boolean
}

interface FileFacts {
  path: string
  className?: string
  superClass?: string
  nodeTypeValues: string[]
  writes: string[]
  failurePathOnly: string[]
  dynamicWrites: string[]
  unresolvedBulkWrites: string[]
  dataReads: string[]
  foreignDataReads: Record<string, string>
}

/**
 * Framework keys every node carries. They are written by the node factory and
 * the canvas, never by a config panel, so an engine read of one is not
 * "unwritten config".
 */
const FRAMEWORK_DATA_KEYS = new Set([
  'id',
  'type',
  'title',
  'desc',
  'description',
  'label',
  'icon',
  'color',
  'isValid',
  'errors',
  'disabled',
  'selected',
  'collapsed',
  'outputVariables',
  'credentialId',
  'errorStrategy',
  'retryConfig',
  'isInLoop',
  'loopId',
  'isInIteration',
  'iterationId',
])

/**
 * Walk a balanced construct from its opening bracket and return the index of the
 * matching closer, skipping over string and template literals.
 */
function matchBracket(source: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const stack: string[] = []
  for (let i = open; i < source.length; i++) {
    const ch = source[i] as string
    if (ch === "'" || ch === '"' || ch === '`') {
      // Skip the literal wholesale; an unescaped closer inside one would
      // otherwise unbalance the walk.
      for (i++; i < source.length; i++) {
        if (source[i] === '\\') i++
        else if (source[i] === ch) break
      }
      continue
    }
    if (pairs[ch]) stack.push(pairs[ch] as string)
    else if (ch === ')' || ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}

/** Split a call's argument list into top-level expression strings. */
function callArguments(source: string, openParen: number): string[] {
  const close = matchBracket(source, openParen)
  if (close === -1) return []
  const inner = source.slice(openParen + 1, close)

  const args: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] as string
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i++; i < inner.length; i++) {
        if (inner[i] === '\\') i++
        else if (inner[i] === ch) break
      }
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      args.push(inner.slice(start, i).trim())
      start = i + 1
    }
  }
  args.push(inner.slice(start).trim())
  return args.map((a) => a.trim()).filter((a) => a.length > 0)
}

/**
 * Read the literal property names of an object-literal expression.
 *
 * Only depth-1 keys count, and both `identifier:` and `'quoted.path':` forms are
 * collected — `manual.ts` publishes `'file.id'` / `'file.filename'` as quoted
 * DOTTED keys, and those are real advertised paths, not decoration.
 *
 * `hasSpread` reports a depth-1 `...` — the spread's keys are unknowable from
 * source, so the object is only PARTIALLY readable and the caller must record
 * the gap rather than treat the literal as exhaustive.
 */
function objectLiteralKeys(expression: string): { keys: string[]; hasSpread: boolean } {
  const open = expression.indexOf('{')
  const close = open === -1 ? -1 : matchBracket(expression, open)
  if (open === -1 || close === -1) return { keys: [], hasSpread: false }

  const inner = expression.slice(open + 1, close)
  const keys: string[] = []
  let hasSpread = false
  let depth = 0

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] as string
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      const start = i + 1
      for (i++; i < inner.length; i++) {
        if (inner[i] === '\\') i++
        else if (inner[i] === quote) break
      }
      if (depth === 0 && quote !== '`') {
        // A quoted key is one whose literal is immediately followed by `:`.
        const after = inner.slice(i + 1).match(/^\s*:/)
        if (after) keys.push(inner.slice(start, i))
      }
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (depth === 0 && ch === '.' && inner.startsWith('...', i)) {
      hasSpread = true
      i += 2
    }
  }

  // Unquoted keys: only those at depth 1 of the literal, i.e. preceded by the
  // opening brace or a top-level comma.
  let scanDepth = 0
  let atKeyPosition = true
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] as string
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i++; i < inner.length; i++) {
        if (inner[i] === '\\') i++
        else if (inner[i] === ch) break
      }
      atKeyPosition = false
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') {
      scanDepth++
      continue
    }
    if (ch === ')' || ch === '}' || ch === ']') {
      scanDepth--
      continue
    }
    if (ch === ',' && scanDepth === 0) {
      atKeyPosition = true
      continue
    }
    if (/\s/.test(ch)) continue
    if (scanDepth === 0 && atKeyPosition) {
      const rest = inner.slice(i)
      const key = /^([A-Za-z_$][\w$]*)\s*:/.exec(rest)
      if (key) keys.push(key[1] as string)
      atKeyPosition = false
    }
  }

  return { keys: Array.from(new Set(keys)), hasSpread }
}

/**
 * Resolve a bulk-write payload identifier one hop back to its `const` object
 * literal in the same file.
 *
 * `loop.ts` is exactly this shape: `const output = { totalIterations, … }`
 * followed by `setNodeVariables(node.nodeId, output)` twenty lines later. One hop
 * is all that is attempted — a parameter (`wait-processor.ts`'s
 * `publishWaitOutputs(node, cm, output)`) or a function call
 * (`buildApprovalDecisionVariables(…)`) is reported as unresolved instead of
 * guessed at.
 */
function resolveLocalObject(
  source: string,
  identifier: string,
  before: number
): { keys: string[]; hasSpread: boolean } | undefined {
  const pattern = new RegExp(`(?:const|let)\\s+${identifier}\\b[^=\\n]*=\\s*\\{`, 'g')
  let best: number | undefined
  for (const m of source.matchAll(pattern)) {
    const index = m.index ?? 0
    if (index < before) best = index
  }
  if (best === undefined) return undefined
  return objectLiteralKeys(source.slice(best))
}

/**
 * Locals bound to a node pulled OUT of the workflow graph, rather than to the
 * processor's own `node` parameter. Identifier -> the binding expression.
 *
 * This is the fix for a real mis-file. `manual.ts` reads `inputType` /
 * `typeOptions` / `label` off the connected FORM-INPUT node it fetches from
 * `sys.workflow.graph.nodes` — three keys the form-input panel declares and
 * writes. The reader attributed them to `manual`, whose panel of course declares
 * none of them, and two of the three were filed as `manual` config drift. They
 * were never drift; they were a read of a different node's data.
 *
 * The binding shapes that occur in the engine today, all rooted at a `nodes`
 * collection or a `.graph.nodes` access:
 *   `const x = nodes.find(…)` / `.filter(…)[0]` / `nodes[i]`
 *   `for (const x of nodes)` / `nodes.map((x) => …)`
 *
 * Note what this does NOT do: it does not resolve WHICH node type the local
 * holds. Statically that needs the graph, which only exists at run time. So a
 * read through one of these is reported, not dropped — with a `NOTE:` telling
 * whoever regenerates the allowlist to open the file before filing it as drift.
 * Dropping it would be worse: an unread key is a silent hole, and this reader's
 * whole job is to have no silent holes.
 */
function foreignNodeBindings(source: string): Record<string, string> {
  const bindings: Record<string, string> = {}
  // `nodes`, `graph?.nodes`, `workflow.graph.nodes`, `transformedNodes`, …
  const collection = '(?:[\\w.?]*[Nn]odes)\\b'

  // `const x = nodes.find(...)`, `= graph?.nodes[0]`, `= workflow.nodes.at(i)`
  for (const m of source.matchAll(
    new RegExp(
      `(?:const|let)\\s+(\\w+)\\s*(?::[^=]*)?=\\s*(?:await\\s+)?${collection}\\s*\\??\\.?\\s*(?:\\.(?:find|at)\\s*\\(|\\[)`,
      'g'
    )
  )) {
    bindings[m[1] as string] = (m[0] as string).trim()
  }

  // `for (const x of nodes)` / `for (const [, x] of nodes)`
  for (const m of source.matchAll(
    new RegExp(
      `for\\s*\\(\\s*(?:const|let)\\s+(?:\\[\\s*[\\w,\\s]*?(\\w+)\\s*\\]|(\\w+))\\s+of\\s+${collection}\\b`,
      'g'
    )
  )) {
    bindings[(m[1] ?? m[2]) as string] = (m[0] as string).trim()
  }

  // `nodes.map((x) => …)` / `nodes.filter((x) => …)` / `.forEach((x) => …)`
  for (const m of source.matchAll(
    new RegExp(
      `${collection}\\s*\\??\\.\\s*(?:map|filter|forEach|find|some|every)\\s*\\(\\s*\\(?\\s*(\\w+)`,
      'g'
    )
  )) {
    bindings[m[1] as string] = (m[0] as string).trim()
  }

  return bindings
}

/** Character spans of every `else { ... }` block in a source file. */
function elseBlockSpans(source: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const m of source.matchAll(/\belse\s*\{/g)) {
    const open = source.indexOf('{', m.index ?? 0)
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) {
          spans.push([open, i])
          break
        }
      }
    }
  }
  return spans
}

function scanFile(path: string): FileFacts {
  const source = stripComments(readFileSync(path, 'utf8'))
  const elseSpans = elseBlockSpans(source)
  const inElse = (offset: number) => elseSpans.some(([a, b]) => offset > a && offset < b)

  const classMatch = /export\s+(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/.exec(source)

  const nodeTypeValues: string[] = []
  for (const m of source.matchAll(
    /readonly\s+type\s*(?::[^=]+)?=\s*(?:(WorkflowNodeType|WorkflowActionType)\.(\w+)|'([^']+)')/g
  )) {
    if (m[3]) {
      nodeTypeValues.push(m[3])
      continue
    }
    const table = m[1] === 'WorkflowActionType' ? ACTION_TYPE_VALUES : NODE_TYPE_VALUES
    const value = table[m[2] as string]
    if (value) nodeTypeValues.push(value)
  }

  const writes: string[] = []
  const dynamicWrites: string[] = []
  // A path is failure-path-only when EVERY call site for it is inside an
  // `else`. Tracked as two sets so a path written in both arms clears itself.
  const anywhere = new Set<string>()
  const onlyElse = new Set<string>()
  for (const m of source.matchAll(/setNodeVariable\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,/gs)) {
    const arg = (m[2] as string).trim()
    const literal =
      /^'[^']*'$/.test(arg) || /^"[^"]*"$/.test(arg) || /^`[^`]*`$/.test(arg)
        ? arg.slice(1, -1)
        : undefined
    if (literal === undefined) {
      dynamicWrites.push(arg)
      continue
    }
    writes.push(literal)
    if (inElse(m.index ?? 0)) onlyElse.add(literal)
    else anywhere.add(literal)
  }

  // ── The BULK writer ──────────────────────────────────────────────────────
  // `setNodeVariables(nodeId, { … })` (execution-context.ts:282) fans a whole
  // record out through `setNodeVariable`, one entry at a time. Reading only the
  // singular form made every node that publishes in bulk — loop, wait, manual,
  // human-confirmation — look like it advertised outputs it never wrote, which
  // is the opposite of the truth and the worst possible thing for a burn-down
  // list to say. Three resolutions are attempted, in order:
  //   1. an inline object literal      → its depth-1 keys
  //   2. a bare identifier             → one hop back to `const x = { … }`
  //   3. anything else                 → recorded as UNRESOLVED, never as drift
  // The `s` in `setNodeVariables` is why the singular regex above does not also
  // match these: it requires `(` immediately after `setNodeVariable`.
  const unresolvedBulkWrites: string[] = []
  for (const m of source.matchAll(/setNodeVariables\s*\(/g)) {
    const openParen = source.indexOf('(', m.index ?? 0)
    const payload = callArguments(source, openParen)[1]
    if (!payload) {
      unresolvedBulkWrites.push('<unparseable setNodeVariables call>')
      continue
    }

    let resolved: { keys: string[]; hasSpread: boolean } | undefined
    if (payload.startsWith('{')) resolved = objectLiteralKeys(payload)
    else if (/^[A-Za-z_$][\w$]*$/.test(payload)) {
      resolved = resolveLocalObject(source, payload, m.index ?? 0)
    }

    if (!resolved) {
      unresolvedBulkWrites.push(payload)
      continue
    }
    // A spread contributes keys nobody can name from source, so the literal is
    // only PARTIALLY read: take what is there and record the remainder as a gap.
    if (resolved.hasSpread) unresolvedBulkWrites.push(`${payload} (spread)`)
    for (const key of resolved.keys) {
      writes.push(key)
      if (inElse(m.index ?? 0)) onlyElse.add(key)
      else anywhere.add(key)
    }
  }

  // `const config = node.data as WaitNodeConfig` / `const data = node.data`.
  // The negative lookahead is load-bearing: without it
  // `const config = node.data.filterConfig` also binds `config` to the whole of
  // `node.data`, and every `config.<key>` read inside the helper then reports as
  // a missing TOP-LEVEL key. That turned one real finding into fifty phantoms.
  const aliases = new Set(
    Array.from(
      source.matchAll(/(?:const|let)\s+(\w+)\s*(?::[^=]*)?=\s*node\.data\b(?!\s*\??\.)/g),
      (m) => m[1] as string
    )
  )
  // Locals holding a node fetched out of the graph. A read through one of these
  // is about SOME OTHER node, so it must not be scored against this processor's
  // own panel — it is collected separately and reported with a NOTE.
  const foreign = foreignNodeBindings(source)

  const dataReads = new Set<string>()
  const foreignDataReads: Record<string, string> = {}
  const record = (key: string, binding: string | undefined) => {
    if (binding) foreignDataReads[key] = binding
    else dataReads.add(key)
  }

  // `node` itself can be the foreign binding — `for (const node of graph.nodes)`
  // shadows the processor's own parameter, and `form-input-validator.ts` is
  // exactly that shape. When it is, every `node.data.<key>` read in the file is
  // suspect, because the reader has no scopes to tell the two apart.
  for (const m of source.matchAll(/node\.data\??\.(\w+)/g)) record(m[1] as string, foreign.node)
  for (const alias of aliases) {
    // The lookbehind keeps `t.config?.enabledTools` (a TOOLSET's config, not the
    // node's) from being read as `node.data.enabledTools` when the alias happens
    // to be named `config`.
    for (const m of source.matchAll(new RegExp(`(?<![.\\w])${alias}\\??\\.(\\w+)`, 'g'))) {
      record(m[1] as string, foreign.node)
    }
  }
  for (const [identifier, binding] of Object.entries(foreign)) {
    if (identifier === 'node') continue // already handled above
    for (const m of source.matchAll(
      new RegExp(`(?<![.\\w])${identifier}\\??\\.data\\??\\.(\\w+)`, 'g')
    )) {
      const key = m[1] as string
      // A key the processor also reads off its OWN node is not a foreign read.
      if (!dataReads.has(key)) foreignDataReads[key] = binding
    }
  }

  const ownKeys = Array.from(dataReads).filter((key) => !FRAMEWORK_DATA_KEYS.has(key))
  return {
    path,
    className: classMatch?.[1],
    superClass: classMatch?.[2],
    nodeTypeValues,
    writes,
    failurePathOnly: Array.from(onlyElse).filter((path) => !anywhere.has(path)),
    dynamicWrites,
    unresolvedBulkWrites,
    dataReads: ownKeys,
    foreignDataReads: Object.fromEntries(
      Object.entries(foreignDataReads).filter(
        ([key]) => !FRAMEWORK_DATA_KEYS.has(key) && !ownKeys.includes(key)
      )
    ),
  }
}

let cached: Map<string, EngineNodeContract> | undefined

/**
 * Read the engine's contract for every node type it declares a processor for.
 *
 * Keyed by the node-type STRING (`'if-else'`, `'wait'`, ...) — the same value
 * the builder's `NodeType` enum carries, which is what makes the two sides
 * comparable at all.
 */
export function readEngineContracts(): Map<string, EngineNodeContract> {
  if (cached) return cached

  const facts = listSources(ENGINE_ROOT).map(scanFile)
  const byClass = new Map(facts.filter((f) => f.className).map((f) => [f.className as string, f]))
  const byPath = new Map(facts.map((f) => [f.path, f]))

  // Which processors the engine actually instantiates. A processor file that is
  // never constructed is unreachable at runtime however complete it looks — the
  // `webhook-endpoint` trigger shipped that way: in the palette, dispatched by a
  // live job, with no processor registered.
  const registrySource = stripComments(
    readFileSync(join(ENGINE_ROOT, 'core/node-processor-registry.ts'), 'utf8')
  )
  const registered = new Set(
    Array.from(registrySource.matchAll(/new\s+(\w+)\s*\(/g), (m) => m[1] as string)
  )

  /**
   * Union a class's own facts with every ancestor's, RECORDING which reads came
   * from an ancestor and from where.
   *
   * The provenance is not decoration. A single legacy read on a shared base class
   * is unioned into every subclass, so it surfaces once PER SUBCLASS and reads as
   * N independent bugs. `config:ai.outputVariable` and
   * `config:text-classifier.outputVariable` were one read, on `base-ai-node.ts`,
   * reported as two entries — two people chased it, and the second could only
   * ever have resolved it inside the first's file. Naming the ancestor turns that
   * into one obviously-shared finding.
   */
  function withInherited(fact: FileFacts) {
    const writes = [...fact.writes]
    const failurePathOnly = [...fact.failurePathOnly]
    const dynamic = [...fact.dynamicWrites]
    const unresolvedBulk = [...fact.unresolvedBulkWrites]
    const reads = [...fact.dataReads]
    const foreign = { ...fact.foreignDataReads }
    const inheritedFrom: Record<string, string> = {}
    const own = new Set(fact.dataReads)
    const seen = new Set<string>([fact.className ?? fact.path])
    let parent = fact.superClass ? byClass.get(fact.superClass) : undefined
    while (parent && !seen.has(parent.className ?? parent.path)) {
      seen.add(parent.className ?? parent.path)
      const relative = parent.path.replace(`${ENGINE_ROOT}/`, '')
      writes.push(...parent.writes)
      failurePathOnly.push(...parent.failurePathOnly)
      dynamic.push(...parent.dynamicWrites)
      unresolvedBulk.push(...parent.unresolvedBulkWrites)
      reads.push(...parent.dataReads)
      for (const key of parent.dataReads) {
        if (!own.has(key) && !(key in inheritedFrom)) inheritedFrom[key] = relative
      }
      for (const [key, binding] of Object.entries(parent.foreignDataReads)) {
        if (!own.has(key) && !(key in foreign)) foreign[key] = `${binding} (in ${relative})`
      }
      parent = parent.superClass ? byClass.get(parent.superClass) : undefined
    }
    return { writes, failurePathOnly, dynamic, unresolvedBulk, reads, foreign, inheritedFrom }
  }

  // When two files declare the same node type, the REGISTERED one wins outright.
  // This was landed for `ai.ts` (the superseded `AIProcessor`) alongside
  // `ai-v2.ts` (`AIProcessorV2`, the one actually constructed): both declared
  // `WorkflowNodeType.AI`, and merging them reported the dead processor's
  // `data.prompt` / `data.systemPrompt` reads as builder drift when no code path
  // read them. `ai.ts` has since been deleted, so nothing exercises this today —
  // it is kept because a superseded-but-still-present processor is a recurring
  // shape, and without it the next one silently poisons its node's contract.
  const registeredTypes = new Set(
    facts.filter((f) => f.className && registered.has(f.className)).flatMap((f) => f.nodeTypeValues)
  )

  const contracts = new Map<string, EngineNodeContract>()
  /** Node type -> keys read off the processor's OWN `node.data`, not inherited. */
  const ownReads = new Map<string, Set<string>>()
  for (const fact of facts) {
    const isRegistered = fact.className ? registered.has(fact.className) : false
    for (const nodeType of fact.nodeTypeValues) {
      if (!isRegistered && registeredTypes.has(nodeType)) continue
      const inherited = withInherited(fact)
      const own = ownReads.get(nodeType) ?? new Set<string>()
      for (const key of fact.dataReads) own.add(key)
      ownReads.set(nodeType, own)
      const existing = contracts.get(nodeType)
      contracts.set(nodeType, {
        files: [...(existing?.files ?? []), fact.path.replace(`${ENGINE_ROOT}/`, '')],
        writes: [...(existing?.writes ?? []), ...inherited.writes],
        failurePathOnlyWrites: [
          ...(existing?.failurePathOnlyWrites ?? []),
          ...inherited.failurePathOnly,
        ],
        dynamicWrites: [...(existing?.dynamicWrites ?? []), ...inherited.dynamic],
        unresolvedBulkWrites: [
          ...(existing?.unresolvedBulkWrites ?? []),
          ...inherited.unresolvedBulk,
        ],
        dataReads: [...(existing?.dataReads ?? []), ...inherited.reads],
        foreignDataReads: { ...(existing?.foreignDataReads ?? {}), ...inherited.foreign },
        inheritedDataReads: {
          ...(existing?.inheritedDataReads ?? {}),
          ...inherited.inheritedFrom,
        },
        registered: (existing?.registered ?? false) || isRegistered,
      })
    }
  }

  for (const [nodeType, extras] of Object.entries(EXTRA_ENGINE_SOURCES)) {
    const contract = contracts.get(nodeType)
    if (!contract) continue
    for (const relative of extras) {
      const fact = byPath.get(join(ENGINE_ROOT, relative))
      if (!fact) throw new Error(`EXTRA_ENGINE_SOURCES points at a missing file: ${relative}`)
      contract.files.push(relative)
      contract.writes.push(...fact.writes)
      contract.dynamicWrites.push(...fact.dynamicWrites)
      contract.unresolvedBulkWrites.push(...fact.unresolvedBulkWrites)
    }
  }

  for (const contract of contracts.values()) {
    const written = new Set(contract.writes)
    contract.writes = Array.from(written).sort()
    contract.failurePathOnlyWrites = Array.from(new Set(contract.failurePathOnlyWrites)).sort()
    contract.dynamicWrites = Array.from(new Set(contract.dynamicWrites)).sort()
    contract.unresolvedBulkWrites = Array.from(new Set(contract.unresolvedBulkWrites)).sort()
    contract.dataReads = Array.from(new Set(contract.dataReads)).sort()
  }

  // A key that ANY file attributed to this type reads off the processor's own
  // `node` is neither foreign nor inherited, whatever a sibling file does with a
  // same-named local. `dataReads` alone cannot decide this — it already holds the
  // ancestors' keys — so the own-reads are tracked separately during the merge.
  for (const [nodeType, own] of ownReads) {
    const contract = contracts.get(nodeType)
    if (!contract) continue
    for (const key of own) {
      delete contract.foreignDataReads[key]
      delete contract.inheritedDataReads[key]
    }
  }

  cached = contracts
  return contracts
}

/**
 * Is `path` reachable given the literal paths the engine writes?
 *
 * `getVariable` falls back to `resolveVariablePath`, which walks INTO the value
 * of a shallower key — so a write of `record` makes `record.contact.email`
 * resolvable. The converse is not true: writing `message.id` does not make
 * `message` resolvable, because the store is keyed by the flat dotted string.
 * Prefix matching therefore runs in exactly one direction.
 */
export function isPathWritten(path: string, writes: string[]): boolean {
  return writes.some((write) => {
    if (write.includes('${')) {
      // Template pattern (`tool_${index}`): compare on the literal stem only.
      const stem = write.slice(0, write.indexOf('${'))
      return stem.length > 0 && path.startsWith(stem)
    }
    return path === write || path.startsWith(`${write}.`)
  })
}

/**
 * Property names declared in a builder node's `types.ts`.
 *
 * The zod schema alone is NOT the builder's writable surface. Several nodes
 * declare only a handful of keys in zod while the panel writes the full
 * TypeScript interface — `format`'s schema has four keys, its `FormatNodeData`
 * has eighteen `*Config` objects that the panel and validator both use. Reading
 * the interface keeps the config-key assertion pointed at genuine
 * name-mismatches (`data.assigneeId` vs `data.assignee`) rather than at zod
 * schemas that are merely incomplete — which is a different bug, and not this
 * suite's.
 *
 * Deliberately a flat property-line scan rather than a parse: it over-collects
 * slightly (nested object types in the same file contribute their keys too),
 * and over-collecting only makes this assertion more conservative.
 */
export function builderDeclaredKeys(builderDir: string): Set<string> {
  const path = join(BUILDER_ROOT, builderDir, 'types.ts')
  if (!existsSync(path)) return new Set()
  const source = stripComments(readFileSync(path, 'utf8'))
  return new Set(Array.from(source.matchAll(/^\s+(\w+)\??\s*:/gm), (m) => m[1] as string))
}

/**
 * Normalise an advertised variable id into the path the engine would have to
 * write.
 *
 * The builder mints ids as `<nodeId>.<path>`; array members are advertised with
 * an `[*]` segment (`structured_output.items[*].sku`), which is picker syntax
 * for "every element", not a stored key — the engine writes the array once, at
 * `structured_output.items`.
 */
export function advertisedPath(variableId: string, nodeId: string): string {
  return variableId.startsWith(`${nodeId}.`)
    ? variableId.slice(nodeId.length + 1).replace(/\[\*\]/g, '')
    : variableId
}
