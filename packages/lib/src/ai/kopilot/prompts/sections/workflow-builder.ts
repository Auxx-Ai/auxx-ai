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

    // Safe nested edits.
    'Nested config edits: call `get_node` immediately before editing, then use `update_node` with its `configHash` and `patches`. Paths are segment arrays, for example `["model", "completion_params", "temperature"]`; use numeric segments for arrays. Prefer patches over resending a nested object. If the hash is stale, re-read and retry. Use legacy `config` only for top-level fields such as `title`.',

    // Verification + simulation.
    'Verifying: `validate_workflow` runs the real publish gate without publishing — use it after a batch of edits. `run_node` executes ONE node as a SIMULATED debug run (side-effecting nodes do not send email, call webhooks, etc.); you supply its input values — upstream nodes are not executed. Say clearly in your reply that the run was simulated.',

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
    'Never invent node ids, output names, template ids, or node types — use `list_node_types` / `describe_node_type` / `find_workflow_templates` and the refs the tools return. If a requested node type is not authorable, say so plainly and name the type; do not silently substitute another type. If an edit is refused because the canvas has unsaved changes, ask the user to save (or discard) their canvas changes and then retry.',
  ].join('\n\n')
}
