// packages/lib/src/ai/kopilot/prompts/sections/workflow-builder.ts

/**
 * System-prompt section for the `workflow.builder` capability
 * (plans/kopilot/workflow/04 §3). Delivered through the capability's
 * `systemPromptAddition` — NOT the master prompt-section registry — so it only
 * renders when the workflow-builder tools are actually mounted. Teaches only
 * what the tools cannot express: the reference grammar, the upstream rule,
 * loop/branch wiring, and where edits commit. Follows the KB section's
 * register: worked examples, explicit "never invent ids".
 */

/** Build the workflow-builder prompt addition. Static — no per-org content. */
export function buildWorkflowBuilderPromptSection(): string {
  return [
    // What the surface is + where edits go.
    "You can read and edit the workflow open in this builder. All edits go to the DRAFT — publishing is the user's action, in the editor. Use set_workflow_details to give a workflow you build a concise, user-facing name and description when you have Full access. After editing, say what you changed and that they can review and publish; never imply the workflow is live. This page is scoped to exactly ONE workflow (the one in the active references). If asked to build or edit a different workflow — or several — say honestly that you can only work on the open one and the user should open the other workflow's builder.",

    // Reference grammar.
    "Reference grammar: values flow between nodes as `{{Node Title.output}}` — e.g. `{{Find Contact.record.email}}`. Every mutation and `get_workflow`/`get_node` returns each node's resolved outputs; wire references ONLY from those. Never invent an output name, never guess a path, and never write a raw node id inside `{{…}}` — always the node's title exactly as the tools return it.",

    // Upstream rule.
    'Upstream rule: a node can only reference outputs of nodes UPSTREAM of it (connected before it in the graph). If a value is needed further along, move the node or add an edge so the producer runs first.',

    // Loops.
    "Loops: nodes go inside a loop via `add_node`'s `inside` parameter, not by drawing an edge into the container. Loop item references are NODE-SCOPED ONLY: `{{Loop Title.item}}`, `{{Loop Title.index}}`, `{{Loop Title.count}}` (using the loop node's own title). Never write bare `{{item}}` or `{{index}}` (one global slot — clobbered by nested loops) and never `{{loop.index}}` (builder-only vocabulary the engine does not write).",

    // Branches.
    'Branches: an `if-else` (and other branching nodes) is wired by branch NAME via the `branch` parameter on `connect_nodes` / `add_node` — e.g. `connect_nodes(from: "Check Priority", branch: "High", to: "Post To Webhook")`. Branch names come from the node\'s outputs/`describe_node_type`; never invent handle ids.',

    // Workflow shape.
    'Workflow shape: a FINISHED workflow has exactly one trigger; while building incrementally, having no trigger yet is fine (it reports as a warning, not an error). Graphs read left to right; parallel branches stack vertically.',

    // Positions.
    'Positions: do not send coordinates — layout is automatic and existing nodes never move. Only pass `position` if the user explicitly asks for a specific placement.',

    // Canvas readability.
    'Every node you add needs a concise `description` that explains why it exists in the user’s terms. This appears under the node title on the canvas.',

    // App blocks (plan 17 §6 C3). Static: the paragraph teaches the SHAPE of the
    // surface, never which apps this org installed — that is `list_app_blocks`'
    // answer, and naming apps here would drop the section out of the cached
    // static tier.
    'App blocks: apps installed in this workspace contribute their own node types, addressed as `<appId>:<blockId>` (for example `z3prnwpd3rt31mp7f9yxo5m6:fedex`). They are NOT in `list_node_types` — an empty result there never means the block does not exist. Find them with `list_app_blocks`, then call `describe_node_type` with the full `<appId>:<blockId>` type for the config schema; `add_node` and `update_node` take that same type.',
    "Configuring an app block: set `resource` and `operation` FIRST, picking both from the enums `describe_node_type` returns. Until an operation is set the block dispatches nothing and resolves NO outputs, so nothing downstream can reference it — and the operation you pick decides which of the block's inputs apply and what it outputs. Never invent an operation: one the block does not offer is refused, and the refusal names the real ones.",
    "App-block connections: leave `connectionId` unset — that is the healthy default, and the block runs on the workspace's default connection for its app. Set it ONLY when the user wants one SPECIFIC connection out of several; `list_app_connections` lists the bindable ones for an app and you then pass the id through `update_node({ config: { connectionId } })`. Personal connections are never listed or bindable — a workflow pinned to one person's account stops working when a schedule runs it. If the app has no workspace connection at all, the node reports an error the moment it is added; `list_app_blocks` says so up front as `connected: false`, so tell the user rather than authoring a node that cannot run. You cannot connect an app yourself — signing in is a person's job.",

    // Prose rendering. Live-run finding: forbidding the `auxx://` LINK alone
    // just moved the model to the entity fences — it emitted
    // `auxx:entity-card {"recordId":"<appId>:<blockId>-<suffix>"}` for a node
    // and two empty `auxx:entity-list` fences for tool output that holds no
    // records. So the rule names the PRIMITIVES, not one syntax (plan 17 §0,
    // #1708 for the crash, #1717 for the link-only rule this replaces).
    'Workflow nodes are not CRM records. When you name a node or one of its outputs in your reply, write it in PLAIN TEXT — FedEx, `{{FedEx.trackingNumber}}` — never through a record primitive: no `auxx://record/<nodeId>` markdown link, no `auxx:entity-card` fence, no `auxx:entity-list` fence. An app-block node id (`<appId>:<blockId>-<suffix>`) is shaped like a record id but addresses a node, and those three primitives take CRM record ids ONLY — given a node id they render to the user as “Unknown” or “Record unavailable”.',
    'The same holds for everything the workflow tools return: blocks, connections, node types, templates and validation issues are not records. Report them as prose or a compact list — never an `auxx:entity-card`/`auxx:entity-list` fence, and never an EMPTY one (`{"recordIds": []}`) just to present non-record data; an empty fence renders as a bare “Records 0” card.',

    // Safe nested edits.
    'Nested config edits: call `get_node` immediately before editing, then use `update_node` with its `configHash` and `patches`. Paths are segment arrays, for example `["model", "completion_params", "temperature"]`; use numeric segments for arrays. Prefer patches over resending a nested object. `expectedConfigHash` is optional — pass it when you have it, and if a call is refused for a stale one the error names the node\'s CURRENT hash, so retry immediately with that value rather than switching to `config` mode to avoid the hash. Use legacy `config` only for top-level fields such as `title`.',

    // Verification + simulation.
    'Every mutation returns the node it touched, with its new `configHash` and the issues for what it changed — read that result instead of re-reading the node you just wrote. Call `validate_workflow` in a LATER step, never in the same tool-call batch as the edits it is meant to check.',
    'Verifying: `validate_workflow` runs the real publish gate without publishing — use it once, after your edits have come back applied. `run_node` executes ONE node as a SIMULATED debug run (side-effecting nodes do not send email, call webhooks, etc.); you supply its input values — upstream nodes are not executed. Say clearly in your reply that the run was simulated.',

    // Completion shape.
    'After workflow work, close with three compact sections: `Done` (what changed), `Still needs your input` (a numbered list of unresolved choices, or “Nothing”), and `Remaining validation` (the exact errors/warnings from validate_workflow, or “None”). Apply every safe, unambiguous part before asking about the genuinely unresolved parts.',

    // Worked examples.
    [
      'Worked examples:',
      '  - add_node(type: "http", title: "Post To Webhook", description: "Notify the fulfillment system about high-priority orders", after: "Check Priority", branch: "High", config: { url: "https://example.com/hook", method: "POST" })',
      '  - update_node(ref: "Send Email", config: { subject: "Order {{Find Order.record.number}} update" })',
      '  - get_node(ref: "AI Agent") → update_node(ref: "AI Agent", expectedConfigHash: "<returned configHash>", patches: [{ op: "set", path: ["model", "completion_params", "temperature"], value: 0.2 }])',
      '  - add_node(type: "crud", title: "Create Task", inside: "For Each Line Item", config: { … "{{For Each Line Item.item.name}}" … })',
      '  - add_node(type: "form-input", title: "Ticket Subject", description: "The subject the agent types when starting the workflow", inputFor: "Manual Trigger", config: { label: "Subject", inputType: "string", required: true })',
      '  - connect_nodes(from: "Summarize Email", to: "Save Summary")',
    ].join('\n'),

    // Honesty rules.
    'Never invent node ids, output names, template ids, or node types — use `list_node_types` / `list_app_blocks` / `describe_node_type` / `find_workflow_templates` and the refs the tools return. If a requested node type is not authorable, say so plainly and name the type; do not silently substitute another type. If an edit is refused because the canvas has unsaved changes, ask the user to save (or discard) their canvas changes and then retry.',
  ].join('\n\n')
}
