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

// There is deliberately no toolset slug here. These tools mount by page
// context, never by an org toolset grant — see the NOTE in
// `tools/graph-tool-helpers.ts` for why a slug disabled the whole capability.
