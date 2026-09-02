// packages/lib/src/field-values/write-guard.ts

import { ForbiddenError } from '../errors'
import { canCreateField, canUpdateField } from '../resources/capabilities/field-capabilities'
import type { WriteOrigin } from '../resources/crud/write-origin'
import type { ResourceField } from '../resources/registry/field-types'
import { buildWriteKeyToFieldIdMap } from './write-key-map'

/**
 * Server-side read-only guard for app-owned and connector-owned fields
 * (`plans/apps/app-fields-and-entities-plan.md` §5, Phase 3).
 *
 * An app or a data connector can declare a field `creatable: false` /
 * `updatable: false` so the platform never overwrites the value it manages.
 * Before this guard that flag was cosmetic: {@link canUpdateField} and
 * {@link canCreateField} existed with zero call sites, so a human in the
 * record panel or a public API token could still edit a connector-owned
 * column straight through `UnifiedCrudHandler`.
 *
 * This enforces the flag for exactly the two writers it exists to stop, and
 * exempts everything else:
 *
 * | Writer | `WriteOrigin.kind` | Guarded? |
 * | --- | --- | --- |
 * | Record panel / table / drawer | `interactive` | yes |
 * | Public API / SDK token | `api` | yes |
 * | App `setFieldValues` (lambda callback route) | n/a — calls `FieldValueService.applyBulk` directly, never reaches this guard | no |
 * | Entity sink, CSV import | `sync` | no |
 * | Workflows, record rules, agents, field hooks | `automation` | no |
 * | Seeders, data migrations | `seed` | no |
 *
 * Scoped to app/connector-owned fields in v1 (`appInstallationId IS NOT NULL
 * OR dataConnectorId IS NOT NULL`) so this never breaks an interactive flow
 * that legitimately writes a platform system field with `isCreatable: false`.
 * Widening to every field is v2, after auditing the commented-out
 * `CRUD_RESOURCE_CONFIGS`.
 *
 * @param origin The write's declared origin (see `resources/crud/write-origin.ts`).
 * @param fields The entity's resolved fields, as the org cache returns them —
 *   must carry `capabilities`, `appInstallationId` and `dataConnectorId`.
 * @param writeKeys The keys of the values map the caller is about to write —
 *   each is either a `CustomField.id` or a `systemAttribute`.
 * @param op Whether this write is a `create` or an `update`; selects
 *   {@link canCreateField} vs {@link canUpdateField}.
 * @throws {ForbiddenError} Naming the first app/connector-owned field whose
 *   capability refuses this write.
 */
export function assertOriginMayWriteFields(
  origin: WriteOrigin,
  fields: readonly ResourceField[],
  writeKeys: Iterable<string>,
  op: 'create' | 'update'
): void {
  // v1 scope: only the two writers the flag protects OTHER origins from.
  if (origin.kind !== 'interactive' && origin.kind !== 'api') return

  const keyToFieldId = buildWriteKeyToFieldIdMap(fields)
  const fieldsById = new Map<string, ResourceField>(fields.map((f) => [f.id, f]))

  for (const key of writeKeys) {
    const fieldId = keyToFieldId.get(key) ?? key
    const field = fieldsById.get(fieldId)
    if (!field) continue
    // Only app-owned and connector-owned fields are guarded in v1 — a plain
    // user field or a platform system field with `isCreatable: false` is
    // untouched, even for an interactive/api write.
    if (!field.appInstallationId && !field.dataConnectorId) continue

    const allowed = op === 'create' ? canCreateField(field) : canUpdateField(field)
    if (allowed) continue

    const owner = field.dataConnectorId ? 'a connected data source' : 'an installed app'
    const verb = op === 'create' ? 'set on create' : 'updated'
    throw new ForbiddenError(
      `Field "${field.label}" is managed by ${owner} and cannot be ${verb} directly.`
    )
  }
}
