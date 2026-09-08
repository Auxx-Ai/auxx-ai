// packages/lib/src/dashboards/draft-edit/normalize/source-refs.ts

/**
 * Widget-source normalization. SERVER-ONLY (reads the org cache; never export
 * through a client barrel).
 *
 * A `WidgetSource` is `{ kind: 'entity', entityDefinitionId }` or
 * `{ kind: 'system', tableId }`, and the entity id is a PER-ORG cuid. A model
 * has never seen one and cannot know one, so asked for "a chart of tickets" it
 * invents `"ticket"`, `"tickets"` or `"Ticket"` and writes a widget whose
 * source resolves to nothing. The widget then renders the "configure this
 * widget" shell while the agent reports success, because an unconfigured
 * widget is a legitimate draft state and nothing downstream contradicts it.
 *
 * So this is the same CORRECTNESS argument `workflows/graph-edit/normalize/
 * resource-refs.ts` makes, not an ergonomic one: normalize friendly input into
 * the canonical id rather than validating that the caller already had it.
 *
 * The canonical value is the RESOURCE ID (`Resource.id`), not
 * `Resource.entityDefinitionId`, because that is what the rest of the widget
 * pipeline keys on: `getCachedResourceFields` matches `r.id`, the source picker
 * writes `resourceIdToSource(resource.id)`, and `layoutDocRefine` compares a
 * field ref's root against `source.entityDefinitionId` verbatim. Writing the
 * def cuid for a system-backed resource such as `contact` would make every one
 * of those disagree at once.
 *
 * `thread` and `message` are REFUSED rather than offered: see
 * {@link refuseMailSource}.
 */

import { err, ok, type Result } from 'neverthrow'
import { getCachedResources } from '../../../cache'
import { type AuxxError, BadRequestError, ForbiddenError, NotFoundError } from '../../../errors'
import { isSystemAggregateTable } from '../../../resources/aggregate'
import { isMailLensTableId } from '../../../resources/picker/mail-lens-tables'
import type { Resource } from '../../../resources/registry/types'
import type { SystemTableId, WidgetSource } from '../../client'
import { closestMatches } from '../refs'

/** The alias strings a resource answers to, for matching and for error candidates. */
function resourceAliases(resource: Resource): string[] {
  return [resource.entityType, resource.apiSlug, resource.label, resource.plural].filter(
    (alias): alias is string => typeof alias === 'string' && alias !== ''
  )
}

/**
 * Every string that identifies this resource, including its raw id. Used to
 * decide whether a friendly ref reached a mail table by a name other than
 * `thread` / `message`.
 */
function identifiesMailTable(resource: Resource): boolean {
  return [resource.id, resource.entityType, resource.apiSlug].some(
    (key) => typeof key === 'string' && isMailLensTableId(key)
  )
}

/**
 * The refusal for `thread` / `message`, worded for a model so it tells the user
 * instead of retrying with a synonym.
 *
 * `prepareAggregate` throws `ForbiddenError` for both, and the reason is
 * structural rather than a permission the caller might be granted: the system
 * aggregate builder emits `WHERE organizationId = $1` and nothing else. No
 * `buildMailVisibilityPredicate`, no merged-thread filter. So a chart over
 * `thread` counts the WHOLE org's mailbox for anyone who can open the
 * dashboard, and a high-cardinality group-by is worse than a count, because the
 * group LABELS are the raw column values: grouping by `subject` prints subject
 * lines onto the dashboard.
 *
 * Adding the row predicate would not fix it either. The predicate admits a row
 * at the `metadata` tier while reading its subject needs `identity`, and it is
 * per-VIEWER while the aggregate result cache is keyed without a user. See
 * `SYSTEM_AGGREGATE_TABLE_IDS` for the full record.
 */
function refuseMailSource(input: string): AuxxError {
  return new ForbiddenError(
    `"${input}" is a mail source, and dashboards cannot chart mail. The aggregate builder ` +
      'scopes only by organization, so a widget over threads or messages would count the ' +
      "entire organization's mailbox for anyone who can open the dashboard, and grouping by " +
      'a text column would print subject lines as its labels. There is no filter that fixes ' +
      'this: mail visibility is per-viewer and per-tier, while an aggregate result is shared. ' +
      'Tell the user that mail cannot be a dashboard source, and use the mail search tools ' +
      'for anything that needs thread content.',
    { reason: 'mail-lens-source' }
  )
}

/**
 * Resolve a friendly source reference to the `WidgetSource` a widget must
 * persist. Accepts an entity definition's `apiSlug`, `entityType`, `label`,
 * `plural` or its raw id, and the system aggregate table ids.
 *
 * Unresolvable input is a {@link NotFoundError} carrying `closestMatches`, in
 * the message and in `details`, so the caller can retry without a second read.
 * Ambiguity is a {@link BadRequestError} listing the candidates. `thread` and
 * `message` are refused with {@link refuseMailSource}.
 */
export async function resolveWidgetSource(
  orgId: string,
  input: string
): Promise<Result<WidgetSource, AuxxError>> {
  const trimmed = input.trim()
  if (!trimmed) return err(new BadRequestError('Widget source is empty.'))

  // Checked on the RAW input before any cache read, exactly as `prepareAggregate`
  // does: `thread` must not become a probe for what the org holds either.
  if (isMailLensTableId(trimmed)) return err(refuseMailSource(trimmed))

  const resources = await getCachedResources(orgId)

  const byId = resources.find((r) => r.id === trimmed)
  const needle = trimmed.toLowerCase()
  const strong = resources.filter(
    (r) => r.entityType?.toLowerCase() === needle || r.apiSlug.toLowerCase() === needle
  )
  const matches =
    byId !== undefined
      ? [byId]
      : strong.length > 0
        ? strong
        : resources.filter(
            (r) => r.label.toLowerCase() === needle || r.plural.toLowerCase() === needle
          )

  if (matches.length > 1) {
    return err(
      new BadRequestError(
        `Source "${trimmed}" is ambiguous: it matches ` +
          `${matches.map((r) => `"${r.label}" (${r.apiSlug})`).join(', ')}. Use the apiSlug.`,
        { candidates: matches.map((r) => r.apiSlug) }
      )
    )
  }

  const resource = matches[0]
  if (resource) {
    // A mail table reached under one of its other names (label, plural, the raw
    // registry id). The gate is the resolved resource, never the spelling.
    if (identifiesMailTable(resource)) return err(refuseMailSource(trimmed))
    return ok(toWidgetSource(resource.id))
  }

  // A raw system aggregate table id the resources cache does not carry as a row.
  if (isSystemAggregateTable(trimmed)) return ok(toWidgetSource(trimmed))

  return err(unknownSourceError(trimmed, resources))
}

/**
 * Tag a resolved resource id as an entity or a system source. Mirrors the
 * source picker's `resourceIdToSource`: only the curated aggregate tables are
 * `system`, everything else (system-backed defs such as `contact` included)
 * goes down the `EntityInstance` path.
 */
function toWidgetSource(resourceId: string): WidgetSource {
  return isSystemAggregateTable(resourceId)
    ? { kind: 'system', tableId: resourceId as SystemTableId }
    : { kind: 'entity', entityDefinitionId: resourceId }
}

function unknownSourceError(input: string, resources: Resource[]): AuxxError {
  const near = closestMatches(input, resources.flatMap(resourceAliases))
  const available = resources
    .filter((r) => r.isVisible)
    .map((r) => r.apiSlug)
    .slice(0, 15)
  const hint =
    near.length > 0
      ? ` Did you mean ${near.map((a) => `"${a}"`).join(' or ')}?`
      : available.length > 0
        ? ` Available sources: ${available.join(', ')}.`
        : ''
  return new NotFoundError(`Unknown dashboard source "${input}".${hint}`, {
    closestMatches: near,
  })
}

/**
 * Render a `WidgetSource` back as the name a model should see, so nothing that
 * leaves this module carries a raw per-org cuid. Pass the org's resources to
 * get a real label; without them the id passes through unchanged, which is
 * still honest rather than wrong.
 */
export function describeSource(source: WidgetSource, resources?: Resource[]): string {
  const id = source.kind === 'system' ? source.tableId : source.entityDefinitionId
  const resource = resources?.find((r) => r.id === id)
  return resource ? resource.label : id
}

/** {@link describeSource} with the org cache read done for you. */
export async function describeSourceForOrg(orgId: string, source: WidgetSource): Promise<string> {
  return describeSource(source, await getCachedResources(orgId))
}
