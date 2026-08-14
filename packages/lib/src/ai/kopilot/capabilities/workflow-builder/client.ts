// packages/lib/src/ai/kopilot/capabilities/workflow-builder/client.ts

/**
 * Client-safe constants for the workflow-builder Kopilot capability. NO
 * `'use client'` directive on purpose — a directive here would turn these
 * exports into proxy stubs for server importers (constants-only modules must
 * stay directive-free).
 */

/**
 * Page identifier for the workflow BUILDER surface — the docked Kopilot chat
 * on `/app/workflows/[id]`. Deliberately distinct from `workflow.ai-node`
 * (`capabilities/workflow/`), the toolset an AI node uses at runtime inside a
 * run: separate directory, separate page key, so a runtime AI node can never
 * inherit graph-editing tools.
 */
export const WORKFLOW_BUILDER_PAGE = 'workflow.builder'

/**
 * Toolset slug grouping the graph-editing tools. `<page>.<group>` shape,
 * matching `workflow.variable` (the AI node's native toolset).
 */
export const WORKFLOW_BUILDER_TOOLSET_SLUG = 'workflow.builder'
