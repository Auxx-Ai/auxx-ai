// apps/web/src/components/workflow/parity/contract-drift-allowlist.ts

/**
 * Known-broken entries for the builder↔engine parity suite
 * (`builder-engine-parity.test.ts`, colocated).
 *
 * NOTE ON LOCATION: these are plain data modules, not tests. They sit beside the
 * suite rather than in a `__tests__` directory because both vitest projects glob
 * every `.ts` under a `__tests__` directory as a suite — a helper file there is
 * collected as a suite with no tests and fails the whole run.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The parity suite asserts that everything the builder ADVERTISES the engine
 * actually WRITES, and that everything the engine READS the builder can write.
 * It was landed against a codebase that had already drifted, so it would have
 * been red on commit. Rather than weaken the assertion, the drift is enumerated
 * here — one line of reason per entry — so the suite is green today and every
 * NEW drift is a hard failure.
 *
 * ── THE TWO MAPS ARE NOT THE SAME KIND OF THING ─────────────────────────────
 * `KNOWN_BROKEN_*` is a burn-down list: real bugs, go fix them.
 * `EXTRACTION_BLIND_SPOTS` is a record of what the READER cannot see, plus the
 * handful of pairings that are correct by design. Filing something in the wrong
 * map is the expensive mistake: a blind spot filed as drift sends someone to fix
 * code that already works, and makes the headline count a lie. When in doubt,
 * open the processor and read it — every entry below was verified at source.
 *
 * ── WHERE IT STANDS ─────────────────────────────────────────────────────────
 * The burn-down is DONE. All three `KNOWN_BROKEN_*` maps are empty: every path
 * the builder advertises is written, and every `node.data` key the engine reads
 * has a writer. What remains is 42 blind-spot entries — things that work and
 * that this reader structurally cannot confirm.
 *
 * An empty burn-down list is not an invitation to delete the maps. They are the
 * landing zone for the next regression, and the suite fails into them.
 *
 * ── HOW TO BURN IT DOWN ─────────────────────────────────────────────────────
 * Fix the drift, delete the line. The suite fails on a STALE entry too (it
 * shows up under `unexpectedPasses`), so a fixed bug forces its own allowlist
 * removal instead of quietly accumulating.
 *
 * ── HOW TO REGENERATE ───────────────────────────────────────────────────────
 * One command. It prints each assertion's current failure set as a
 * copy-pasteable object literal; paste them over the maps below and write the
 * reasons. Generated details carry a `NOTE:` whenever the reader knows its own
 * attribution is uncertain — that is the signal to open the source before
 * filing. There are three:
 *   - "unresolvable bulk setNodeVariables payload(s)" — the node may well write
 *     the path; the reader cannot read the payload's keys.
 *   - "may target a FOREIGN node" — the read goes through a node pulled out of
 *     the graph, so it is probably some OTHER node's config key.
 *   - "INHERITED read" — it lives in the named ancestor file, and every sibling
 *     subclass reports the same read separately. Fix it once, there.
 *
 *     cd apps/web && \
 *       WORKFLOW_PARITY_PRINT_ALLOWLIST=1 pnpm exec vitest run \
 *       src/components/workflow/parity
 *
 * The operator third of the suite has its own allowlist, in `packages/lib`:
 * `src/workflow-engine/nodes/condition-nodes/operator-parity-allowlist.ts`.
 * It lives there because both sides of the operator contract are there, and it
 * cannot live here for the same reason this cannot live there — lib is
 * dependency tier 3 and apps/web is tier 5.
 */

/**
 * Entry keys:
 *   `processor:<nodeType>`          — palette node with no registered processor
 *   `variable:<nodeType>.<path>`    — advertised path the engine never writes
 *   `variable:<nodeType>:<threw>`   — `outputVariables` threw for that config
 *
 * Empty: nothing the picker offers is unwritten. See the header before adding.
 */
export const KNOWN_BROKEN_OUTPUT_VARIABLES: Record<string, string> = {}

/**
 * Entry key: `failure-path:<nodeType>.<path>`.
 *
 * The path IS written, but every `setNodeVariable` call site for it sits inside
 * an `else` block — so it is populated only when the guarded operation failed.
 *
 * Empty: both `else`-only clusters in the engine today are correct-by-design
 * two-arm branches, filed in `EXTRACTION_BLIND_SPOTS`.
 */
export const KNOWN_BROKEN_FAILURE_PATH_WRITES: Record<string, string> = {}

/**
 * Entry key: `config:<nodeType>.<key>`.
 *
 * The processor reads `node.data.<key>`, but neither the builder's zod schema,
 * its defaults, nor its `types.ts` interface declares it — so nothing on the
 * panel side can produce it and the read is always `undefined`.
 *
 * Empty: the thirteen entries this map carried are gone. Eleven were fixed
 * (the legacy `ai.prompt` / `ai.systemPrompt` / `*.outputVariable` reads and the
 * commented-out `list.findConfig` / `mapConfig` reads deleted; `wait.duration`,
 * `dataset.waitForEmbeddings` and `resource-trigger.filters` rewired), and four
 * were mis-filed — see the two `manual.*` and two `wait.*` entries below.
 */
export const KNOWN_BROKEN_CONFIG_KEYS: Record<string, string> = {}

/**
 * Entries that are NOT drift: either the static reader cannot see the write, or
 * the pairing is correct by design. Every one verified by reading the processor.
 *
 * Kept separate from the `KNOWN_BROKEN_*` maps on purpose — those are a debt
 * list to burn down, this one is a standing record of what the reader is blind
 * to. Both are diffed the same way, so an entry here that starts passing also
 * fails the suite and has to be removed.
 *
 * The recurring causes, all real writes or correct pairings the reader cannot
 * follow:
 *   - a per-key loop over a runtime object (`crud`, `code`, `var-assign`)
 *   - a bulk `setNodeVariables` whose payload is a function call or a parameter
 *     (`human-confirmation`, `wait`)
 *   - a spread inside an otherwise-readable bulk payload (`loop`)
 *   - a two-arm `if/else` where the `else` is the other MODE, not a failure
 *     (`scheduled`, `form-input`)
 *   - a config key written by the server, or belonging to a different node
 *     entirely (`wait`, `manual`)
 */
export const EXTRACTION_BLIND_SPOTS: Record<string, string> = {
  'processor:note':
    'By design: `note` is a canvas annotation with no runtime. Listed so the suite notices if that ever changes.',

  // ── Per-key loop over a runtime object ────────────────────────────────────
  'variable:code.output1':
    'Dynamic write: code.ts loops `config.outputs` and calls setNodeVariable(nodeId, output.name, …), so every declared output IS written — the path just is not a literal.',
  'variable:crud.actionCount':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.actionsPerformed':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.assigneeUpdated':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.errors':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.inboxUpdated':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.newAssigneeId':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.newInboxId':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.newPrimaryEntityId':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.newReadStatus':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.newStatus':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.newSubject':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.primaryEntityUpdated':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.readStatusUpdated':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.statusUpdated':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.subjectUpdated':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  'variable:crud.tagsUpdated':
    'Dynamic write: crud.ts spreads `Object.entries(result.thread)` into setNodeVariable for thread mode.',
  // `myVar` / `myList` are the fixture names from the `named … variable`
  // CONFIG_VARIANTS, not real user data — the node advertises one path per
  // assignment, so the key is whatever the config was evaluated with.
  'variable:var-assign.myList':
    'Dynamic write: var-assign-processor.ts:116 `setNodeVariable(node.nodeId, result.name, result.value)` — one write per declared assignment, keyed by the user-chosen name. Every named assignment IS published; none of the paths are literals.',
  'variable:var-assign.myVar':
    'Dynamic write: same loop, var-assign-processor.ts:116. (The DEFAULT config seeds one assignment with an empty `name`, which `outputVariables` filters out — so without the CONFIG_VARIANTS entries this node advertised nothing and was never asserted at all.)',

  // ── Bulk `setNodeVariables` whose payload the reader cannot resolve ────────
  // Written from TWO sites, neither of them readable here. Production resumes
  // through `WorkflowEngine.resumeExecution` and never re-enters the processor,
  // so `core/workflow-engine.ts:2160` is the load-bearing one — and it lives in a
  // file with no `readonly type`, so the reader cannot attribute it to this node
  // at all. Wiring it up via EXTRA_ENGINE_SOURCES would hand `human-confirmation`
  // every write in workflow-engine.ts, which is worse than the gap.
  'variable:human-confirmation.approved_by':
    'WRITTEN twice: core/workflow-engine.ts:2160 `setNodeVariables(fromNodeId, approvalVariables)` on resume (the production path), and human-confirmation.ts:317 for builder test runs. Both payloads come from `buildApprovalDecisionVariables` (core/pause-resume.ts:108), which returns this key literally. The reader follows neither a computed payload nor a write outside the processor file.',
  'variable:human-confirmation.denied_by':
    'WRITTEN, same two sites: `buildApprovalDecisionVariables` (core/pause-resume.ts) returns `denied_by`.',
  'variable:human-confirmation.outcome':
    'WRITTEN, same two sites: `buildApprovalDecisionVariables` (core/pause-resume.ts) returns `outcome`.',
  'variable:human-confirmation.response_message':
    'WRITTEN, same two sites: `buildApprovalDecisionVariables` (core/pause-resume.ts) returns `response_message`.',
  'variable:human-confirmation.response_time':
    "WRITTEN, same two sites: `buildApprovalDecisionVariables` (core/pause-resume.ts) returns `response_time`; `requested_at` is read off the node's own pause output.",
  'variable:loop.lastResult':
    'WRITTEN. loop.ts:212 `setNodeVariables(node.nodeId, output)`, and `lastResult` arrives through the `...this.buildResultOutputs(…)` spread at :205 — the reader resolves the literal keys of `output` but not the spread.',
  'variable:loop.result':
    'WRITTEN, same spread, other arm: `buildResultOutputs` (loop.ts:226) returns `{ result }` when `accumulateResults` is false and `{ results, lastResult }` when it is true. Only surfaced at all because CONFIG_VARIANTS pins the non-accumulating config; the default accumulates.',
  'variable:wait.paused_at':
    'WRITTEN. wait-processor.ts:354 `setNodeVariables(node.nodeId, output)`, where `output` is a PARAMETER of `publishWaitOutputs` and the four call sites (:326, :389, :727, :786) all pass an object literal containing this key. The reader does not follow a parameter.',
  'variable:wait.resume_at':
    'WRITTEN, same call: every `publishWaitOutputs` payload for a queued wait carries `resume_at`.',
  'variable:wait.wait_duration_ms':
    'WRITTEN, same call: every `publishWaitOutputs` payload carries `wait_duration_ms`.',
  'variable:wait.wait_method':
    'WRITTEN, same call: every `publishWaitOutputs` payload carries `wait_method`.',

  // ── A two-arm `if/else` where the `else` is the other MODE ─────────────────
  // The failure-path assertion looks for a write whose every call site is inside
  // an `else`, because that shape shipped once as a real bug (`find.ts` set its
  // label-keyed path only when the lookup returned null). It cannot tell a
  // failure arm from the second half of a mode switch.
  'failure-path:form-input.file':
    'Correct by design: the `else` is the SINGLE-file arm of `setFileOutputs` (form-input-processor.ts:307 `if (allowMultiple) … else …`), not a failure path — and manual.ts publishes the same keys unconditionally for a wired form-input node.',
  'failure-path:form-input.file.filename':
    'Correct by design: same single-file arm, form-input-processor.ts:325.',
  'failure-path:form-input.file.id':
    'Correct by design: same single-file arm, form-input-processor.ts:324.',
  'failure-path:form-input.file.mimeType':
    'Correct by design: same single-file arm, form-input-processor.ts:327.',
  'failure-path:form-input.file.size':
    'Correct by design: same single-file arm, form-input-processor.ts:326.',
  'failure-path:form-input.file.url':
    'Correct by design: same single-file arm, form-input-processor.ts:328.',
  'failure-path:scheduled.interval_config':
    'Correct by design: the `else` here is the NON-custom-cron branch (`if (triggerInterval === "custom") cron_expression else interval_config`), not a failure path.',

  // ── Config keys that belong to somebody else ──────────────────────────────
  // These four are the ones the burn-down got WRONG, in both directions. All
  // four are correct pairings; none of them is work.
  'config:manual.inputType':
    "NOT manual's key. manual.ts reads it off the connected FORM-INPUT node it fetches from `sys.workflow.graph.nodes` (`findFormInputConfig`, manual.ts:138), so the declaring panel is form-input's — which does declare it, and writes it. The run panel's manual-input prompt reads the very same key off the very same node (`nodes/shared/manual-trigger-input.tsx`). The reader now flags the shape (`foreignNodeBindings`) but cannot resolve which node a graph lookup returns, so the finding stands with a NOTE.",
  'config:manual.typeOptions':
    "NOT manual's key either — same foreign read, same line, same form-input node. Paired with `inputType` to shape the trigger input.",
  'config:wait.anchor':
    'By design, not drift: written by `buildSequenceGraph` (packages/lib/src/sequences/publish.ts:96-104) onto the wait nodes a published sequence compiles to, and DELIBERATELY never panel-authored — wait-processor.ts:34 says so explicitly. A panel control here would be a second, divergent writer for a server-computed value.',
  'config:wait.deliveryWindow':
    "By design, same origin: `buildSequenceGraph` emits it from the sequence's delivery window (publish.ts:99). A zero-delay wait node exists ONLY to carry it, which is why the pairing has to stay one-directional.",
}
