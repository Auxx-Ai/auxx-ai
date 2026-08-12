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
 * ── HOW TO BURN IT DOWN ─────────────────────────────────────────────────────
 * Fix the drift, delete the line. The suite fails on a STALE entry too (it
 * shows up under `unexpectedPasses`), so a fixed bug forces its own allowlist
 * removal instead of quietly accumulating.
 *
 * ── HOW TO REGENERATE ───────────────────────────────────────────────────────
 * One command. It prints each assertion's current failure set as a
 * copy-pasteable object literal; paste them over the maps below and write the
 * reasons. Findings on a node with an unreadable bulk payload carry a `NOTE:`
 * in their generated detail — that is the signal to check the source and file
 * them as a blind spot rather than as drift.
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
 */
export const KNOWN_BROKEN_OUTPUT_VARIABLES: Record<string, string> = {
  'variable:list.count':
    'list-processor.ts writes only `result`; the item count is put in `metadata`, which is not the variable store.',
  'variable:manual.timestamp':
    'manual.ts publishes only the file variables (setFileVariables); `timestamp` appears nowhere in the processor.',
  'variable:manual.userId':
    'manual.ts publishes only the file variables (setFileVariables); `userId` appears nowhere in the processor.',
  'variable:message-received.message':
    'Container node in the picker tree — only the leaves (`message.id`, `message.from.email`, …) are written, and the store is flat-keyed so the container path resolves to nothing. Confirm the picker can actually insert the container before treating this as user-visible.',
  'variable:message-received.message.from':
    'Same container problem one level down: `message.from.email` and `message.from.name` are written, `message.from` is not.',
  'variable:scheduled.is_test_run':
    'scheduled.ts writes triggered_at / schedule_type / cron_expression / interval_config only; is_test_run is advertised but never written.',
}

/**
 * Entry key: `failure-path:<nodeType>.<path>`.
 *
 * The path IS written, but every `setNodeVariable` call site for it sits inside
 * an `else` block — so it is populated only when the guarded operation failed.
 */
export const KNOWN_BROKEN_FAILURE_PATH_WRITES: Record<string, string> = {}

/**
 * Entry key: `config:<nodeType>.<key>`.
 *
 * The processor reads `node.data.<key>`, but neither the builder's zod schema,
 * its defaults, nor its `types.ts` interface declares it — so nothing on the
 * panel side can produce it and the read is always `undefined`.
 */
export const KNOWN_BROKEN_CONFIG_KEYS: Record<string, string> = {
  'config:ai.outputVariable':
    'Legacy alias read via `(config as any).outputVariable`; the builder has no such field, so it always falls back to `<nodeId>.text`.',
  'config:ai.prompt':
    'Legacy single-prompt field. The builder writes `prompt_template[]`; the `config.prompt` branch is unreachable from the panel.',
  'config:ai.systemPrompt':
    'Legacy field, same as `config:ai.prompt` — reachable only from hand-written or imported node data.',
  'config:dataset.waitForEmbeddings':
    'Read by dataset.ts to decide whether to block on embedding; the dataset panel has no control for it, so it is always undefined (falsy).',
  'config:list.findConfig':
    'The `find` list operation is commented out in the processor but `extractRequiredVariables` still reads `findConfig.conditions`; the builder never writes it.',
  'config:list.mapConfig':
    'Same as `findConfig` — the `map` operation is commented out, yet `extractRequiredVariables` still reads `mapConfig.template`.',
  'config:manual.inputType':
    'manual.ts reads `node.data.inputType` for the manual-run input prompt; the manual trigger panel writes no such key.',
  'config:manual.typeOptions':
    'Paired with `inputType` — read by manual.ts, never written by the panel.',
  'config:resource-trigger.filters':
    'resource-trigger-base.ts reads `node.data.filters` to gate the trigger; the resource-trigger panel writes its conditions elsewhere.',
  'config:text-classifier.outputVariable':
    'Legacy alias, same shape as `config:ai.outputVariable`; the classifier panel has no such field.',
  'config:wait.anchor':
    'Sequence anchor config (`resolveSubjectAnchorDate`). Reachable only from server-built sequence nodes — the wait panel cannot produce it.',
  'config:wait.deliveryWindow':
    'Delivery-window snapping, same origin as `anchor`: sequence-authored, not panel-authored.',
  'config:wait.duration':
    'Legacy seconds field. The panel writes `durationAmount` + `durationUnit`; `duration` survives only in old saved graphs — and `wait/schema.ts` computes its advertised outputs from it, so on a panel-authored node that branch is NaN.',
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
 * The three recurring causes, all real writes the reader cannot follow:
 *   - a per-key loop over a runtime object (`crud`, `code`)
 *   - a bulk `setNodeVariables` whose payload is a function call or a parameter
 *     (`human-confirmation`, `wait`)
 *   - a spread inside an otherwise-readable bulk payload (`loop`)
 */
export const EXTRACTION_BLIND_SPOTS: Record<string, string> = {
  'processor:note':
    'By design: `note` is a canvas annotation with no runtime. Listed so the suite notices if that ever changes.',

  // Per-key loop over a runtime object.
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

  // Bulk `setNodeVariables` whose payload the reader cannot resolve.
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
    'WRITTEN. loop.ts:212 `setNodeVariables(node.nodeId, output)`, and `lastResult` arrives through the `...this.buildResultOutputs(...)` spread at :205 — the reader resolves the literal keys of `output` but not the spread.',
  'variable:wait.paused_at':
    'WRITTEN. wait-processor.ts:354 `setNodeVariables(node.nodeId, output)`, where `output` is a PARAMETER of `publishWaitOutputs` and the four call sites (:326, :389, :727, :786) all pass an object literal containing this key. The reader does not follow a parameter.',
  'variable:wait.resume_at':
    'WRITTEN, same call: every `publishWaitOutputs` payload for a queued wait carries `resume_at`.',
  'variable:wait.wait_duration_ms':
    'WRITTEN, same call: every `publishWaitOutputs` payload carries `wait_duration_ms`.',
  'variable:wait.wait_method':
    'WRITTEN, same call: every `publishWaitOutputs` payload carries `wait_method`.',

  'failure-path:scheduled.interval_config':
    'Correct by design: the `else` here is the NON-custom-cron branch (`if (triggerInterval === "custom") cron_expression else interval_config`), not a failure path.',
}
