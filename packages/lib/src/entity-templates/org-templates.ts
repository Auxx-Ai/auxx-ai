// packages/lib/src/entity-templates/org-templates.ts
// Org-aware entity-template resolution (app-fields-and-entities-plan Phase 2). The
// static template registry is org-agnostic + file-based; app-projected templates
// are PER-ORG (they depend on the org's installed apps), so they cannot live in the
// static `templateMap`. This layer merges the static gallery with templates
// projected from each installed app's declared entities (`catalog.entities`,
// `defineEntity`) — the same installed-app catalog the connector `create` mutation
// reads.

import { getCachedInstalledApps } from '../cache'
import { projectAppEntityTemplates } from './app-template-projector'
import {
  getAllTemplates,
  getTemplateById,
  getTemplatesByIds,
  type TemplateSummary,
} from './template-registry'
import type { EntityTemplate } from './types'

/** Project every installed app's owned entities into installable templates. */
export async function getAppTemplates(organizationId: string): Promise<EntityTemplate[]> {
  const apps = await getCachedInstalledApps(organizationId)
  const templates: EntityTemplate[] = []
  for (const app of apps) {
    if (!app.entities?.length) continue
    templates.push(...projectAppEntityTemplates(app.app.slug, app.entities))
  }
  return templates
}

/** Lightweight summary of one (static or app-projected) template. */
function toSummary(t: EntityTemplate): TemplateSummary {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    categories: t.categories,
    entity: t.entity,
    fieldCount: t.fields.length,
    companions: t.companions,
  }
}

/** All template summaries available to the org: static gallery + app-projected. */
export async function getOrgTemplateSummaries(
  organizationId: string,
  category?: string
): Promise<TemplateSummary[]> {
  const staticSummaries = getAllTemplates(category)
  const appTemplates = await getAppTemplates(organizationId)
  let appSummaries = appTemplates.map(toSummary)
  if (category && category !== 'all') {
    appSummaries = appSummaries.filter((s) => s.categories.includes(category))
  }
  return [...staticSummaries, ...appSummaries]
}

/** Resolve a full template by id — static first, then app-projected (`app:*`). */
export async function resolveOrgTemplateById(
  organizationId: string,
  id: string
): Promise<EntityTemplate | null> {
  const fromStatic = getTemplateById(id)
  if (fromStatic) return fromStatic
  if (!id.startsWith('app:')) return null
  const appTemplates = await getAppTemplates(organizationId)
  return appTemplates.find((t) => t.id === id) ?? null
}

/**
 * Resolve many templates by id — static + app-projected. Only reads installed-app
 * catalogs when an `app:*` id is requested, so the common static-only install pays no
 * cache roundtrip. Suitable as the `resolveTemplates` injected into `installTemplates`.
 */
export async function resolveOrgTemplatesByIds(
  organizationId: string,
  ids: string[]
): Promise<EntityTemplate[]> {
  const wantsApp = ids.some((id) => id.startsWith('app:'))
  const staticById = new Map(getTemplatesByIds(ids).map((t) => [t.id, t]))
  const appById = wantsApp
    ? new Map((await getAppTemplates(organizationId)).map((t) => [t.id, t]))
    : new Map<string, EntityTemplate>()
  const out: EntityTemplate[] = []
  for (const id of ids) {
    const t = staticById.get(id) ?? appById.get(id)
    if (t) out.push(t)
  }
  return out
}
