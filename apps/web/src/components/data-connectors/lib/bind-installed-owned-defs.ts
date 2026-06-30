// apps/web/src/components/data-connectors/lib/bind-installed-owned-defs.ts
// Pure binding logic for the v6 install flow (install-target-defs-via-templates).
// After the user installs an app's owned record-type templates from the Map step
// (via the reused `EntityTemplateDialog`), the dialog's `onComplete` hands us the
// install result. This computes the draft-store mutations that bind each owned
// connector mapping to its freshly-installed `EntityDefinition`: set the mapping's
// `entityDefinitionId` and repoint each late-bound `@app:` field ref at the ACTUAL
// installed apiSlug (handling a slug-conflict suffix) — the refs stay late-bound and
// resolve to the created columns at sync. Pure + unit-tested — the Map step consumer
// applies the returned bindings through the connector draft store.

import { parseAppFieldRef, toAppFieldRef } from '@auxx/types/field'
import type { DraftMapping, DraftStream, FieldMapping } from '../stores/connector-draft-store'

/** One owned record type the connector declares — mirrors `dataConnector.ownedTargets`. */
export interface OwnedTargetMeta {
  /** Stable owner-scoped manifest key (the install templateId's last segment). */
  ownedKey: string
  /** Manifest apiSlug — the late-bound refs' first segment + slug-conflict fallback. */
  apiSlug: string
  /** The stream this owned mapping lives in (matches `DraftStream.streamKey`). */
  streamKey: string
  /** The owned mapping's rootPath within the stream (matches `DraftMapping.rootPath`). */
  rootPath: string
  /** The installable template id (`app:<slug>:<ownedKey>`). */
  templateId: string
}

/** The subset of the `EntityTemplateDialog` install result this binder reads. */
export interface InstallResultLike {
  created: Array<{ templateId: string; entityDefinitionId: string; apiSlug: string }>
}

/** A computed binding the Map step applies via `updateMapping(streamId, mappingId, …)`. */
export interface InstalledDefBinding {
  streamId: string
  mappingId: string
  entityDefinitionId: string
  fieldMappings: FieldMapping[]
}

/** Parse `@app:<slug>:<key>` → its key, scoped to the expected app slug; null otherwise. */
function appFieldKeyOf(targetFieldRef: string | null | undefined, appSlug: string): string | null {
  if (!targetFieldRef) return null
  const parts = parseAppFieldRef(targetFieldRef)
  return parts && parts.appSlug === appSlug ? parts.appFieldKey : null
}

/**
 * Repoint an owned mapping's late-bound `@app:` field refs at the ACTUAL installed def.
 * The seed used the manifest apiSlug as the ref's first segment; the install may have
 * appended a `-2` slug-conflict suffix, so each `@app:` ref's slug segment is rewritten
 * to the real installed `apiSlug` — the sink then resolves it to the created column at
 * sync via `appFieldKey` + installation (the standard app-field late-binding). Refs are
 * kept late-bound (not concretized) so a later retarget never strands a stale concrete
 * id past `assertFieldRefsMatchDef`. A field the user removed in the dialog keeps its
 * ref and harmlessly resolves to nothing at sync. Non-`@app:` refs pass through.
 */
function rebindFieldMappings(
  fieldMappings: FieldMapping[],
  ctx: { appSlug: string; apiSlug: string }
): FieldMapping[] {
  return fieldMappings.map((fm) => {
    const fieldKey = appFieldKeyOf(fm.targetFieldRef, ctx.appSlug)
    if (fieldKey == null) return fm
    return {
      ...fm,
      targetFieldRef: toAppFieldRef(ctx.apiSlug, ctx.appSlug, fieldKey),
    }
  })
}

/**
 * Compute the draft mutations that bind every owned connector mapping to its installed
 * def. For each owned target whose def the install created, finds the draft owned
 * mapping at the target's `(streamKey, rootPath)` and emits a binding: the mapping's
 * `entityDefinitionId` plus its rewritten field refs. Reference owned mappings (no
 * columns) just get their def — their refs are empty. Targets whose template wasn't
 * installed (the user deselected it) are skipped.
 */
export function bindInstalledOwnedDefs(params: {
  appSlug: string
  result: InstallResultLike
  ownedTargets: OwnedTargetMeta[]
  draftStreams: DraftStream[]
}): InstalledDefBinding[] {
  const { appSlug, result, ownedTargets, draftStreams } = params

  // Installed def by its templateId (`app:slug:ownedKey`) → { defId, actual apiSlug }.
  const createdByTemplateId = new Map(result.created.map((c) => [c.templateId, c]))
  const streamByKey = new Map(draftStreams.map((s) => [s.streamKey, s]))

  const bindings: InstalledDefBinding[] = []
  for (const target of ownedTargets) {
    const created = createdByTemplateId.get(target.templateId)
    if (!created) continue // template not installed (deselected) — leave the mapping unbound

    const stream = streamByKey.get(target.streamKey)
    if (!stream) continue
    const mapping = stream.mappings.find(
      (m: DraftMapping) => !m._deleted && m.targetMode === 'owned' && m.rootPath === target.rootPath
    )
    if (!mapping) continue

    bindings.push({
      streamId: stream.id,
      mappingId: mapping.id,
      entityDefinitionId: created.entityDefinitionId,
      fieldMappings: rebindFieldMappings(mapping.fieldMappings, {
        appSlug,
        apiSlug: created.apiSlug,
      }),
    })
  }
  return bindings
}
