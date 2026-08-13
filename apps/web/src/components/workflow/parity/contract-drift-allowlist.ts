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
 * actually WRITES (and the reverse: everything the engine writes, the picker
 * offers), that everything the engine READS the builder can write, and that
 * every branch HANDLE the engine can emit or route on is one the builder
 * renders. It was landed against a codebase that had already drifted, so it
 * would have been red on commit. Rather than weaken the assertion, the drift is
 * enumerated here — one line of reason per entry — so the suite is green today
 * and every NEW drift is a hard failure.
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
 * The FORWARD burn-down is DONE: `KNOWN_BROKEN_OUTPUT_VARIABLES`,
 * `KNOWN_BROKEN_FAILURE_PATH_WRITES` and `KNOWN_BROKEN_CONFIG_KEYS` are empty —
 * every path the builder advertises is written, and every `node.data` key the
 * engine reads has a writer.
 *
 * Two assertions landed later, each against code that had already drifted, so
 * each carries its own burn-down:
 *   - `KNOWN_BROKEN_OUTPUT_HANDLES` — the `error`-vs-`fail`-vs-`onError` handle
 *     mismatch family. A PR renaming the emitted handles and fixing the
 *     Failed-path routing is IN FLIGHT in parallel with this suite; when it
 *     lands, these entries start passing and the stale-entry failure forces
 *     their deletion in that PR. Do not burn these down independently.
 *   - `KNOWN_BROKEN_UNADVERTISED_WRITES` — the Phase 2 fix list: real values
 *     the engine publishes that no variable picker will ever offer.
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
 *   - "also emits computed handles" — the node's literal handle set is a floor;
 *     an expression the reader cannot evaluate may emit more.
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
 * Entry key: `written:<nodeType>.<path>`.
 *
 * The engine writes the path via `setNodeVariable(s)`, but `outputVariables`
 * never advertises it under any pinned config — a real run-time value no
 * variable picker will ever offer, reachable only by typing the path blind.
 *
 * This is the Phase 2 fix list. Each entry needs one of two fixes: advertise
 * the path in the node's `outputVariables` (it is useful data), or stop
 * writing it (it is dead weight in the variable store). Fixing either way
 * makes the entry stale and forces its deletion.
 */
export const KNOWN_BROKEN_UNADVERTISED_WRITES: Record<string, string> = {
  // ── The generic `output` duplicate ─────────────────────────────────────────
  // Several AI-family processors publish their main result twice: under the
  // advertised name AND under a legacy bare `output` nothing advertises.
  'written:ai.output':
    "ai-v2.ts:555 writes the final assistant message under 'output' (and base-ai-node.ts:257 does the same for the legacy path); the picker offers `text`. Advertise or drop the duplicate.",
  'written:information-extractor.output':
    "information-extractor.ts:248/:388 writes the structured result under 'output'; the picker offers `extracted_data`. Advertise or drop the duplicate.",
  'written:text-classifier.output':
    "INHERITED from base-ai-node.ts:257 — the base publishes 'output' for every subclass; the classifier advertises only category/confidence/reasoning. Fix once, in the base (ai has the same entry).",
  'written:text-classifier.structured_output':
    'INHERITED from base-ai-node.ts — written for every AI subclass; only ai advertises it. Same base-class fix as `output`.',
  'written:text-classifier.text':
    'INHERITED from base-ai-node.ts — written for every AI subclass; only ai advertises it. Same base-class fix as `output`.',
  'written:text-classifier.tool_results':
    'INHERITED from base-ai-node.ts — written for every AI subclass; only ai (with toolsEnabled) advertises it. Same base-class fix as `output`.',

  // ── crud: the create/update outputs the picker never offers ───────────────
  'written:crud.record':
    "crud.ts:613 writes the created/updated record ref on every resource-mode success — the reverse assertion's founding example. The picker never offers `record` under any config.",
  'written:crud.thread':
    'crud.ts:590 writes the thread ref on every thread-mode success; the thread-mode advertisement (schema.ts) never includes it.',
  'written:crud.error':
    "crud.ts:575 writes null on success and crud.ts:1255 the failure message on the fail path; `success` is advertised, `error` — the thing you'd branch on — is not.",
  'written:crud.errorDetails':
    'crud.ts:1256 writes the structured failure (db error code, constraint) on the fail path; never advertised.',
  'written:crud.operation':
    'crud.ts:572/:1257 writes the mode on every run, success and failure; never advertised.',
  'written:crud.resourceType':
    'crud.ts:573/:1258 writes the resource type on every run; never advertised.',

  // ── Whole-result summaries nothing advertises ─────────────────────────────
  'written:code.result':
    "code.ts:72 writes the sandbox's whole return object under 'result'; the picker offers only the per-declared outputs (code.ts:66). Advertise or drop.",
  'written:find.count':
    'find.ts:745 writes the result count on every run; the picker offers the found record(s) but never the count.',
  'written:find.query_info': 'find.ts:746 writes the executed-query metadata; never advertised.',
  'written:var-assign.variables':
    "var-assign-processor.ts:140 writes the full assignment-results array under 'variables'; the picker offers only the per-assignment names. Advertise or drop.",
  'written:webhook.output':
    "webhook-processor.ts:70 writes the aggregate payload under 'output'; the picker offers method/headers/query/body individually. Advertise or drop the aggregate.",
  'written:webhook-endpoint.output':
    'webhook-endpoint.ts:101 writes the aggregate payload; same shape as webhook, same fix.',
  'written:form-input.totalSize':
    'manual.ts:195 writes `totalSize` (keyed by the form-input node, beside `files`/`fileCount`) for a multi-file input; the multi-file advertisement (form-input/output-variables.ts) offers `files.count` but not `totalSize`. Advertise or drop.',
}

/**
 * Entry keys:
 *   `handle:<nodeType>.<handle>`   — emitted outputHandle the UI never renders
 *   `routing:engine-core.<handle>` — engine-core edge lookup on a handle no
 *                                    node renders
 *
 * Either way the branch is unwirable: the emitted result (or the recovery
 * lookup) targets a handle no canvas can have an edge on, so the path dies
 * silently — no error, the run just stops.
 *
 * The engine side of this family was fixed in #1560: a Failed result now
 * routes via `findFailureEdge` (emitted handle first, legacy `onError`
 * fallback), and http's emissions were renamed to the handles its UI renders.
 * The entries below are the remainder: processors that emit `'error'` while
 * their UI renders no error handle at all, so the branch is unwirable until a
 * node manifest gives them one (Phase 1). Fixing one means renaming its
 * emission to a rendered handle (or rendering a handle) AND deleting its entry.
 */
export const KNOWN_BROKEN_OUTPUT_HANDLES: Record<string, string> = {
  'handle:chunker.error':
    "chunker.ts:384 emits 'error' on failure; the UI renders only [source], so the error branch is unwirable.",
  'handle:dataset.error': "dataset.ts:619 emits 'error' on failure; the UI renders only [source].",
  'handle:document-extractor.error':
    "document-extractor.ts:294/:319 emits 'error' on extraction failure; the UI renders only [source].",
  'handle:format.error':
    "format-processor.ts:429 emits 'error' on failure; the UI renders only [source].",
  'handle:knowledge-retrieval.error':
    "knowledge-retrieval.ts:394 emits 'error' on failure; the UI renders only [source].",
  'handle:list.error':
    "list-processor.ts:181 emits 'error' on failure; the UI renders only [source].",
  'routing:engine-core.onError':
    "graph-navigation.ts `findFailureEdge` keeps 'onError' as a deliberate legacy fallback behind the emitted-handle lookup (#1560) — but no node's UI has ever rendered an onError handle, so the literal remains unrenderable. Listed until either a graph is shown to contain one (keep) or the fallback is retired (delete).",
}

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

  // ── Handle the reader can see but production can never emit ───────────────
  'handle:if-else.true':
    "Dead arm, not drift: `outputHandle = conditionResult ? 'true' : 'false'` (if-else.ts:181) runs only when matchedCaseId is null, and buildExecutionResult is only ever called with (true, case_id, …) on a match (if-else.ts:138) or (false, null, …) on none (if-else.ts:150) — so the 'true' literal is unreachable. Production emits case ids and 'false', both rendered. The reachability hole in the reader's net (engine-contract.ts header) seen from the other side: it proves a write EXISTS, never that it runs.",

  // ── Internal bookkeeping, deliberately not picker material ────────────────
  'written:ai._resolvedPromptVars':
    'By design: ai-v2.ts:165 stashes the resolved variable map for the run log ("for run-log + downstream uses"), underscore-named to mark it internal. Not a picker variable.',

  // ── manual.ts writes keyed by the FORM-INPUT node, mis-attributed here ────
  // `setFileVariables(nodeId, …)` (manual.ts:184) and the reader disagree about
  // whose variables these are: `nodeId` is a key of `triggerData` — the id of
  // the form-input node wired into the trigger — so every one of these writes
  // publishes under the FORM-INPUT node's id, where the form-input panel's
  // single/multi-file advertisements pick them up. The reader attributes a
  // write to the file's own node type because it cannot see what `nodeId`
  // holds; the forward direction exploits the same fold-in deliberately
  // (EXTRA_ENGINE_SOURCES documents the over-attribution cost — this is that
  // cost, itemised).
  'written:manual.file':
    'Keyed by the form-input node (manual.ts:198); its panel advertises `file`.',
  'written:manual.file.id':
    'Keyed by the form-input node (manual.ts:199); advertised by the single-file shape.',
  'written:manual.file.filename':
    'Keyed by the form-input node (manual.ts:200); advertised by the single-file shape.',
  'written:manual.file.size':
    'Keyed by the form-input node (manual.ts:201); advertised by the single-file shape.',
  'written:manual.file.mimeType':
    'Keyed by the form-input node (manual.ts:202); advertised by the single-file shape.',
  'written:manual.file.url':
    'Keyed by the form-input node (manual.ts:203); advertised by the single-file shape.',
  'written:manual.files':
    'Keyed by the form-input node (manual.ts:193); advertised by the multi-file shape.',
  'written:manual.fileCount':
    'Keyed by the form-input node (manual.ts:194); the multi-file arm of the same fold-in that EXTRA_ENGINE_SOURCES exists to credit.',
  'written:manual.totalSize':
    'Keyed by the form-input node (manual.ts:195) — the same unadvertised write filed as `written:form-input.totalSize`, which is the entry that owns the fix.',
  'written:manual.filename':
    'Keyed by the form-input node (manual.ts:206) — legacy flat format, see the form-input legacy entries below.',
  'written:manual.url': 'Keyed by the form-input node (manual.ts:207) — legacy flat format.',
  'written:manual.size': 'Keyed by the form-input node (manual.ts:208) — legacy flat format.',
  'written:manual.mimeType': 'Keyed by the form-input node (manual.ts:209) — legacy flat format.',
  'written:manual.assetId': 'Keyed by the form-input node (manual.ts:210) — legacy flat format.',
  'written:manual.versionId': 'Keyed by the form-input node (manual.ts:211) — legacy flat format.',

  // ── The other side of the same fold-in ────────────────────────────────────
  // EXTRA_ENGINE_SOURCES folds ALL of manual.ts into form-input's contract so
  // the trigger-published file variables get credit. The fold cannot be
  // selective, so form-input also inherits writes that are genuinely manual's
  // own (keyed by the MANUAL node's id, manual.ts:54) …
  'written:form-input.inputs':
    "manual.ts's own write (manual.ts:54, keyed by the manual node, which advertises it under the connected-inputs variant) — folded into form-input's contract by EXTRA_ENGINE_SOURCES; the documented over-attribution cost.",
  'written:form-input.timestamp':
    "manual.ts's own write (manual.ts:54) — same fold-in, same over-attribution.",
  'written:form-input.userId':
    "manual.ts's own write (manual.ts:54) — same fold-in, same over-attribution.",
  // … and the legacy flat file format, which IS keyed by the form-input node
  // but is deliberately absent from the picker: manual.ts:205 keeps it only so
  // existing workflows that referenced the pre-`file.*` names keep resolving.
  'written:form-input.filename':
    'Legacy flat format (manual.ts:206, "existing workflows may reference these") — deliberately unadvertised back-compat; the picker offers `file.filename`.',
  'written:form-input.url':
    'Legacy flat format (manual.ts:207) — back-compat for pre-`file.*` references; the picker offers `file.url`.',
  'written:form-input.size':
    'Legacy flat format (manual.ts:208) — back-compat; the picker offers `file.size`.',
  'written:form-input.mimeType':
    'Legacy flat format (manual.ts:209) — back-compat; the picker offers `file.mimeType`.',
  'written:form-input.assetId':
    'Legacy flat format (manual.ts:210) — back-compat; the picker offers `file.id` (which carries the assetId, manual.ts:199).',
  'written:form-input.versionId':
    'Legacy flat format (manual.ts:211) — back-compat; nothing advertises a version id in the file shapes.',

  // ── Advertised through a channel that is not `outputVariables` ────────────
  // The loop ITERATOR variables are offered to nodes INSIDE the loop body by
  // the var store's loop scope (use-var-store.ts:129-180 pushes
  // `<loopNodeId>.item/index/count/total/isFirst/isLast` for every loop
  // ancestor), not by the loop node's own `outputVariables` — which correctly
  // advertises only the POST-loop outputs (results/lastResult/…). The pairing
  // is right; this suite reads only `outputVariables`, so it cannot see it.
  'written:loop.item':
    "Advertised by the picker's loop scope (use-var-store.ts:129), not outputVariables; written per iteration by core/loop-context-extensions.ts:180.",
  'written:loop.index':
    'Advertised by the loop scope (use-var-store.ts:145); written by loop-context-extensions.ts:172.',
  'written:loop.count':
    'Advertised by the loop scope (use-var-store.ts:152); written by loop-context-extensions.ts:173.',
  'written:loop.total':
    'Advertised by the loop scope (use-var-store.ts:159); written by loop-context-extensions.ts:174.',
  'written:loop.isFirst':
    'Advertised by the loop scope (use-var-store.ts:166); written by loop-context-extensions.ts:175.',
  'written:loop.isLast':
    'Advertised by the loop scope (use-var-store.ts:173); written by loop-context-extensions.ts:176.',

  // ── Advertised, but only under a config this harness cannot pin ───────────
  // resource-trigger's `outputVariables` returns [] without a populated
  // Resource in context (output-variables.ts:36); with one, the lib generator
  // emits the whole `trigger.*` metadata tree
  // (packages/lib/src/resources/variable-generators.ts:272-351, basePath
  // 'trigger'). Resource mode needs a live org — the same reach limit
  // CONFIG_VARIANTS documents for crud/find — so the reverse direction reads
  // these correct pairings as unadvertised.
  'written:resource-trigger.trigger.timestamp':
    'Advertised via the resource-mode generator (variable-generators.ts, basePath trigger) that needs a live Resource; written at resource-trigger-base.ts:217.',
  'written:resource-trigger.trigger.operation':
    'Same resource-mode advertisement; written at resource-trigger-base.ts:218.',
  'written:resource-trigger.trigger.source':
    'Same resource-mode advertisement; written at resource-trigger-base.ts:224.',
  'written:resource-trigger.trigger.resourceType':
    'Same resource-mode advertisement; written at resource-trigger-base.ts:225.',
  'written:resource-trigger.trigger.resourceId':
    'Same resource-mode advertisement; manual-operation arm of resource-trigger-base.ts.',
  'written:resource-trigger.trigger.createdBy':
    'Same resource-mode advertisement; written at resource-trigger-base.ts:227.',
  'written:resource-trigger.trigger.changedFields':
    'Same resource-mode advertisement; written at resource-trigger-base.ts:240.',
  'written:resource-trigger.trigger.previousValues':
    'Same resource-mode advertisement; written at resource-trigger-base.ts:243.',
  'written:resource-trigger.trigger.deletedBy':
    'Same resource-mode advertisement; written at resource-trigger-base.ts:249.',
  'written:resource-trigger.trigger.deletedBy.id':
    'Same resource-mode advertisement; written at resource-trigger-base.ts:251.',
  'written:resource-trigger.trigger.deletedBy.name':
    'Same resource-mode advertisement; delete arm of resource-trigger-base.ts.',
  'written:resource-trigger.trigger.deletedBy.email':
    'Same resource-mode advertisement; delete arm of resource-trigger-base.ts.',
}
