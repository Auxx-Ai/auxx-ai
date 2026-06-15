// packages/lib/src/cache/providers/workflow-templates-provider.ts

import { schema } from '@auxx/database'
import { desc, eq } from 'drizzle-orm'
import { FILE_TEMPLATES } from '../../workflows/templates'
import type { CachedWorkflowTemplate } from '../app-cache-keys'
import type { AppCacheProvider } from '../app-cache-provider'

/** Public file templates projected to the cached (graph-less, JSON-safe) shape. */
const cachedFileTemplates: CachedWorkflowTemplate[] = FILE_TEMPLATES.filter(
  (t) => t.status === 'public'
).map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  categories: t.categories,
  imgUrl: t.imgUrl,
  version: t.version,
  status: t.status,
  triggerType: t.triggerType,
  requiredApps: t.requiredApps as CachedWorkflowTemplate['requiredApps'],
  popularity: t.popularity,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
}))

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

    const dbTemplates: CachedWorkflowTemplate[] = templates.map((t) => ({
      ...t,
      categories: (t.categories ?? []) as string[],
      requiredApps: (t.requiredApps ?? []) as CachedWorkflowTemplate['requiredApps'],
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }))

    // Merge bundled file templates and re-sort the combined list.
    return [...dbTemplates, ...cachedFileTemplates].sort(
      (a, b) => b.popularity - a.popularity || b.createdAt.localeCompare(a.createdAt)
    )
  },
}
