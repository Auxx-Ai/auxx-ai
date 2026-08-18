// apps/web/src/components/workflow/parity/store-subscription-scrape.test.ts

import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listSources, stripComments, WORKFLOW_ROOT } from './monorepo-paths'

/**
 * CI guardrail for the builder's single worst performance regression class.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Never subscribe to React Flow's whole node or edge array from inside
 * `apps/web/src/components/workflow/`:
 *
 * ```ts
 * const nodes = useStore((state) => state.nodes)   // ← banned
 * const edges = useStore((s) => s.edges)           // ← banned
 * ```
 *
 * React Flow replaces `state.nodes` with a NEW array on every pointer frame of
 * a drag (~60/s — `handleNodeDrag` in `hooks/use-node-interactions.ts` rebuilds
 * the array through `produce()` per frame). One such subscription therefore
 * re-renders its component for the entire duration of every node drag,
 * regardless of whether that component cares about positions.
 *
 * This is documented in `docs/core-workflow-architecture-guide.md` §8, but a
 * doc does not fail a build. The regression is invisible in review (the diff is
 * one more `useStore` call), invisible in tests (nothing asserts render counts)
 * and only reproduces on a graph big enough to feel it — which is exactly the
 * profile of a rule that needs a machine to enforce it.
 *
 * ── WHY A TEXTUAL SCRAPE ────────────────────────────────────────────────────
 * Same reason as `engine-write-scrape.ts`, which the repo already accepts: the
 * property being asserted is about SOURCE SHAPE, not runtime behaviour. There
 * is nothing to execute — a render-count assertion would need a mounted canvas,
 * a real React Flow provider and a synthesized drag gesture to observe what one
 * regex sees for free. `stripComments()` runs first so a banned line quoted in
 * a doc block (this one included) is not read as code.
 *
 * ── WHAT IT MATCHES ─────────────────────────────────────────────────────────
 * The SELECTOR BODY, not the import name. `useStore` reaches this tree under at
 * least three identities — React Flow's `useStore`, the same thing aliased
 * (`useStore as useReactFlowStore` in `hooks/use-node-data-update.ts`), and
 * Zustand's own `useStore` (`shared/test-events/use-test-event-listener.ts`) —
 * so keying on the import name would miss two of the three. Instead:
 *
 *   1. an arrow passed to a callee whose name contains `Store` or `Shallow`,
 *      whose body is the parameter followed by a bare `.nodes` / `.edges`; or
 *   2. a standalone arrow whose parameter is explicitly typed `ReactFlowState`
 *      and whose body is a bare `.nodes` / `.edges` — the module-level named
 *      selector form used in `ui/canvas-node-info.tsx`.
 *
 * "Bare" means nothing follows: `state.nodes.length` (a primitive — only
 * re-renders when the count changes) and `state.nodes.find(...)` are NOT
 * matched. Both arms deliberately accept false negatives over false positives.
 * The job is to stop the obvious case, not to be a type checker; a rule that
 * fires on innocent code gets suppressed and then ignored.
 *
 * ── WHAT THIS DOES NOT CATCH ────────────────────────────────────────────────
 * Say it out loud so the next person doesn't over-trust a green run:
 *
 *  - **Expensive `useShallow` selector BODIES.** `useShallow` (and a `shallow`
 *    equality argument) suppresses the RE-RENDER, never the selector body — the
 *    body still runs on every store update, drag frames included.
 *    `hooks/use-available-variables.tsx` rebuilds a full node-title map inside
 *    one and defends itself with a manual hash ref; `panels/property-panel.tsx`,
 *    `panels/workflow-panel-drawer.tsx`, `hooks/use-variable.ts` and
 *    `nodes/core/manual/connected-inputs-editor.tsx` all do a `state.nodes.find`
 *    per store update. All of these are legal here and all are unmeasured. See
 *    `plans/workflow/debug/canvas-performance-and-debug-switch.md` §2.3/§3.
 *  - **`store.getState().nodes` inside a callback.** That is a read, not a
 *    subscription — it is the correct way to touch the array from an event
 *    handler, it is used all over this tree via `useStoreApi()`, and it must
 *    stay legal.
 *  - **Anything reached through a custom hook wrapper.** A hook that itself
 *    subscribes and returns the array launders the violation past this scan;
 *    only the hook's own file can be caught, and only if it is written inline.
 *  - **Block-bodied selectors** (`(s) => { return s.nodes }`) and selectors
 *    passed by reference from another module.
 *
 * ── THE ALLOWLIST ───────────────────────────────────────────────────────────
 * Same convention as `contract-drift-allowlist.ts`: one entry per known
 * violation, each with a one-line reason, so the test can land green without
 * weakening the assertion. It is EMPTY today — §5 of the plan above removed the
 * only entry (`ui/variables/variable-explorer-enhanced.tsx`, which subscribed
 * to the node array for a loop-context conversion that was never implemented).
 * An empty allowlist is not an invitation to delete it: it is the landing zone
 * for the next entry, and every addition needs a reason and, ideally, the plan
 * section that removes it again. An allowlist that grows silently is worse than
 * no test at all.
 */

/**
 * Files permitted to subscribe to the whole node/edge array, keyed by path
 * relative to `WORKFLOW_ROOT`. Every value is the reason the entry exists.
 */
const ALLOWLIST: Record<string, string> = {
  // (empty — keep the shape, add entries with a reason and a removal plan)
}

/** Arrow selector handed to a `*Store*` / `*Shallow*` callee: `useStore((s) => s.nodes)`. */
const INLINE_SELECTOR =
  /\b[A-Za-z_$][\w$]*(?:[Ss]tore|[Ss]hallow)[\w$]*\s*(?:<[^<>]*>)?\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?::[^)=]*)?\)?\s*=>\s*\1\s*\.\s*(nodes|edges)\b(?!\s*[.[])/g

/** Named selector typed against React Flow: `const sel = (s: ReactFlowState) => s.nodes`. */
const NAMED_SELECTOR =
  /\(\s*([A-Za-z_$][\w$]*)\s*:\s*ReactFlowState[^)]*\)\s*=>\s*\1\s*\.\s*(nodes|edges)\b(?!\s*[.[])/g

interface Violation {
  file: string
  line: number
  text: string
}

/** Scan one already-comment-stripped source for both selector shapes. */
function findViolations(file: string, source: string): Violation[] {
  const found: Violation[] = []
  for (const pattern of [INLINE_SELECTOR, NAMED_SELECTOR]) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)
    while (match) {
      found.push({
        file,
        line: source.slice(0, match.index).split('\n').length,
        text: match[0].replace(/\s+/g, ' '),
      })
      match = pattern.exec(source)
    }
  }
  return found
}

describe('workflow store subscriptions', () => {
  const violations = listSources(WORKFLOW_ROOT, ['.ts', '.tsx']).flatMap((path) =>
    findViolations(relative(WORKFLOW_ROOT, path), stripComments(readFileSync(path, 'utf8')))
  )

  it('never subscribes to the whole node or edge array', () => {
    const unlisted = violations.filter((v) => !(v.file in ALLOWLIST))
    expect(
      unlisted.map((v) => `${v.file}:${v.line}  ${v.text}`),
      'React Flow replaces state.nodes/state.edges every drag frame — select a narrower ' +
        'slice, read via store.getState() in a callback, or resolve it from useVarStore'
    ).toEqual([])
  })

  it('lists no already-fixed files in the allowlist', () => {
    const offending = new Set(violations.map((v) => v.file))
    const stale = Object.keys(ALLOWLIST).filter((file) => !offending.has(file))
    expect(
      stale,
      'these files no longer violate the rule — delete their allowlist entries'
    ).toEqual([])
  })
})
