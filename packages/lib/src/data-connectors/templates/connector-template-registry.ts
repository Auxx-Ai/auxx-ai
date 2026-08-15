// packages/lib/src/data-connectors/templates/connector-template-registry.ts
// First-party connector-template registry (05c §4). Imports the JSON defs,
// indexes them by id, and validates at import time — mirroring
// `entity-templates/template-registry.ts`. Templates are open presets: each
// seeds a normal, fully-editable `generic-rest` connector.
//
// ── `defs/quo.json` design notes ─────────────────────────────────────────────
// Quo (formerly OpenPhone) contacts. JSON carries no comments, so the decisions
// behind that template live here:
//
// • CREDENTIAL SHARING — `connection.providerKey: 'openphone'` binds to the SAME
//   seeded ConnectionDefinition the SMS channel uses (the key stays `openphone`;
//   the rename to Quo is labels-only). Connecting Quo once serves both consumers.
//   `authScheme: 'bearer'` works as-is — verified live that Quo accepts
//   `Authorization: Bearer <key>`, so this depends on no channel-side change.
//
// • TWO WRITERS INTO `@system:contact` — the channel's own ingest also creates
//   contacts from inbound SMS, so identity matching carries all the weight here.
//   `match: {normalize:'phone'}` on the phone binding must agree with the ingest
//   side's `Participant.identifier` E.164 form, or the same person lands twice.
//   The in-flight `dedup/` + duplicate-suggestion work is exactly this problem —
//   the two writers should be tested TOGETHER, not in isolation.
//
// • FIRST VALUE ONLY — Quo exposes no scalar email/phone; both are arrays of
//   labelled entries, addressed with `defaultFields.emails[0].value` (the indexed
//   `getByPath` syntax in `map-record.ts`). Contact phone went multi-value E.164
//   in #1629 but the connector write path is scalar, so a Quo contact with three
//   numbers lands ONE. Accepted for v1; the rest are not silently dropped so much
//   as not yet reachable — landing them needs a multi-value source path.
//
// • NO INCREMENTAL / NO BACKFILL WINDOW — verified live that `/v1/contacts`
//   silently IGNORES `updatedAfter` / `createdAfter` / `since` (unknown params are
//   ignored, not rejected). There is no delta filter to declare, so every run is a
//   full snapshot crawl. Do not invent a `sinceParam`: it would be a lie in config
//   that changes nothing on the wire.
//
// • PAGING TERMINATES ON `nextPageToken` ALONE — deliberately no `hasMorePath`.
//   `totalItems` is PER-PAGE, not a grand total (`?maxResults=2` returns
//   `totalItems: 2` *with* a next token). `maxResults` hard-caps at 50 (400 above
//   it), so this is ~2x the requests of a Stripe-sized address book.
//
// • NULL SOURCES OVERWRITE — a template binding has no `mergeStrategy` knob, so
//   contributing writes land on the sink's `overwrite` default. Multi-value fields
//   (`primary_email`, `phone`) are protected — the sink never writes blank over a
//   multi field — but a SCALAR target is cleared when Quo's value is null. That is
//   why `defaultFields.role` → `job_title` is NOT mapped: 24 of 25 live contacts
//   have `role: null`, so mapping it would blank a human-entered job title on every
//   run. `Quo Company` is safe by contrast: it is the connector's OWN provisioned
//   field, so mirroring null is correct rather than destructive. The same hazard
//   applies on a smaller surface to the name bindings — a Quo contact with neither
//   name blanks both — which is the price of mapping them at all; revisit if
//   templates ever gain `mergeStrategy: 'fill_blank'`.
//
// • NAMES BIND TO `first_name` / `last_name`, NOT `full_name`. Both are creatable/
//   updatable system attributes on contact (`resources/registry/resources/
//   contact-fields.ts`), hidden from the panel in favour of the computed name
//   field, which they drive. Quo hands us the two halves already split, so binding
//   them directly is lossless — composing `full_name` and letting the sink split it
//   back on whitespace would turn "Mary Jo Van Dyke" into first "Mary" /
//   last "Jo Van Dyke".
//
// • `customFields[]` is deliberately unmapped — a typed union needing its own pass.
// ─────────────────────────────────────────────────────────────────────────────

import githubTemplate from './defs/github.json'
import quoTemplate from './defs/quo.json'
import stripeTemplate from './defs/stripe.json'
import type { ConnectorTemplate, ConnectorTemplateSummary } from './types'

const allTemplates: ConnectorTemplate[] = [
  stripeTemplate,
  githubTemplate,
  quoTemplate,
] as ConnectorTemplate[]

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
