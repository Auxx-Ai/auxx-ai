# Core Workflow Architecture Guide

**Scope:** the workflow system Auxx owns — the node catalog, the execution
engine, edges and graph traversal, the run lifecycle (trigger → engine → events
→ UI), the canvas/panel layer, the draft-mutation service, and the Kopilot
builder capability.

**Not this guide:** `docs/workflow-architecture-guide.md` covers the *Workflow
App System* — third-party blocks contributed by installed apps (SDK bundles,
Tag-based reconciler, iframe sandboxing, S3 loading). Different subsystem, and
the only overlap is that an app block appears in the canvas alongside core nodes
(`nodes/app-workflow-block-processor.ts`).

Read this before touching node schemas, output variables, the engine's
preprocess/execute contract, edges/handles or graph traversal, the run and its
event stream, the canvas stores and panel stack, draft mutations, or anything
Kopilot does to a workflow graph. §8 is the one to read before "just a small
change" to anything the canvas renders during a drag.

---

## 1. The four layers

```
packages/lib/src/workflow-engine/catalog/     ← 1. WHAT a node is (data contract)
packages/lib/src/workflow-engine/nodes/       ← 2. What a node DOES (execution)
packages/lib/src/workflows/graph-edit/        ← 3. How a draft is MUTATED
packages/lib/src/ai/kopilot/capabilities/workflow-builder/  ← 4. How Kopilot authors
apps/web/src/components/workflow/             ← the canvas, panels, run UI
```

Two more things cut across all four and get their own sections because they are
where most of the surprises live:

```
packages/lib/src/workflow-engine/core/workflow-graph-builder.ts  ← edges → an executable graph (§5)
packages/lib/src/workflows/workflow-execution-service.ts         ← a run, start to finish (§6)
```

The load-bearing idea: **a node's data contract lives in lib, its React lives in
web.** One node type is described once, in `catalog/nodes/<type>.ts`, and both
the builder and the engine read that description. Before the catalog existed the
two had independent copies that silently drifted — the parity harness (§11) exists
because of what that cost.

---

## 2. The node catalog

`catalog/nodes/<type>.ts` exports a `NodeManifest`:

| Field | Purpose |
| --- | --- |
| `id`, `category`, `displayName`, `description`, `icon`, `color` | identity + palette |
| `triggerType?` | set only for trigger nodes |
| `defaultData()` | a fresh node's config — **must parse its own `configSchema`** |
| `configSchema` | zod, the single source of truth for the node's data shape |
| `validate(config)` | business rules; errors AND warnings |
| `extractVariables?(config)` | which variables this node depends on |
| `resolveOutputs?` | the variables this node *produces* (§3) |
| `connection` | target/source handle rules, incl. `branches` |
| `agentSchema?` / `fromAgentConfig?` / `agent?` | the friendly shape Kopilot authors against |

`catalog/registry.ts` holds them (**26** manifests today);
`catalog/not-yet-migrated.ts` lists node types that still live only in web
(**3**: `webhook`, `webhook-endpoint`, `form-input`).

**The tracker and the `NodeType` enum are COUPLED.** `parity/catalog-coverage.test.ts`
asserts exact set equality between the enum and {registered manifests ∪
`NOT_YET_MIGRATED`}, in both directions. So a type can leave the tracker only by
being migrated (register a manifest) or retired (delete its enum member) **in the
same change**. A half-done retirement fails the build — that test passing is the
proof the change is complete.

### Migrating a node (copy, don't reinvent)

`catalog/nodes/wait.ts` + `core/wait/schema.ts` is the ~30-line template;
`http`/`list` show branch and complex cases.

- **Only the DATA half moves.** Catalog file takes types, zod schema,
  `defaultData`, validate, extractVariables, `resolveOutputs`, enums, labels.
  Web `schema.ts` becomes a `defineFromManifest(manifest, {})` merge site plus
  back-compat re-exports so no consumer import churns.
- **The React half stays in web** — `node.tsx`, `panel.tsx`,
  `trace-renderer.tsx`, `types.ts`. Zero-diff panels is enforced by review:
  `git diff --stat` on `core/<type>/` must show only
  `schema.ts` / `types.ts` / (`output-variables.ts`), never `node.tsx` or
  `panel.tsx`.
- **`defaultData` must parse `configSchema`.** The coverage test's fixture
  supplies only `{ id, type, title }`. Two recurring fixes: `selected:
  z.boolean().default(false)` (the node factory sets it), and fields that are
  required-but-empty on a fresh node — move required-ness into the VALIDATOR with
  an identical message and severity, never keep `.min(1)` in the schema.
- **Engine shadow-interface sweep**: replace per-processor config interfaces with
  `Pick<CatalogXNodeData, …>`. Where a processor compares string literals against
  enum-typed members, project with template literals (`` `${Method}` ``) — string
  enums don't compare against literals.
- **Drift found during a move gets FIXED in the same PR** and called out in the
  body. This is not optional politeness: the defaults-parse test alone has caught
  real bugs in 2 of 5 migration batches (http's timeout ms/s unit mismatch,
  `resource-trigger`'s `entityDefinitionId`).
- Anything a panel or `index.ts` imports by name must keep resolving through the
  same path: **catalog export → `client.ts` export → web shim**. Shimming before
  exporting once shipped a broken dev server.
- **`validate` is required on a manifest**, so migrating a node type that had no
  web-side `validator` means writing one. Mirror exactly what the processor
  hard-requires and nothing more — anything stricter newly blocks publishing for
  graphs that run today (checklist errors gate the Publish button). `dataset` and
  `document-extractor` both went through this.
- **Give it a trace renderer if it has none.** Not part of the data contract, but
  it is the second half of the slice by convention: without one the run panel
  shows no Preview tab at all and the author reads raw JSON in a 300px `<pre>`
  (`panels/run/components/node-execution-card.tsx` switches on `traceRenderer ?`).
  Register it beside `component`/`panel` in `core/index.ts`; `defineFromManifest`
  passes it straight through. Clamp for **display only** — the persisted outputs
  feed downstream nodes verbatim, so truncating a stored passage shortens every
  chunk or degrades the reply. `core/knowledge-retrieval/trace-renderer.tsx` is
  the reference, and each has a smoke test because `TraceRenderBoundary` swallows
  crashes: a renderer that throws on every real payload looks like "no preview",
  not like a failure.

---

## 3. Output resolution — one contract, two orchestrations

A node's outputs are described once, by `manifest.resolveOutputs`, and consumed
by two callers:

- **Browser** — `store/var-availability.ts` `computeNodeOutputs`, which fills the
  variable picker.
- **Server** — `catalog/resolve-outputs.ts` `resolveNodeOutputs` /
  `resolveGraphOutputs` (neverthrow, `orgId` first, memoized topological walk
  with a visited-set cycle guard).

`parity/output-resolution-parity.test.ts` walks a fixture graph of every migrated
type through both. **Be precise about what it proves:** no web-side
`outputVariables` override survives, so `definition.outputVariables ===
manifest.resolveOutputs` *by reference*. It therefore proves the two
**orchestrations** agree (topological order, context assembly, memoization) — not
that two implementations agree, because there is only one. It will catch a future
web-side override or context drift. Don't cite it as more than that.

**Both call sites try/catch the resolver.** A throwing manifest degrades to "no
outputs for this node" rather than poisoning graph-wide resolution — one bad node
must not blank the builder picker and every Kopilot tool (#1609).

**Resource-tier note:** there is no alias map and none is needed. Every reader of
`context.allResources` immediately collapses it with
`new Map(allResources.map(r => [r.id, r]))`. Server side is `getCachedResources`
+ `findCachedResource`.

### Server-only leaf modules — the `client.ts` rule

`catalog/build-output-context.ts`, `catalog/resolve-outputs.ts` and
`catalog/derive-trigger-server.ts` import the org cache (→ inbox service →
bullmq). Exporting them from `client.ts` **500'd every page** ("Can't resolve
'child_process'", #1579 → fixed #1582). They get their own leaf subpath exports
(`@auxx/lib/workflow-engine/catalog/<file>`) and `client.ts` carries NOTE
comments.

Do not route them through the `workflow-engine` index barrel either — it
statically loads `WorkflowEngine`, a known cycle that yields
`BaseAiNodeProcessor undefined`. **Any future catalog module that touches the org
cache follows the same rule.**

---

## 4. The engine

`core/node-processor-registry.ts` maps `WorkflowActionType` → processor.
Processors extend `BaseNodeProcessor` (`nodes/base-node.ts`) and implement:

- **`preprocessNode(node, contextManager)`** — validate config against the zod
  schema, resolve variables, return `{ inputs, metadata }`. All variable
  resolution and range-checking belongs here, against *resolved* values: a
  bindable field holds a reference string in variable mode, so the schema is
  widened with `variableBound(...)` and the range is enforced after resolution.
- **`executeNode(node, contextManager, preprocessed)`** — do the work, return
  `{ status, output, outputHandle }`.
- **`extractRequiredVariables(node)`** — the dependency declaration.
- **`validateNodeConfig(node)`** — author-time errors/warnings.

Two conventions worth knowing:

- **`extractIdFromValue` echoes the reference back** when a variable is missing
  (via `resolveVariableValue`). So an unresolved binding arrives as its own path
  string, not `undefined`. If you need fail-closed behaviour, compare the
  resolved value against the raw reference and drop it explicitly.
- **Output handles are what the UI renders, not what the manifest declares.**
  `parity/builder-rendered-handles.ts` is a hand-maintained record of the handles
  each `node.tsx` actually draws. Several processors emit an `'error'` handle no
  UI renders, allowlisted in `parity/contract-drift-allowlist.ts`. Declaring
  `connection.branches` in a manifest does **not** change this — `format` and
  `list` are migrated and still allowlisted, while `crud`/`http` are not because
  their UI genuinely renders `['source','fail']`. Fixing one means editing
  `node.tsx`, which collides with the zero-diff rule; treat it as its own change.

---

## 5. Edges and handles — the connection contract

An edge is a plain object inside `Workflow.graph.edges`. There is no `Edge`
table and no edge model; the graph jsonb is the entire store.

```ts
{ id, source, sourceHandle, target, targetHandle,
  data: { sourceType, targetType, isLoopBackEdge? } }
```

`data.sourceType`/`targetType` are the *node* types denormalized onto the edge so
`edges/custom-edge` can colour and route without looking nodes up mid-render.

**Handle vocabulary.** The graph builder defaults absent handles to
`sourceHandle: 'source'` / `targetHandle: 'target'`. Beyond those:

| Handle | Means | Read by |
| --- | --- | --- |
| `source` | the success path | `getNextNodes` |
| `true`/`false`, branch ids | conditional outputs (`manifest.connection.branches`) | `getNextNodes` |
| `fail`, legacy `onError` | failure route | `findFailureEdge` |
| `target` | the **only** handle counted as execution flow *into* a node | `detectJoinPoints` |
| `loop-start` / `loop-back` | loop body entry / iteration return | `buildLoopInfo` |
| `input` | form-input data wired into a trigger | deliberately **excluded** from join detection |

The `targetHandle === 'target'` filter in `detectJoinPoints` is load-bearing.
Without it a `loop-back` or form-input `input` edge makes its target look like a
convergence point, and the engine parks there waiting for branches that will
never arrive.

**React Flow owns edges in the browser — `store/edge-store.ts` does not.** Every
method on that store is marked `@deprecated` in favour of
`useStoreApi().setEdges`. It is legacy scaffolding; read and write edges through
React Flow's store.

**Connection validity is deliberately thin.** `services/edge-validation-service.ts`
rejects exactly three things: a missing endpoint, a self-connection, and an exact
duplicate (same source + target + *both* handles). Type compatibility is never
checked there, because it is enforced one level up: `useAvailableBlocks` decides
whether a source handle is connectable at all, so an illegal target never offers
a handle to drop on. That is why there is no "invalid connection" toast.

**Handles render their connected state off node data, not off edges.**
`_connectedSourceHandleIds` / `_connectedTargetHandleIds` live in `node.data`,
are rebuilt on load by `utils/workflow-initializer.ts` and patched on every
add/remove by `getNodesConnectedSourceOrTargetHandleIdsMap`
(`utils/edge-utils.ts`). Like every `_`-prefixed key they are **derived canvas
state, stripped on every save** — see `catalog/derived-keys.ts`, which is the one
declaration of that rule, and its test asserting no `configSchema` may declare
one.

### Graph traversal — what the engine does with those edges

`core/workflow-graph-builder.ts` compiles the persisted graph into a
`WorkflowGraph` (cached per workflow id on the engine instance), in four passes:

1. **Filter** — drop UI-only types (`note`, `group`, `annotation`, `comment`) and
   any node whose type has no registered processor.
2. **Bypass disabled nodes** — a node with `data.disabled` is dropped and each of
   its outgoing edges becomes a bypass edge from the node *before* it, carrying
   the incoming edge's `sourceHandle` and the outgoing edge's `targetHandle`.
   Two sharp corners: chasing a chain of disabled nodes stops with a
   `Skipping complex disabled node routing` warning the moment a link has
   anything other than exactly one outgoing edge — **that path is silently
   dropped** — and bypasses are deduped by `source→finalTarget` pair, so two
   handles from the same source landing on the same target collapse into one
   edge. Disabling a node in the middle of a fork is not a safe edit.
3. **Transform + index** — `edgesBySourceHandle` (`"nodeId:handle"`),
   `edgesByTarget`, per-node `nodeRoutes`, `entryNodes`, `terminalNodes`,
   `loopNodes`.
4. **Analyse** — cycle detection, then `detectForkPoints` / `detectJoinPoints` /
   `mapForksToJoins`.

Routing at run time (`core/graph-navigation.ts`):

- `getNextNodes(graph, nodeId, handle)` tries the exact handle, then **falls back
  to `source`**. When the unmatched handle is error-ish, it logs a loud warning —
  a succeeded result carrying an error-ish handle with no wired edge legitimately
  continues down the success path (http's `error_strategy: 'none'`), but the same
  fallback would otherwise mask a mis-wired fail branch.
- A **failed** result never reaches that fallback. `findFailureEdge` runs first
  and prefers the handle the processor actually emitted, then legacy `onError`;
  `source` is explicitly excluded so a failure can never walk the success path.
  No failure edge wired ⇒ the run throws.
- `outputHandles` (plural) exists on the result type and is never used. One
  result, one handle.

Fork/join is inferred, not declared:

- A **fork** is one source handle with more than one edge. `findJoinForFork` BFSes
  every branch, intersects their reachable sets, and takes the nearest common
  descendant as the join.
- A **join** is a node with >1 incoming `target`-handle edge. Its config is read
  from `data.joinConfig` **or** `data.mergeConfig` (`joinType`, `requiredCount`,
  `timeout`, `mergeStrategy`, `errorHandling`), defaulting to `all` /
  `merge-all`.
- A fork with no common descendant is an **orphan fork** — a fan-out. The engine
  runs the branches to completion in parallel and then stops; there is no
  post-fan-out continuation.
- Branches execute in isolated child contexts and merge at the join
  (`core/context-merger.ts`, `core/branch-merger.ts`); a branch that reaches the
  join first registers a continuation and returns.

Loops are the one place the cycle guard is relaxed: `executeWorkflowNodes` breaks
on `contextManager.hasVisitedNode` for every type **except** `loop`. The hard
backstop is `maxIterations = 1000` for the whole run.

---

## 6. A run, end to end

Two entry paths converge on the same engine.

**Production.** A domain event (`message:received`, a record change, a schedule
tick, a webhook, an app trigger) reaches a dispatcher under
`packages/lib/src/events/handlers/` or a scheduler. The dispatcher does the
cheap matching itself — it reads *published* graphs out of the org cache
(`getCachedWorkflowAppsByTrigger`), applies the trigger node's own filters
(channel scope, machine-mail tier, own-address, condition groups), and enqueues
one BullMQ job per surviving workflow. The job
(`packages/lib/src/jobs/workflow/*-trigger-job.ts`) creates the run and executes
it. `trigger-message-workflows.ts` → `message-trigger-job.ts` is the reference
pair; resource, scheduled, polling, webhook-endpoint and app-trigger jobs all
mirror it.

**Test run from the builder.** `POST /api/workflows/[workflowId]/run` — gated on
instance **`edit`**, because test-running is authoring. The route creates the
run, subscribes to Redis, kicks off `executeWorkflowAsync`, and streams the
result back over the *same* POST response as SSE. `workflowId` here is a
`Workflow.id` (a version/draft), not the parent `WorkflowApp.id`.

Both then run:

```
WorkflowExecutionService.createRun()      → WorkflowRun row (status RUNNING)
  .executeWorkflowAsync(run, reporter)
    WorkflowEngine.executeWorkflow()
      buildGraph() → executeWorkflowNodes() loop
        per node: INSERT WorkflowNodeExecution (Running)
                  preprocessNode() → UPDATE .inputs
                  emit NODE_STARTED
                  execute() (or LoopExecutionManager for `loop`)
                  UPDATE outputs/status, emit NODE_COMPLETED | NODE_FAILED
      → UPDATE WorkflowRun (SUCCEEDED | FAILED | PAUSED)
```

**Evidence tables.** `WorkflowRun` stores an immutable `graph` snapshot plus
`inputs`, `outputs`, `status`, `elapsedTime`, `totalTokens`, `totalSteps`, and
the pause columns (`pausedAt`, `pausedNodeId`, `resumeAt`, `serializedState`).
`WorkflowNodeExecution` is one row per node execution with `index`,
`predecessorNodeId`, `inputs`, `processData`, `outputs`, and an
`executionMetadata` blob carrying `depth`, `forkId`, `branchIndex`,
`executionPath` and loop info — that blob is what lets the run panel rebuild a
tree from a flat table.

**Event transport is Redis pub/sub, one channel per run.**
`RedisWorkflowExecutionReporter.emit` publishes to `workflow:run:<runId>`;
`WorkflowEventType` (`workflow-engine/shared/types.ts`) is the closed vocabulary
— workflow lifecycle, node lifecycle, loop lifecycle, connection/run. **Emission
is best-effort**: `emit` catches and logs, never throws, so a Redis outage
degrades the live view without failing the run. The DB rows are the truth; the
events are a tail.

Two SSE endpoints consume that channel, and they are not interchangeable:

| Endpoint | Shape | Gate | Use |
| --- | --- | --- | --- |
| `POST /api/workflows/[workflowId]/run` | starts the run *and* streams it | instance `edit` | builder test run |
| `GET /api/workflow/run/[runId]/events` | replays `WorkflowNodeExecution` rows, then tails | instance `view` | opening an existing/finished run |

The replay endpoint also synthesizes a terminal `workflow-finished` for an
already-completed run, so a client sees the same event sequence whether it
connected before or after the run ended.

Client side, `~/hooks/use-workflow-run.tsx` owns the POST-SSE connection (via
`useSSE` — a fetch stream, **not** `EventSource`, because the run needs a body)
and dispatches each event into `hooks/run-hooks/*`, one hook per event type,
each writing `store/run-store.ts`. The run store holds `activeRun`,
`runViewMode` (`live` | `previous` | `single-node`), a `nodeExecutions` map, the
loop-iteration map and the execution tree. Node status on the canvas and edge
colours are downstream of that store
(`use-workflow-run-node-sync`, `use-edge-status-updater`).

**Pause/resume.** A node returns `status: Paused` with a `PauseReason`;
`shouldPauseBeTerminal` (`core/pause-resume.ts`) decides whether that pauses the
whole run or just the branch — sequential pauses are always terminal, in-branch
pauses default to non-terminal. The engine serializes context into
`WorkflowRun.serializedState` and throws `WorkflowPausedException`. Resume comes
from a scheduled job (`wait`), an approval decision, a timeout or an admin
cancel, all through `WorkflowExecutionService.resumeWorkflow(runId, fromNodeId,
payload)`. `WORKFLOW_PAUSED`/`WORKFLOW_RESUMED` are deliberately **not**
terminal SSE events — the builder connection stays open across them.

**Single-node run** is a third mode: `runSingleNode` executes one node against
`core/single-node-executor.ts` with a synthetic context and writes a
`WorkflowNodeExecution` stamped `triggeredFrom: SINGLE_STEP` with a null
`workflowRunId` — it creates **no** `WorkflowRun`, so it never appears in run
history. `runViewMode: 'single-node'` is the only run mode that leaves the
canvas editable.

---

## 7. The canvas — stores, interactions, panels

**React Flow's store is the graph.** Nodes and edges live in
`useStoreApi()`; every Zustand store beside it holds something else and must not
duplicate the graph. What each one owns:

| Store | Owns |
| --- | --- |
| `workflow-store` | workflow identity, dirty flag, drag state, `kopilotEditing`, `instanceReadOnly`, connect/menu payloads |
| `canvas-store` | viewport, grid/minimap settings, version-preview read-only |
| `panel-store` | the drawer's frame stack, panel width, pinning, run-panel tab, Kopilot thread |
| `run-store` | active run, node executions, loop iterations, execution tree |
| `selection-store` / `interaction-store` / `clipboard-store` | selection ops, pointer/pan mode, copy-paste |
| `use-var-store` | the variable index — outputs per node, availability per node, upstream/downstream maps |
| `history-manager` | undo/redo snapshots |
| `event-bus` | cross-store notifications (`selection:changed`, `node:updated`, `drag:ended`, `workflow:externalUpdate`) |

`store/edge-store.ts` and `store/node-store.ts` are dead: the former is fully
`@deprecated`, the latter is an empty stub (and `workflow-store.exportWorkflow`
still carries a TS18004 scar from when it wasn't).

**Interactions all funnel through hooks, never through components.**
`use-node-interactions` (add/select/drag/connect/delete/duplicate),
`use-edge-interactions` (hover, edge changes, single/bulk/branch delete),
`use-selection-interactions`, `use-context-menu`. `canvas/workflow-canvas.tsx`
only wires the handlers onto `<ReactFlow>`.

Adding a node has three front doors and one factory: the `+` on a source handle
(`ui/node-handle/source-handle.tsx` → `AddNodeTrigger`), the pane context menu,
and clicking an edge to insert a node into it (`edges/custom-edge/index.tsx`).
All three go through `utils/node-layout` `NodeFactory`, which mints the id,
seeds `defaultData`, inherits `parentId` for loop bodies, and initializes the
derived `_connected*` arrays. A node created any other way renders every handle
as unconnected.

**Panels are frames in one drawer, not separate drawers.**
`panels/workflow-panel-drawer.tsx` owns a single `DockableDrawer` + `NavStack`.
`panel-store.frames` is `[]` (closed), `[base]`, or `[base, overlay]` — **never
deeper**. The base is a node (or `empty`); Test / Settings / Kopilot are
*peer overlays*, so opening one while another is up replaces it. That is what
keeps the back chevron unambiguous. Selecting a node sets the base and pops the
overlay. See `plans/workflow/panel-nav-stack.md`.

The node's panel body resolves from the frame's `nodeId`, not from React Flow's
selection — the frame must stay stable while an overlay covers it. Panel
components come from `unifiedNodeRegistry.getPanel(type)`, registered beside
`component` and `traceRenderer` in `nodes/core/index.ts`.

**Panels write config through one hook.** `use-node-data-update`'s
`handleNodeDataUpdateWithSync` immer-patches `node.data` in React Flow, then
fires `debouncedSave()` and a history snapshot. Never `setNodes` from a panel
directly — that skips both.

**Saving is debounced and CAS-guarded.** `use-workflow-save` accumulates pending
changes (graph, name, icon, config, env vars…) and flushes them through one
`workflow.update` tRPC mutation after 5 s. It strips derived keys and re-derives
trigger columns before sending. A `409 CONFLICT` latches `conflictRef` and
**stops that editor saving entirely** — its in-memory graph is stale, so every
retry would either re-conflict or clobber. The user must reload.

**`useReadOnly` is the single client authority** for "can this canvas be
edited", with five sources: version preview, viewer embed, run playback,
per-workflow instance access, and `kopilotEditing`. Every affordance keys off
it, which is also its cost model — a flip re-renders all of them. Nothing that
changes more than a couple of times per turn belongs in it.

**The variable index is a derived projection, kept in sync by one bridge.**
`use-var-store-sync` subscribes to React Flow's store, bails on
`nodes`/`edges` reference equality, RAF-debounces, and calls
`useVarStore.updateGraph`, which topologically walks the graph and recomputes
each node's outputs via `computeNodeOutputs` — the browser half of §3. Nothing
else may push into that store.

---

## 8. Performance — what costs, and how to measure it

The failure mode this section exists for: a canvas that was smooth becomes janky
on node drag, and the cause is a **subscription**, not an algorithm. React Flow
replaces `state.nodes` with a new array on every drag frame (~60/s). Anything
that subscribes to the array — or to something derived from it — re-renders at
that rate while a node moves. The diff that introduces it looks harmless, and it
only shows on a graph with enough nodes.

### Subscription rules

- **Never `useStore((s) => s.nodes)` or `s.edges`.**
  `ui/variables/variable-explorer-enhanced.tsx:150` does exactly this today, so an
  open variable explorer re-renders on every drag frame. Subscribe to a scalar
  (`s.nodes.length` — `hooks/use-workflow-trigger.ts:32`) or project narrowly and
  wrap in `useShallow` (`panels/property-panel.tsx:31`).
- **`useShallow` suppresses the re-render, not the selector.** The selector body
  still runs on every store update. `s.nodes.find(n => n.id === id)` is fine; a
  `.reduce` over every node is not — `hooks/use-available-variables.tsx:86`
  builds a full title map per update and defends itself with a manual hash ref.
  That ref is the tell, not the fix.
- **Whole-graph derivations belong behind `store.subscribe` + RAF, never a render
  subscription.** `hooks/use-var-store-sync.ts` is the reference: reference-equality
  bail-out, then one RAF-coalesced recompute.
- A node component that subscribes to state its own panel writes re-renders the
  whole canvas on every keystroke in that panel.

### Where drag time actually goes today

`handleNodeDrag` (`hooks/use-node-interactions.ts:676`) rebuilds the entire node
array with `produce()` and calls `setNodes` on **every pointer frame** — O(nodes)
per frame before React Flow does any work. That fresh array reference then fans
out to every subscriber, and in particular to `updateGraph`
(`store/use-var-store.ts`), which per RAF runs a `topologicalSort` plus a
parent-id check shaped `nodes.some(n => state.graph.nodes.find(...))` — O(n²) —
for a change that is *only* a position and cannot affect any variable.

The mitigations in the tree today are drag gates, not fixes:
`store/panel-store.ts:350` drops `selection:changed` while `isDragging` (else the
panel opens mid-drag and re-renders the editor shell) and re-opens it 50 ms after
`drag:ended`; `useOnViewportChange` is debounced 300 ms. **Read `isDragging` as
evidence that something downstream is too expensive**, not as architecture. Two
real fixes are available and unclaimed: skip the var-store sync when only
`position` changed, and make the parent-id check a map lookup.

### There is no perf debug switch today

Worth stating plainly, because it keeps getting assumed: nothing in the tree or
in git history ever shipped one. `hooks/use-variable-performance.ts` is a
`useDebounce` and nothing else, and `canvas/workflow-canvas.tsx:20` has a
commented-out `DevTools` import pointing at a `~/components/devtools` that does
not exist. Measuring today means driving React DevTools' Profiler by hand, which
is why regressions land.

### Proposed switch (design, not shipped)

One dev-only flag, three probes, one report. Kept here so the next person builds
*this* rather than another ad-hoc `console.log` pass.

- **Gate** — `?perf=1` or `localStorage['workflow:perf']`, read **once** into a
  module-level const, and `&& process.env.NODE_ENV !== 'production'`. Reading the
  flag must never be part of a render path, or the switch becomes its own cost.
- **Probe 1 — render attribution.** `useRenderTrace('VariableExplorer')` bumps a
  module counter keyed by name. No state, no re-render.
- **Probe 2 — the drag window.** `handleNodeDragStart` opens a window;
  `handleNodeDragStop` closes it and reports: frames, dropped frames
  (`performance.now()` deltas > 16.7 ms), cumulative time inside `setNodes`, and
  the per-component render counts collected since `dragStart`. One
  `console.table`, sorted by render count — the offending subscription is
  whatever sits at the top with a count equal to the frame count.
- **Probe 3 — User Timing marks.** `performance.mark`/`measure` around
  `updateGraph`, `computeNodeOutputs` and `topologicalSort`, so a Chrome
  performance recording attributes the cost in its Timings track without any
  console reading.

The acceptance bar for the switch: on a 50-node graph, dragging one node should
show render counts in the low tens, not ~60 × the number of mounted panels. Any
component whose count tracks the frame count is the regression.

---

## 9. `workflows/graph-edit/` — the draft-mutation layer

Eight mutations, all funnelled through `runGraphMutation`:

`addNode` · `updateNode` · `deleteNodes` · `connectNodes` · `disconnectNodes` ·
`setTrigger` · `replaceGraph` · `applyTemplate`

Supporting files: `read.ts` (`loadDraftContext`), `validate.ts` (auto-validation
per mutation), `refs.ts` + `normalize/` (the `{{Node Title.path}}` grammar,
friendly⇄id both directions), `layout.ts` (dagre — **the model never sends
coordinates**), `place-node.ts`, `patch-config.ts` (deep-path config writes),
`run-node.ts` (single-node simulated run), `turn-snapshot.ts`, `turn-lock.ts`.

**`persist.ts`'s `persistDraft` is THE write seam.** It goes through
`WorkflowService.update`, so CAS, `assertMailTriggerNotPersonal`, and trigger
re-derivation all run on every write. Snapshot-before-write and
realtime-after-write wrap it.

Rules that are easy to get wrong:

- **CAS is real.** `WorkflowService.update` throws `ConflictError` (409) under
  `SELECT … FOR UPDATE` with a graph-hash compare. Every write sends
  `expectedGraphHash`, including `revertWorkflowTurn` — a racing write 409s the
  revert rather than clobbering it.
- **Validation severity:** zero triggers is a **warning**, not an error
  (incremental building requires it). More than one trigger, or an edge into a
  trigger, stays blocking. `ALLOW_TRIGGER_DELETE = true`.
- **Loop delete is recursive over `parentId` children, never a reparent.**
  Add-inside gives only the FIRST body node a `loop-start` edge.
- **`replaceGraph` is restricted to empty drafts.**
- **Bare-ref normalization must withhold prose keys** (`title`, `desc`) or a
  title equal to another node's title rewrites into a raw node id.
- Node ids are **nanoid (21 chars)**, not cuids.
- **`applied: false` is the BLOCKING vocabulary — never a no-op.** A mutation
  that changed nothing returns `applied: true, unchanged: true` and skips the
  write, the snapshot and the realtime signal. `mutationToToolResult` renders
  `applied: false` as "Update X blocked", so reporting a harmless idempotent
  write that way sends the caller off to repair something that is already
  correct. The no-op check is guarded on `envVars`/`variables`/`icon`, which
  `set_workflow_details` and `apply_template` pass through the same seam.
- **A node with no manifest is not an issue.** Uncatalogued nodes (app blocks,
  not-yet-migrated types) are named once on `GraphSummary.readOnlyNodes`, never
  as a per-node `info` issue — an un-actionable line repeated on every read
  buries the issues that ARE actionable.
- **Outputs are enrichment; they must never fail a write.**
  `resolveGraphOutputs` runs BEFORE `persistDraft`, so it returns
  `err` rather than throwing — a cache blip must not abort an
  already-validated edit. It also must not degrade to an empty app-block
  lookup: `checkVariableRefsAgainstOutputs` would then flag valid references as
  unresolvable, and inventing issues is worse than reporting none.

---

## 10. The Kopilot workflow-builder capability

`ai/kopilot/capabilities/workflow-builder/` — a capability factory plus **20**
tool files sharing one authoring guard. Registered in `apps/web`'s Kopilot stream
route registry, gated on `page === 'workflow.builder'` (deliberately **no**
`isAdminOrOwner` gate — the per-instance authoring ladder re-asserts fail-closed
in every tool).

- **Undo rides the canvas's existing client-side history**, not a per-turn card.
  The `workflow:draft-updated` subscriber records ONE history entry after
  rehydrating a clean canvas, so a Kopilot turn is one Cmd+Z step. The server
  turn snapshot survives only as failed-turn atomicity.
- **Never derive "a turn is running" from the chat's `isStreaming`.** It goes
  false on `approval-required` and true again on resume, because it describes the
  streaming UI, not the turn. The authoritative boundary is server-side:
  `withTurnEnd` (`ai/agent-framework/engine.ts`) fires `onTurnEnd` exactly once on
  completion, error, abort and client disconnect. `graph-edit/turn-lock.ts`
  publishes it as `workflow:kopilot-turn`.
- **The builder DROPS `workflow:draft-updated` while the canvas is dirty** — no
  queue, no catch-up fetch. That is what made the canvas edit lock necessary
  rather than cosmetic: one user edit mid-turn stranded the canvas on a
  half-applied turn, which the next save committed over the rest of the agent's
  work. **Anything new that writes the draft out-of-band inherits this hazard.**
- `useReadOnly` has five sources; the fifth (`kopilotEditing`) is affordable only
  because it flips exactly twice per turn. Every canvas affordance re-renders when
  it changes — nothing finer-grained may be added there.

---

## 11. The parity harness — what CI actually gates

`apps/web/src/components/workflow/parity/`:

| File | Gates |
| --- | --- |
| `catalog-coverage.test.ts` | enum ≡ manifests ∪ `NOT_YET_MIGRATED`; defaults parse their own schema |
| `output-resolution-parity.test.ts` | browser vs server orchestration (§3) |
| `builder-engine-parity.test.ts` | declared vs written node data keys |
| `engine-write-scrape.ts` | textual scrape of processor `setNodeVariable` writes |
| `builder-declared-keys.ts` | catalog-first declared-shape reader |
| `builder-rendered-handles.ts` | hand-maintained record of rendered handles |
| `contract-drift-allowlist.ts` | known, deliberate divergences |

`engine-write-scrape.ts` is textual because processors can't be executed from a
web test (they import bullmq/redis/DB) and TS interfaces aren't
runtime-reflectable. It has a documented retirement path.

---

## 12. Verification recipe

```bash
node scripts/ci/typecheck-ratchet.js --package lib   # NEVER bare tsc
node scripts/ci/typecheck-ratchet.js --package web
cd apps/web    && pnpm exec vitest run src/components/workflow
cd packages/lib && pnpm exec vitest run src/workflow-engine
pnpm exec biome check --write <touched dirs>
```

After changing `client.ts` exports, local web dev needs
`pnpm --filter @auxx/lib build` or the shims fail with "Export … doesn't exist in
target module". That build runs `generate:exports` codegen which may churn
`packages/lib/package.json` from unrelated tree state — don't commit that churn.

---

## 13. Gotchas, collected

- **`SearchService.search` has no ACL of its own** — see
  `docs/knowledge-base-architecture-guide.md` §6. Any node reaching it must
  resolve its own access first and treat an empty set as "search nothing".
- **The workflow AI node and knowledge retrieval run on the workflow AUTHOR's
  authority** (`sys.userId` = `createdById`). A non-member composes to an empty
  capability set and reads deny — the correct outcome. Workflows are not
  permission principals yet; those are the sites to change when they become one.
- **`WorkflowRun.graph` is immutable evidence.** Data migrations that reshape node
  config walk `Workflow.graph` and `WorkflowTemplate.graph` only.
- **Bundled file templates are never written to the DB** (`workflows/templates/`
  is JSON merged at read time) — edit them by hand; a migration won't reach them.
- **Trigger `entityDefinitionId` holds BOTH keyspaces** (CUID *and* slug). Gate on
  `isEntityDefinitionType`, never "the entityDefs cache resolved it" —
  `thread`/`article` have EntityDefinition rows but are not in
  `ENTITY_DEFINITION_TYPES`.
- **`WorkflowEngine` is loaded dynamically on purpose.** A static import gives
  `BaseAiNodeProcessor undefined`.
- **A trace renderer that throws looks like "no preview", not a failure** —
  `TraceRenderBoundary` swallows it. Test renderers.
- **Run events are best-effort, DB rows are truth.** `RedisWorkflowExecutionReporter.emit`
  catches and logs everything. Never build correctness (a status transition, a
  counter, a downstream job) on an event arriving — read the `WorkflowRun` /
  `WorkflowNodeExecution` row.
- **An unmatched output handle falls back to `source`.** `getNextNodes` logs a
  warning for error-ish handles and continues down the success path. A branch
  that "somehow ran anyway" is usually a `sourceHandle` typo, not an engine bug.
- **The two run SSE endpoints have different gates** — `POST …/run` requires
  instance `edit` (it starts a run), `GET /api/workflow/run/[runId]/events`
  requires `view` (it only replays). A new run surface must pick deliberately;
  they are not interchangeable.
- **Subscribing to `state.nodes` is a canvas-wide regression, not a local one.**
  See §8 — one such subscription re-renders that component ~60×/s for the whole
  duration of every node drag.
