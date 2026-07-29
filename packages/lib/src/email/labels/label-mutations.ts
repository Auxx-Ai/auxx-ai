// packages/lib/src/email/labels/label-mutations.ts

import { type Database, schema } from '@auxx/database'
import { LabelType } from '@auxx/database/enums'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { guard } from './guard'
import { createLabelProvider } from './label-provider-factory'
import { requireLabel } from './label-queries'
import type { CreateLabelInput, DeleteLabelInput, LabelEntity, UpdateLabelInput } from './types'

/**
 * Label CRUD plus the two single-column toggles.
 *
 * **None of these carry a permission check** — the router asserts
 * `requireChannelManageAccess(ctx, integrationId)` first and then calls. The only
 * guards here are identity ones: every write resolves the row through
 * {@link requireLabel} (org-scoped) before it touches the provider.
 *
 * ## Provider-then-DB ordering, and the orphan it can leave
 *
 * The provider is the source of truth for the external `labelId`, so the
 * provider call has to come first — we cannot insert a row until Gmail/Graph has
 * told us what to call it. The consequence is that if the **DB** write fails
 * after the provider call succeeded, the provider-side label is orphaned: it
 * exists in the mailbox with no row of ours pointing at it.
 *
 * That is current behavior and is deliberately NOT reconciled here (no
 * compensating delete, no two-phase write): `syncIntegrationLabels` repairs it on
 * the next sync by discovering the unknown provider label and creating the
 * missing row. A compensating delete would be strictly worse — it can itself
 * fail, and it would destroy a label the user can already see in their mailbox.
 */

/** Columns a label update may set. Absent keys are left untouched. */
type LabelUpdatePayload = Partial<
  Pick<
    LabelEntity,
    'name' | 'description' | 'backgroundColor' | 'textColor' | 'isVisible' | 'enabled'
  >
> & { updatedAt: Date }

/** Apply an org-scoped patch and return the fresh row. */
async function patchLabel(
  db: Database,
  organizationId: string,
  labelId: string,
  payload: LabelUpdatePayload
): Promise<LabelEntity> {
  const [row] = await db
    .update(schema.Label)
    .set(payload)
    .where(and(eq(schema.Label.id, labelId), eq(schema.Label.organizationId, organizationId)))
    .returning()

  if (!row) throw new AuxxError('Label update returned no row')
  return row
}

/**
 * Create a label in the provider, then mirror it into `Label`.
 *
 * `userId` is **not** a parameter: `Label` has no such column, and the old
 * `LabelRepo.create` accepted one only to drop it behind a
 * `// userId not stored on Label schema` comment. Threading a value that is
 * discarded invites the next reader to assume authorship is recorded.
 *
 * See the file-level note on provider-then-DB ordering.
 */
export async function createLabel(
  db: Database,
  organizationId: string,
  input: CreateLabelInput
): Promise<Result<LabelEntity, Error>> {
  return guard(
    async () => {
      const provider = await createLabelProvider(
        organizationId,
        input.integrationId,
        input.integrationType
      )

      const providerLabel = await provider.createLabel({
        name: input.name,
        color: input.backgroundColor,
        visible: true,
      })

      const [row] = await db
        .insert(schema.Label)
        .values({
          organizationId,
          integrationType: input.integrationType,
          integrationId: input.integrationId,
          labelId: providerLabel.id,
          name: providerLabel.name,
          type: LabelType.user,
          backgroundColor: input.backgroundColor,
          textColor: input.textColor,
          description: input.description,
          isVisible: true,
          updatedAt: new Date(),
        })
        .returning()

      if (!row) throw new AuxxError('Label insert returned no row')
      return row
    },
    'Error creating label',
    { integrationId: input.integrationId }
  )
}

/**
 * Rename/recolor a label in the provider, then mirror the change.
 *
 * The provider only understands name/color/visibility, so `description` is a
 * DB-only column and is applied in the same patch.
 *
 * See the file-level note on provider-then-DB ordering.
 */
export async function updateLabel(
  db: Database,
  organizationId: string,
  input: UpdateLabelInput
): Promise<Result<LabelEntity, Error>> {
  return guard(
    async () => {
      const label = await requireLabel(db, organizationId, input.labelId)

      const provider = await createLabelProvider(
        organizationId,
        input.integrationId,
        input.integrationType
      )

      await provider.updateLabel(label.labelId, {
        name: input.changes.name,
        color: input.changes.backgroundColor,
        visible: input.changes.isVisible,
      })

      const payload: LabelUpdatePayload = { updatedAt: new Date() }
      if (input.changes.name !== undefined) payload.name = input.changes.name
      if (input.changes.description !== undefined) payload.description = input.changes.description
      if (input.changes.backgroundColor !== undefined) {
        payload.backgroundColor = input.changes.backgroundColor
      }
      if (input.changes.textColor !== undefined) payload.textColor = input.changes.textColor
      if (input.changes.isVisible !== undefined) payload.isVisible = input.changes.isVisible

      return patchLabel(db, organizationId, input.labelId, payload)
    },
    'Error updating label',
    { labelId: input.labelId }
  )
}

/**
 * Delete a label from the provider, then drop our row.
 *
 * Provider-first here is the *safe* order: if the provider delete fails we still
 * have the row, so the next sync leaves everything consistent. The reverse order
 * would strand a label in the user's mailbox that we no longer know about.
 */
export async function deleteLabel(
  db: Database,
  organizationId: string,
  input: DeleteLabelInput
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      const label = await requireLabel(db, organizationId, input.labelId)

      const provider = await createLabelProvider(
        organizationId,
        input.integrationId,
        input.integrationType
      )
      await provider.deleteLabel(label.labelId)

      await db
        .delete(schema.Label)
        .where(
          and(eq(schema.Label.id, input.labelId), eq(schema.Label.organizationId, organizationId))
        )
    },
    'Error deleting label',
    { labelId: input.labelId }
  )
}

/**
 * Show/hide a label in OUR UI.
 *
 * Deliberately DB-only — no provider call. `isVisible` mirrors the provider's own
 * visibility flag when a sync brings one down, but toggling it here is a local
 * display preference and must not reach into the user's mailbox settings. (That
 * asymmetry with {@link updateLabel}, which *does* forward `isVisible`, is
 * existing behavior: an explicit edit propagates, a visibility toggle does not.)
 */
export async function setLabelVisibility(
  db: Database,
  organizationId: string,
  labelId: string,
  isVisible: boolean
): Promise<Result<LabelEntity, Error>> {
  return guard(
    async () => {
      await requireLabel(db, organizationId, labelId)
      return patchLabel(db, organizationId, labelId, { isVisible, updatedAt: new Date() })
    },
    'Error setting label visibility',
    { labelId }
  )
}

/**
 * Opt a label/folder in or out of message SYNC.
 *
 * Distinct from {@link setLabelVisibility}: `enabled` decides whether the polling
 * jobs import messages from this folder at all, so flipping it off stops ingest
 * rather than merely hiding a chip. Was an inline `db.update(Label).set(...)` in
 * the router.
 */
export async function setLabelEnabled(
  db: Database,
  organizationId: string,
  labelId: string,
  enabled: boolean
): Promise<Result<LabelEntity, Error>> {
  return guard(
    async () => {
      await requireLabel(db, organizationId, labelId)
      return patchLabel(db, organizationId, labelId, { enabled, updatedAt: new Date() })
    },
    'Error setting label enabled',
    { labelId }
  )
}
