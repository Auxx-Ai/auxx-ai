// packages/lib/src/data-connectors/templates/connector-template-registry.ts
// First-party connector-template registry (05c §4). Imports the JSON defs,
// indexes them by id, and validates at import time — mirroring
// `entity-templates/template-registry.ts`. Templates are open presets: each
// seeds a normal, fully-editable `generic-rest` connector.

import githubTemplate from './defs/github.json'
import stripeTemplate from './defs/stripe.json'
import type { ConnectorTemplate, ConnectorTemplateSummary } from './types'

const allTemplates: ConnectorTemplate[] = [stripeTemplate, githubTemplate] as ConnectorTemplate[]

/** All templates indexed by id. */
const templateMap = new Map<string, ConnectorTemplate>()

// Index + validate at import time (fail fast on a malformed def).
for (const template of allTemplates) {
  if (templateMap.has(template.id)) {
    throw new Error(`Duplicate connector template id: ${template.id}`)
  }
  if (!template.config.endpoint?.baseUrl) {
    throw new Error(`Connector template "${template.id}": config.endpoint.baseUrl is required`)
  }
  if (template.streams.length === 0) {
    throw new Error(`Connector template "${template.id}": must declare at least one stream`)
  }
  const streamKeys = new Set<string>()
  for (const stream of template.streams) {
    if (!stream.streamKey) {
      throw new Error(`Connector template "${template.id}": every stream needs a streamKey`)
    }
    if (streamKeys.has(stream.streamKey)) {
      throw new Error(
        `Connector template "${template.id}": duplicate stream key "${stream.streamKey}"`
      )
    }
    streamKeys.add(stream.streamKey)
    if (!stream.requestConfig?.path) {
      throw new Error(
        `Connector template "${template.id}": stream "${stream.streamKey}" needs requestConfig.path`
      )
    }
    // Layer B (05d) — validate declared mappings if present.
    for (const mapping of stream.mappings ?? []) {
      if (!mapping.target) {
        throw new Error(
          `Connector template "${template.id}": stream "${stream.streamKey}" mapping needs a target`
        )
      }
      if (mapping.target.mode !== 'contributing') {
        throw new Error(
          `Connector template "${template.id}": stream "${stream.streamKey}" — only 'contributing' targets are supported (got '${mapping.target.mode}')`
        )
      }
      if (!mapping.target.entityRef?.startsWith('@system:')) {
        throw new Error(
          `Connector template "${template.id}": stream "${stream.streamKey}" — entityRef must be '@system:<entityType>' (got '${mapping.target.entityRef}')`
        )
      }
      for (const field of mapping.fields) {
        const hasSource = field.source != null
        const hasExpression = field.expression != null
        if (hasSource === hasExpression) {
          throw new Error(
            `Connector template "${template.id}": stream "${stream.streamKey}" field "${field.key}" needs exactly one of source / expression`
          )
        }
      }
    }
  }
  templateMap.set(template.id, template)
}

/** Lightweight summaries for the connect-dialog catalog. `category` filters. */
export function getAllConnectorTemplates(category?: string): ConnectorTemplateSummary[] {
  const templates =
    category && category !== 'all'
      ? allTemplates.filter((t) => t.categories.includes(category))
      : allTemplates
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    categories: t.categories,
    iconKey: t.iconKey,
    requiresConnection: t.requiresConnection,
  }))
}

/** Full template by id (for the installer). */
export function getConnectorTemplateById(id: string): ConnectorTemplate | null {
  return templateMap.get(id) ?? null
}
