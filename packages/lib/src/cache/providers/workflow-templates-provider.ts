// packages/lib/src/cache/providers/workflow-templates-provider.ts

import { schema } from '@auxx/database'
import { desc, eq } from 'drizzle-orm'
import type { CachedWorkflowTemplate } from '../app-cache-keys'
import type { AppCacheProvider } from '../app-cache-provider'

/** Computes public workflow templates (no graph blob) sorted by popularity */
export const workflowTemplatesProvider: AppCacheProvider<CachedWorkflowTemplate[]> = {
  async compute(db) {
    const templates = await db
      .select({
        id: schema.WorkflowTemplate.id,
        name: schema.WorkflowTemplate.name,
        description: schema.WorkflowTemplate.description,
        categories: schema.WorkflowTemplate.categories,
        imgUrl: schema.WorkflowTemplate.imgUrl,
        version: schema.WorkflowTemplate.version,
        status: schema.WorkflowTemplate.status,
        triggerType: schema.WorkflowTemplate.triggerType,
        requiredApps: schema.WorkflowTemplate.requiredApps,
        popularity: schema.WorkflowTemplate.popularity,
        createdAt: schema.WorkflowTemplate.createdAt,
        updatedAt: schema.WorkflowTemplate.updatedAt,
      })
      .from(schema.WorkflowTemplate)
      .where(eq(schema.WorkflowTemplate.status, 'public'))
      .orderBy(desc(schema.WorkflowTemplate.popularity), desc(schema.WorkflowTemplate.createdAt))

    return templates.map((t) => ({
      ...t,
      categories: (t.categories ?? []) as string[],
      requiredApps: (t.requiredApps ?? []) as CachedWorkflowTemplate['requiredApps'],
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }))
  },
}
