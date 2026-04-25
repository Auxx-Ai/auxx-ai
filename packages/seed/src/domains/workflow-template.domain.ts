// packages/seed/src/domains/workflow-template.domain.ts
// Idempotent seeder for public WorkflowTemplate rows used across all orgs

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import shopifyOrderLookupTemplate from '../templates/shopify-order-lookup-and-reply.template.json' with {
  type: 'json',
}

const logger = createScopedLogger('workflow-template-domain')

/** TemplateJson is the shape of a bundled template JSON file. */
interface TemplateJson {
  name: string
  description: string
  categories: string[]
  status: string
  popularity?: number
  triggerType?: string | null
  triggerConfig?: Record<string, unknown> | null
  requiredApps?: Array<{
    appSlug: string
    appTitle: string
    blockIds: string[]
    triggerIds: string[]
    required: boolean
  }>
  requiredEntities?: unknown[]
  envVars?: unknown[]
  variables?: unknown[]
  graph: Record<string, unknown>
}

/** All bundled templates seeded into WorkflowTemplate. */
const BUNDLED_TEMPLATES: TemplateJson[] = [shopifyOrderLookupTemplate as TemplateJson]

/**
 * WorkflowTemplateDomain upserts public WorkflowTemplate rows that all organizations
 * can instantiate from. Matches on `name` so re-runs update in place without breaking
 * the FK integrity of Workflows already instantiated from the template.
 */
export class WorkflowTemplateDomain {
  /**
   * Upserts all bundled templates. Safe to call repeatedly — matches on `name`.
   * @param db - Drizzle database instance
   */
  async insertDirectly(db: Database): Promise<void> {
    const { schema } = await import('@auxx/database')
    const { eq } = await import('drizzle-orm')

    for (const template of BUNDLED_TEMPLATES) {
      const existing = await db
        .select({ id: schema.WorkflowTemplate.id })
        .from(schema.WorkflowTemplate)
        .where(eq(schema.WorkflowTemplate.name, template.name))
        .limit(1)

      const values = {
        name: template.name,
        description: template.description,
        categories: template.categories,
        graph: template.graph,
        status: template.status,
        triggerType: template.triggerType ?? null,
        triggerConfig: template.triggerConfig ?? null,
        envVars: (template.envVars ?? []) as never,
        variables: (template.variables ?? []) as never,
        requiredApps: (template.requiredApps ?? []) as never,
        requiredEntities: (template.requiredEntities ?? []) as never,
        popularity: template.popularity ?? 0,
        updatedAt: new Date(),
      }

      if (existing.length > 0) {
        await db
          .update(schema.WorkflowTemplate)
          .set(values)
          .where(eq(schema.WorkflowTemplate.id, existing[0]!.id))
        logger.info('Updated workflow template', { name: template.name })
      } else {
        await db.insert(schema.WorkflowTemplate).values(values)
        logger.info('Inserted workflow template', { name: template.name })
      }
    }
  }
}
