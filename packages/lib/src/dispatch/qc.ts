// packages/lib/src/dispatch/qc.ts
//
// The quality-checklist feature (08-worker-surface.md §5) — an admin-managed template catalog
// lazily materialized once per visit into worker-editable snapshot rows.
// `title`/`isRequired` on `VisitQcItem` are SNAPSHOT columns: once copied from a template they
// never change, even if the source template is edited or deactivated afterward — only visits
// materialized after the edit see the new values. Every worker-scoped fn below guards through
// `loadOwnVisit` (my-schedule.ts) — a worker only ever touches checklist rows on their own visit.
// No realtime v1 (a worker edits only their own visit, so broadcasts are skipped).

import { database, schema } from '@auxx/database'
import { and, asc, eq, inArray, max } from 'drizzle-orm'
import { ForbiddenError, NotFoundError } from '../errors'
import { createAttachment, deleteAttachment, updateAttachment } from '../files/attachments'
import type { FilesCtx } from '../files/ctx'
import { loadOwnVisit } from './my-schedule'

type QcItemTemplateRow = typeof schema.QcItemTemplate.$inferSelect
type VisitQcItemRow = typeof schema.VisitQcItem.$inferSelect

// ════════════════════════════════════════════════════════════════════════════
// Templates (admin; org-scoped — no assignee guard) — 08 §5's settings page.
// ════════════════════════════════════════════════════════════════════════════

/** List every template in the org (active + inactive), ordered for the settings page's list. */
export async function listQcItemTemplates(organizationId: string): Promise<QcItemTemplateRow[]> {
  return database
    .select()
    .from(schema.QcItemTemplate)
    .where(eq(schema.QcItemTemplate.organizationId, organizationId))
    .orderBy(asc(schema.QcItemTemplate.sortOrder), asc(schema.QcItemTemplate.createdAt))
}

/** Input for {@link createQcItemTemplate}. */
export interface CreateQcItemTemplateInput {
  title: string
  description?: string | null
  isRequired?: boolean
}

/** Create a new template at the end of the org's list (`sortOrder` = current max + 1). */
export async function createQcItemTemplate(
  organizationId: string,
  input: CreateQcItemTemplateInput
): Promise<QcItemTemplateRow> {
  const [maxRow] = await database
    .select({ maxSortOrder: max(schema.QcItemTemplate.sortOrder) })
    .from(schema.QcItemTemplate)
    .where(eq(schema.QcItemTemplate.organizationId, organizationId))
  const maxSortOrder = maxRow?.maxSortOrder ?? null

  const [created] = await database
    .insert(schema.QcItemTemplate)
    .values({
      organizationId,
      title: input.title,
      description: input.description ?? null,
      isRequired: input.isRequired ?? false,
      sortOrder: (maxSortOrder ?? -1) + 1,
    })
    .returning()
  if (!created) throw new Error('Failed to create quality check template')
  return created
}

/** Input for {@link updateQcItemTemplate}. */
export interface UpdateQcItemTemplateInput {
  templateId: string
  title?: string
  description?: string | null
  isRequired?: boolean
  isActive?: boolean
}

/**
 * Update a template's fields — includes deactivate/reactivate via `isActive`. Never rewrites
 * already-materialized `VisitQcItem` snapshots.
 *
 * @throws {NotFoundError} when the template doesn't exist in this org.
 */
export async function updateQcItemTemplate(
  organizationId: string,
  input: UpdateQcItemTemplateInput
): Promise<QcItemTemplateRow> {
  const { templateId, ...changes } = input
  const [updated] = await database
    .update(schema.QcItemTemplate)
    .set(changes)
    .where(
      and(
        eq(schema.QcItemTemplate.id, templateId),
        eq(schema.QcItemTemplate.organizationId, organizationId)
      )
    )
    .returning()
  if (!updated) throw new NotFoundError('Quality check template not found')
  return updated
}

/**
 * Hard-delete a template from the catalog. Already-materialized `VisitQcItem` snapshots survive
 * — their `templateId` FK is `onDelete: 'set null'`, turning them into template-less rows (the
 * same shape as a worker's ad-hoc items), and `title`/`isRequired` were copied at
 * materialization time anyway.
 *
 * @throws {NotFoundError} when the template doesn't exist in this org.
 */
export async function deleteQcItemTemplate(
  organizationId: string,
  templateId: string
): Promise<void> {
  const [deleted] = await database
    .delete(schema.QcItemTemplate)
    .where(
      and(
        eq(schema.QcItemTemplate.id, templateId),
        eq(schema.QcItemTemplate.organizationId, organizationId)
      )
    )
    .returning({ id: schema.QcItemTemplate.id })
  if (!deleted) throw new NotFoundError('Quality check template not found')
}

/** One row's new position for {@link reorderQcItemTemplates}. */
export interface ReorderQcItemTemplateUpdate {
  id: string
  sortOrder: number
}

/**
 * Persist a drag-reordered template list in one batch (favorites-service.ts's ownership-check-
 * then-transaction recipe, integer `sortOrder` instead of favorites' fractional text index).
 *
 * @throws {ForbiddenError} when any id doesn't belong to this org.
 */
export async function reorderQcItemTemplates(
  organizationId: string,
  updates: ReorderQcItemTemplateUpdate[]
): Promise<void> {
  if (updates.length === 0) return

  const ids = updates.map((update) => update.id)
  const owned = await database
    .select({ id: schema.QcItemTemplate.id })
    .from(schema.QcItemTemplate)
    .where(
      and(
        inArray(schema.QcItemTemplate.id, ids),
        eq(schema.QcItemTemplate.organizationId, organizationId)
      )
    )
  if (owned.length !== ids.length) {
    throw new ForbiddenError('Some quality check templates do not belong to this organization')
  }

  await database.transaction(async (tx) => {
    for (const update of updates) {
      await tx
        .update(schema.QcItemTemplate)
        .set({ sortOrder: update.sortOrder })
        .where(eq(schema.QcItemTemplate.id, update.id))
    }
  })
}

// ════════════════════════════════════════════════════════════════════════════
// Worker items (assignee-guarded) — the visit-detail Notes tab's checklist.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Load a `VisitQcItem` scoped to the org — no assignee guard. Backs the office (dispatcher)
 * photo mutations, which are org-scoped: any dispatch member may document a visit's checklist,
 * not only its assigned worker (37d decision 3). `loadOwnQcItem` layers the assignee guard on top.
 *
 * @throws {NotFoundError} when the item doesn't exist in this org.
 */
async function loadQcItemInOrg(organizationId: string, itemId: string): Promise<VisitQcItemRow> {
  const item = await database.query.VisitQcItem.findFirst({
    where: and(
      eq(schema.VisitQcItem.id, itemId),
      eq(schema.VisitQcItem.organizationId, organizationId)
    ),
  })
  if (!item) throw new NotFoundError('Quality check item not found')
  return item
}

/**
 * Load a `VisitQcItem` scoped to the org, then guard its parent visit via `loadOwnVisit` — every
 * item-id worker fn below uses this so a worker can only touch checklist rows on their own visit.
 *
 * @throws {NotFoundError} when the item doesn't exist in this org.
 * @throws {ForbiddenError} when the item's visit isn't assigned to `userId`.
 */
async function loadOwnQcItem(
  organizationId: string,
  userId: string,
  itemId: string
): Promise<VisitQcItemRow> {
  const item = await loadQcItemInOrg(organizationId, itemId)
  await loadOwnVisit(organizationId, userId, item.visitId)
  return item
}

/** One photo attached to a `VisitQcItem`, projected for the worker + office UI. */
export interface MyVisitQcItemPhoto {
  attachmentId: string
  assetId: string | null
  /** Optional free-text caption (37d §2), stored on `Attachment.caption`. */
  caption: string | null
}

/** One row of `listMyVisitQcItems`'s materialized checklist. */
export interface MyVisitQcItem {
  id: string
  templateId: string | null
  title: string
  isRequired: boolean
  note: string | null
  checkedAt: Date | null
  /** Who checked the item (null when unchecked) — surfaced on the visit report (37d §5). */
  checkedByUserId: string | null
  sortOrder: number
  photos: MyVisitQcItemPhoto[]
}

/** `listMyVisitQcItems` result — the Notes tab's full checklist payload. */
export interface ListMyVisitQcItemsResult {
  items: MyVisitQcItem[]
}

/** Look up every photo attached to the given `VisitQcItem` ids, grouped by item id. */
async function getPhotosByItemId(
  organizationId: string,
  itemIds: string[]
): Promise<Map<string, MyVisitQcItemPhoto[]>> {
  const result = new Map<string, MyVisitQcItemPhoto[]>()
  if (itemIds.length === 0) return result

  const rows = await database
    .select({
      attachmentId: schema.Attachment.id,
      entityId: schema.Attachment.entityId,
      assetId: schema.Attachment.assetId,
      caption: schema.Attachment.caption,
    })
    .from(schema.Attachment)
    .where(
      and(
        eq(schema.Attachment.organizationId, organizationId),
        eq(schema.Attachment.entityType, 'visit_qc_item'),
        inArray(schema.Attachment.entityId, itemIds)
      )
    )
    .orderBy(asc(schema.Attachment.sort), asc(schema.Attachment.createdAt))

  for (const row of rows) {
    const photos = result.get(row.entityId) ?? []
    photos.push({ attachmentId: row.attachmentId, assetId: row.assetId, caption: row.caption })
    result.set(row.entityId, photos)
  }
  return result
}

/** Read + photo-hydrate a visit's existing checklist rows — no guards, no materialization. */
async function readVisitQcItems(
  organizationId: string,
  visitId: string
): Promise<ListMyVisitQcItemsResult> {
  const items = await database
    .select()
    .from(schema.VisitQcItem)
    .where(
      and(
        eq(schema.VisitQcItem.visitId, visitId),
        eq(schema.VisitQcItem.organizationId, organizationId)
      )
    )
    .orderBy(asc(schema.VisitQcItem.sortOrder), asc(schema.VisitQcItem.createdAt))

  const photosByItemId = await getPhotosByItemId(
    organizationId,
    items.map((item) => item.id)
  )

  return {
    items: items.map((item) => ({
      id: item.id,
      templateId: item.templateId,
      title: item.title,
      isRequired: item.isRequired,
      note: item.note,
      checkedAt: item.checkedAt,
      checkedByUserId: item.checkedByUserId,
      sortOrder: item.sortOrder,
      photos: photosByItemId.get(item.id) ?? [],
    })),
  }
}

/**
 * List the signed-in worker's checklist for one visit, materializing it on first read (08 §5):
 * if the visit has zero `VisitQcItem` rows yet, copy the org's ACTIVE templates (ordered
 * `sortOrder`) into snapshot rows inside a transaction. A second call is a no-op — it just reads
 * back the (possibly empty, if the org has no active templates) existing rows.
 */
export async function listMyVisitQcItems(
  organizationId: string,
  userId: string,
  visitId: string
): Promise<ListMyVisitQcItemsResult> {
  await loadOwnVisit(organizationId, userId, visitId)

  await database.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.VisitQcItem.id })
      .from(schema.VisitQcItem)
      .where(eq(schema.VisitQcItem.visitId, visitId))
      .limit(1)
    if (existing.length > 0) return

    const templates = await tx
      .select()
      .from(schema.QcItemTemplate)
      .where(
        and(
          eq(schema.QcItemTemplate.organizationId, organizationId),
          eq(schema.QcItemTemplate.isActive, true)
        )
      )
      .orderBy(asc(schema.QcItemTemplate.sortOrder), asc(schema.QcItemTemplate.createdAt))
    if (templates.length === 0) return

    await tx.insert(schema.VisitQcItem).values(
      templates.map((template, index) => ({
        organizationId,
        visitId,
        templateId: template.id,
        title: template.title,
        isRequired: template.isRequired,
        sortOrder: index,
      }))
    )
  })

  return readVisitQcItems(organizationId, visitId)
}

/**
 * Dispatcher/admin read of a visit's checklist — org-scoped, NO assignee guard and NO
 * materialization (viewing must never author checklist rows; that stays a worker-first action
 * in `listMyVisitQcItems`). An untouched visit reads back an honest empty list, not a
 * freshly-created shell. Same `MyVisitQcItem[]` shape as the worker read.
 */
export async function listVisitQcItems(
  organizationId: string,
  visitId: string
): Promise<ListMyVisitQcItemsResult> {
  return readVisitQcItems(organizationId, visitId)
}

/** Input for {@link setMyQcItemChecked}. */
export interface SetMyQcItemCheckedInput {
  itemId: string
  checked: boolean
}

/** Check/uncheck one item — stamps (or clears) `checkedAt`/`checkedByUserId`. */
export async function setMyQcItemChecked(
  organizationId: string,
  userId: string,
  input: SetMyQcItemCheckedInput
): Promise<VisitQcItemRow> {
  await loadOwnQcItem(organizationId, userId, input.itemId)

  const [updated] = await database
    .update(schema.VisitQcItem)
    .set({
      checkedAt: input.checked ? new Date() : null,
      checkedByUserId: input.checked ? userId : null,
    })
    .where(eq(schema.VisitQcItem.id, input.itemId))
    .returning()
  if (!updated) throw new NotFoundError('Quality check item not found')
  return updated
}

/** Input for {@link setMyQcItemNote}. */
export interface SetMyQcItemNoteInput {
  itemId: string
  note: string | null
}

/** Set (or clear, `note: null`) one item's free-text note. */
export async function setMyQcItemNote(
  organizationId: string,
  userId: string,
  input: SetMyQcItemNoteInput
): Promise<VisitQcItemRow> {
  await loadOwnQcItem(organizationId, userId, input.itemId)

  const [updated] = await database
    .update(schema.VisitQcItem)
    .set({ note: input.note })
    .where(eq(schema.VisitQcItem.id, input.itemId))
    .returning()
  if (!updated) throw new NotFoundError('Quality check item not found')
  return updated
}

/** Input for {@link addMyAdhocQcItem}. */
export interface AddMyAdhocQcItemInput {
  visitId: string
  title: string
}

/** Add a worker-authored row with no source template, appended to the end of the visit's list. */
export async function addMyAdhocQcItem(
  organizationId: string,
  userId: string,
  input: AddMyAdhocQcItemInput
): Promise<VisitQcItemRow> {
  await loadOwnVisit(organizationId, userId, input.visitId)

  const [maxRow] = await database
    .select({ maxSortOrder: max(schema.VisitQcItem.sortOrder) })
    .from(schema.VisitQcItem)
    .where(eq(schema.VisitQcItem.visitId, input.visitId))
  const maxSortOrder = maxRow?.maxSortOrder ?? null

  const [created] = await database
    .insert(schema.VisitQcItem)
    .values({
      organizationId,
      visitId: input.visitId,
      templateId: null,
      title: input.title,
      isRequired: false,
      sortOrder: (maxSortOrder ?? -1) + 1,
    })
    .returning()
  if (!created) throw new Error('Failed to create quality check item')
  return created
}

// ─── Shared photo bodies (guard already applied by the public fns) ──────────────
// The worker (`*My*`) and office (`*Visit*`) fns differ ONLY in their item-load guard
// (`loadOwnQcItem` vs `loadQcItemInOrg`, 37d §2); everything past the guard is identical, so
// it lives here once and takes a pre-resolved `itemId`.

/** The `files/` scope every photo mutation below runs in. */
function filesCtx(organizationId: string): FilesCtx {
  return { db: database, organizationId }
}

/** Attach an already-uploaded `MediaAsset` (see `useFileUpload`) to a checklist item. */
async function attachQcItemPhoto(
  organizationId: string,
  userId: string,
  itemId: string,
  assetId: string
): Promise<MyVisitQcItemPhoto> {
  const created = await createAttachment(filesCtx(organizationId), {
    entityType: 'visit_qc_item',
    entityId: itemId,
    assetId,
    createdById: userId,
  })
  if (created.isErr()) throw created.error
  const attachment = created.value
  return { attachmentId: attachment.id, assetId: attachment.assetId, caption: attachment.caption }
}

/** Resolve an attachment and assert it belongs to the given checklist item, or throw. */
async function loadQcItemPhoto(
  organizationId: string,
  itemId: string,
  attachmentId: string
): Promise<void> {
  const attachment = await database.query.Attachment.findFirst({
    where: and(
      eq(schema.Attachment.id, attachmentId),
      eq(schema.Attachment.organizationId, organizationId)
    ),
  })
  if (!attachment || attachment.entityType !== 'visit_qc_item' || attachment.entityId !== itemId) {
    throw new NotFoundError('Photo not found on this quality check item')
  }
}

/** Detach a photo from a checklist item. */
async function detachQcItemPhoto(
  organizationId: string,
  _userId: string,
  itemId: string,
  attachmentId: string
): Promise<void> {
  await loadQcItemPhoto(organizationId, itemId, attachmentId)
  const deleted = await deleteAttachment(filesCtx(organizationId), attachmentId)
  if (deleted.isErr()) throw deleted.error
}

/** Set (or clear, `caption: null`) a photo's caption. */
async function updateQcItemPhotoCaption(
  organizationId: string,
  _userId: string,
  itemId: string,
  attachmentId: string,
  caption: string | null
): Promise<void> {
  await loadQcItemPhoto(organizationId, itemId, attachmentId)
  const updated = await updateAttachment(filesCtx(organizationId), attachmentId, { caption })
  if (updated.isErr()) throw updated.error
}

// ─── Worker (assignee-guarded) photo mutations ──────────────────────────────────

/** Input for {@link addMyQcItemPhoto}. */
export interface AddMyQcItemPhotoInput {
  itemId: string
  assetId: string
}

/** Attach an already-uploaded `MediaAsset` (see `useFileUpload`) to the worker's own checklist item. */
export async function addMyQcItemPhoto(
  organizationId: string,
  userId: string,
  input: AddMyQcItemPhotoInput
): Promise<MyVisitQcItemPhoto> {
  await loadOwnQcItem(organizationId, userId, input.itemId)
  return attachQcItemPhoto(organizationId, userId, input.itemId, input.assetId)
}

/** Input for {@link removeMyQcItemPhoto}. */
export interface RemoveMyQcItemPhotoInput {
  itemId: string
  attachmentId: string
}

/**
 * Detach a photo from the worker's own checklist item.
 *
 * @throws {NotFoundError} when the attachment doesn't exist, or belongs to a different item/org.
 */
export async function removeMyQcItemPhoto(
  organizationId: string,
  userId: string,
  input: RemoveMyQcItemPhotoInput
): Promise<void> {
  await loadOwnQcItem(organizationId, userId, input.itemId)
  await detachQcItemPhoto(organizationId, userId, input.itemId, input.attachmentId)
}

/** Input for {@link setMyQcItemPhotoCaption} / {@link setVisitQcItemPhotoCaption}. */
export interface SetQcItemPhotoCaptionInput {
  itemId: string
  attachmentId: string
  /** `null` clears the caption. */
  caption: string | null
}

/** Set/clear the caption on a photo of the worker's own checklist item (37d §2). */
export async function setMyQcItemPhotoCaption(
  organizationId: string,
  userId: string,
  input: SetQcItemPhotoCaptionInput
): Promise<void> {
  await loadOwnQcItem(organizationId, userId, input.itemId)
  await updateQcItemPhotoCaption(
    organizationId,
    userId,
    input.itemId,
    input.attachmentId,
    input.caption
  )
}

// ─── Office (org-scoped, no assignee guard) photo mutations — 37d §2 ─────────────
// Any dispatch member may add/caption/remove a visit's QC photos from the proof-of-work panel,
// not just the assigned worker. Checks and per-item notes stay worker attestations (untouched).

/** Input for {@link addVisitQcItemPhoto}. */
export interface AddVisitQcItemPhotoInput {
  itemId: string
  assetId: string
}

/** Office: attach an already-uploaded `MediaAsset` to any org checklist item. */
export async function addVisitQcItemPhoto(
  organizationId: string,
  userId: string,
  input: AddVisitQcItemPhotoInput
): Promise<MyVisitQcItemPhoto> {
  await loadQcItemInOrg(organizationId, input.itemId)
  return attachQcItemPhoto(organizationId, userId, input.itemId, input.assetId)
}

/** Input for {@link removeVisitQcItemPhoto}. */
export interface RemoveVisitQcItemPhotoInput {
  itemId: string
  attachmentId: string
}

/** Office: detach a photo from any org checklist item. */
export async function removeVisitQcItemPhoto(
  organizationId: string,
  userId: string,
  input: RemoveVisitQcItemPhotoInput
): Promise<void> {
  await loadQcItemInOrg(organizationId, input.itemId)
  await detachQcItemPhoto(organizationId, userId, input.itemId, input.attachmentId)
}

/** Office: set/clear the caption on a photo of any org checklist item. */
export async function setVisitQcItemPhotoCaption(
  organizationId: string,
  userId: string,
  input: SetQcItemPhotoCaptionInput
): Promise<void> {
  await loadQcItemInOrg(organizationId, input.itemId)
  await updateQcItemPhotoCaption(
    organizationId,
    userId,
    input.itemId,
    input.attachmentId,
    input.caption
  )
}
