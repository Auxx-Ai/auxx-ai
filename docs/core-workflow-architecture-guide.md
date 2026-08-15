# Core Workflow Architecture Guide

**Scope:** the workflow system Auxx owns — the node catalog, the execution
engine, the draft-mutation service, and the Kopilot builder capability.

**Not this guide:** `docs/workflow-architecture-guide.md` covers the *Workflow
App System* — third-party blocks contributed by installed apps (SDK bundles,
Tag-based reconciler, iframe sandboxing, S3 loading). Different subsystem, and
the only overlap is that an app block appears in the canvas alongside core nodes
(`nodes/app-workflow-block-processor.ts`).

Read this before touching node schemas, output variables, the engine's
preprocess/execute contract, draft mutations, or anything Kopilot does to a
workflow graph.

---

## 1. The four layers

```
packages/lib/src/workflow-engine/catalog/     ← 1. WHAT a node is (data contract)
packages/lib/src/workflow-engine/nodes/       ← 2. What a node DOES (execution)
packages/lib/src/workflows/graph-edit/        ← 3. How a draft is MUTATED
packages/lib/src/ai/kopilot/capabilities/workflow-builder/  ← 4. How Kopilot authors
apps/web/src/components/workflow/             ← the canvas, panels, run UI
```

The load-bearing idea: **a node's data contract lives in lib, its React lives in
web.** One node type is described once, in `catalog/nodes/<type>.ts`, and both
the builder and the engine read that description. Before the catalog existed the
two had independent copies that silently drifted — the parity harness (§7) exists
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

## 5. `workflows/graph-edit/` — the draft-mutation layer

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

---

## 6. The Kopilot workflow-builder capability

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

## 7. The parity harness — what CI actually gates

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

## 8. Verification recipe

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

## 9. Gotchas, collected

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
