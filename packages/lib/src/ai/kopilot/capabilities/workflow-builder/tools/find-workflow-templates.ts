// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/find-workflow-templates.ts

import { listFileTemplates } from '../../../../../workflows/templates'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const RESULT_LIMIT = 20

/**
 * Greenfield discovery (D13): search the public workflow templates — bundled
 * file templates merged with admin-curated DB rows, the same set the template
 * gallery lists — and hand back compact rows `apply_template` accepts.
 * Public product data (status `public` only), so no authorization gate.
 */
export function createFindWorkflowTemplatesTool(getDeps: GetToolDeps): AgentToolDefinition {
  void getDeps
  return {
    name: 'find_workflow_templates',
    permission: {
      target: 'none',
      note: 'Public workflow-template gallery (bundled file templates + admin-curated public rows) — the same protectedProcedure-only list every member sees; no org data.',
    },
    displayName: 'Find workflow templates',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'Search the public workflow template gallery by keyword. Returns template ids for apply_template (empty draft only) plus name, description, categories, and trigger type. Call with no query to browse.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword search over name + description.' },
      },
      additionalProperties: false,
    },
    buildDigest: (output) => {
      const out = (output ?? {}) as { templates?: unknown[] }
      return {
        label: 'Workflow templates found',
        resultCount: Array.isArray(out.templates) ? out.templates.length : 0,
      }
    },
    execute: async (args) => {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const search = query || undefined

      const fileItems = listFileTemplates({ ...(search ? { search } : {}), status: 'public' })

      // Lazy import — @auxx/services pulls its own module graph; keep it off
      // this capability's import time (same rule as graph-edit's applyTemplate).
      let dbItems: Array<{
        id: string
        name: string
        description: string
        categories: string[]
        triggerType: string | null
      }> = []
      try {
        const { getAllTemplates } = await import('../../../../../workflow-templates')
        const result = await getAllTemplates({
          ...(search ? { search } : {}),
          status: 'public',
          limit: RESULT_LIMIT,
        })
        if (result.isOk()) dbItems = result.value as typeof dbItems
      } catch {
        // Template DB unavailable — file templates still answer.
      }

      const templates = [...fileItems, ...dbItems].slice(0, RESULT_LIMIT).map((t) => ({
        templateId: t.id,
        name: t.name,
        description: t.description,
        categories: t.categories ?? [],
        triggerType: t.triggerType ?? null,
      }))

      if (templates.length === 0) {
        return {
          success: false,
          output: null,
          error: query
            ? `No public templates match "${query}". Try a broader keyword, or build the workflow incrementally with add_node.`
            : 'No public templates available.',
        }
      }
      return { success: true, output: { templates } }
    },
  }
}
