// apps/worker/scripts/verify-dispatch-ws2.ts
/**
 * Dispatch WS2 "Quality Checklist" verification (plans/dispatch/08-worker-surface.md §5,
 * ws2-contract.md §Verify). Exercises the REAL admin template catalog + worker-scoped snapshot
 * checklist added in WS2 1A: `packages/lib/src/dispatch/qc.ts`'s admin fns
 * (`listQcItemTemplates`, `createQcItemTemplate`, `updateQcItemTemplate`,
 * `reorderQcItemTemplates`) and worker fns (`listMyVisitQcItems`, `setMyQcItemChecked`,
 * `setMyQcItemNote`, `addMyAdhocQcItem`, `addMyQcItemPhoto`, `removeMyQcItemPhoto`).
 *
 * Covers, in order:
 *   1. Template CRUD — create (defaults + explicit isRequired), list order, update, a batch
 *      reorder that persists, and a reorder call carrying a foreign/unknown id that must throw
 *      `ForbiddenError` with NO partial writes (the pre-check-then-transaction recipe).
 *   2. Materialize-once — first `listMyVisitQcItems` on a fresh visit copies ONLY active
 *      templates (deactivated ones excluded) as ordered snapshots; a second call is a pure
 *      read-back (no duplication). 2b covers the org-has-zero-active-templates edge (empty
 *      `items`, still no throw) by temporarily deactivating every template this script owns.
 *   3. Snapshot integrity — editing a template's title/isRequired AFTER materialization must
 *      NOT rewrite already-materialized `VisitQcItem` rows; a visit materialized afterward sees
 *      the new values.
 *   4. Check/uncheck (stamps + clears `checkedAt`/`checkedByUserId`), note set/clear, and the
 *      ad-hoc row shape (`templateId: null`, `isRequired: false`, appended `sortOrder`).
 *   5. The assignee guard (`loadOwnVisit` for visit-id fns, `loadOwnQcItem` for item-id fns) on
 *      EVERY worker fn — a stranger `User` (no org) gets `ForbiddenError`, a nonexistent
 *      visit/item gets `NotFoundError`.
 *   6. Photos — a directly-inserted `MediaAsset` row, `addMyQcItemPhoto` creating a matching
 *      `Attachment` row (`entityType: 'visit_qc_item'`), `removeMyQcItemPhoto` deleting it, and
 *      a cross-item mismatch attempt throwing `NotFoundError` while leaving the row intact.
 *   7. Required-open semantics — the client-computed
 *      `items.filter(i => i.isRequired && !i.checkedAt).length` shape, using two dedicated
 *      required templates so it can't be muddied by earlier sections' template edits.
 *
 * Deliberately DOESN'T include a `unwrap()` helper (unlike the ws1 script's `RecordingResult`
 * unwrap) — every `qc.ts` fn throws `AuxxError` subclasses directly, there's no `neverthrow`
 * `Result` anywhere on this surface (per ws2-contract.md), so an unused unwrap helper would just
 * be dead code.
 *
 * Work orders are created via `UnifiedCrudHandler.create` (the M1 number + visit auto-create
 * hooks), prefixed "[WS2-verify]". `WorkOrderVisit` rows cascade off `EntityInstance` deletes
 * (the `verify-dispatch-ws1.ts` precedent), and `VisitQcItem.visitId` itself cascades off
 * `WorkOrderVisit` deletes — but cleanup still explicitly clears `VisitQcItem` by visit id first
 * (ws2-contract.md's prescribed order), since `Attachment`/`MediaAsset` rows are polymorphic
 * (`Attachment.entityId` carries no real FK to `VisitQcItem`) and need their own explicit
 * teardown before the `QcItemTemplate` rows and, last, the work orders themselves.
 *
 * The dev org (`u45w22ft66ymiaa19ohs7m9f`, "Marki Corp") has exactly one member — the dev user —
 * so this script reuses ws1's real orgless `User` row as the "stranger" fixture for every guard
 * check (there's no second in-org member to stand in for an "assigned to someone else" case that
 * differs materially from "assigned to a stranger" — the guard only compares `assigneeUserId`).
 *
 * `apps/worker` has no direct `drizzle-orm` dependency (the `verify-dispatch-recurring.ts`
 * precedent) — reads use the `database.query.*` relational API and raw-table cleanup deletes use
 * `database.$client.query(...)`.
 *
 * Run (from repo root) under the worker runtime:
 *   cd apps/worker && npx dotenv -e ../../.env -- node --conditions source --import tsx/esm \
 *     scripts/verify-dispatch-ws2.ts
 */

import { database, schema } from '@auxx/database'
import {
  addMyAdhocQcItem,
  addMyQcItemPhoto,
  assignVisit,
  createQcItemTemplate,
  listMyVisitQcItems,
  listQcItemTemplates,
  removeMyQcItemPhoto,
  reorderQcItemTemplates,
  setMyQcItemChecked,
  setMyQcItemNote,
  updateQcItemTemplate,
} from '@auxx/lib/dispatch'
import { ForbiddenError, NotFoundError } from '@auxx/lib/errors'
import { UnifiedCrudHandler } from '@auxx/lib/resources'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.log(`  ❌ ${name}`, detail ?? '')
  }
}

/** Run `fn`, expecting it to throw. Returns the caught error (or `undefined` if it didn't). */
async function expectThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return undefined
  } catch (err) {
    return err ?? new Error('threw a falsy value')
  }
}

/** True when `obj`'s own keys are all in `allowed` — the `MyVisitQcItem` shape check. */
function hasOnlyKeys(obj: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(obj).every((k) => allowed.includes(k))
}

async function firstVisit(workOrderInstanceId: string) {
  const visit = await database.query.WorkOrderVisit.findFirst({
    where: (t, { eq }) => eq(t.workOrderId, workOrderInstanceId),
  })
  if (!visit) throw new Error(`No visit found for work order ${workOrderInstanceId}`)
  return visit
}

async function main() {
  const devUser = await database.query.User.findFirst({
    columns: { id: true, email: true },
    where: (t, { eq }) => eq(t.email, 'm4rkuskk@gmail.com'),
  })
  if (!devUser) throw new Error('Dev user not found')
  const organizationId = 'u45w22ft66ymiaa19ohs7m9f' // Marki Corp (primary dev org — ws1 precedent)
  const userId = devUser.id

  // Real `User` row belonging to NO organization — safe FK-satisfying "stranger" fixture (see
  // file header). Verified to exist so a stale hardcoded id fails loudly instead of silently
  // producing a bogus ForbiddenError check.
  const otherUserId = 'AOE6LhgqU5DMxA2oJlOC6xnfAGhnFeHM'
  const otherUser = await database.query.User.findFirst({
    columns: { id: true },
    where: (t, { eq }) => eq(t.id, otherUserId),
  })
  if (!otherUser) throw new Error(`Stranger fixture user ${otherUserId} not found`)
  console.log(`Org ${organizationId}, dev user ${userId}, stranger user ${otherUserId}`)

  const handler = new UnifiedCrudHandler(organizationId, userId)

  const createdWorkOrderIds: string[] = []
  const createdVisitIds: string[] = []
  const createdTemplateIds: string[] = []
  const createdAttachmentIds: string[] = []
  const createdMediaAssetIds: string[] = []

  async function createWO(title: string) {
    const wo = await handler.create('work_order', { work_order_title: `[WS2-verify] ${title}` })
    createdWorkOrderIds.push(wo.instance.id)
    const visit = await firstVisit(wo.instance.id)
    createdVisitIds.push(visit.id)
    return { wo, visit }
  }

  async function insertMediaAsset(): Promise<{ id: string }> {
    const [row] = await database
      .insert(schema.MediaAsset)
      .values({ organizationId, kind: 'IMAGE', updatedAt: new Date() })
      .returning({ id: schema.MediaAsset.id })
    if (!row) throw new Error('Failed to insert MediaAsset fixture')
    createdMediaAssetIds.push(row.id)
    return row
  }

  try {
    // ══════════════════════════════════════════════════════════════════════
    // 1. Template CRUD
    // ══════════════════════════════════════════════════════════════════════
    console.log('1: template CRUD')
    const t1 = await createQcItemTemplate(organizationId, {
      title: '[WS2-verify] T1',
      isRequired: true,
    })
    const t2 = await createQcItemTemplate(organizationId, { title: '[WS2-verify] T2' })
    const t3 = await createQcItemTemplate(organizationId, {
      title: '[WS2-verify] T3 (to deactivate)',
    })
    createdTemplateIds.push(t1.id, t2.id, t3.id)

    check('createQcItemTemplate: t1 isRequired explicit true', t1.isRequired === true, t1)
    check('createQcItemTemplate: t2 isRequired defaults false', t2.isRequired === false, t2)
    check('createQcItemTemplate: t3 isActive defaults true', t3.isActive === true, t3)
    check(
      'createQcItemTemplate: sortOrder strictly increasing across creates (max+1 recipe)',
      t1.sortOrder < t2.sortOrder && t2.sortOrder < t3.sortOrder,
      { t1: t1.sortOrder, t2: t2.sortOrder, t3: t3.sortOrder }
    )

    const listAfterCreate = await listQcItemTemplates(organizationId)
    const ourIdsInOrder = listAfterCreate
      .filter((t) => t.title.startsWith('[WS2-verify]'))
      .map((t) => t.id)
    check(
      'listQcItemTemplates: ordered sortOrder asc — t1,t2,t3',
      ourIdsInOrder.length === 3 &&
        ourIdsInOrder[0] === t1.id &&
        ourIdsInOrder[1] === t2.id &&
        ourIdsInOrder[2] === t3.id,
      ourIdsInOrder
    )

    const t1Updated = await updateQcItemTemplate(organizationId, {
      templateId: t1.id,
      title: '[WS2-verify] T1 (updated)',
    })
    check(
      'updateQcItemTemplate: title changed, isRequired untouched',
      t1Updated.title === '[WS2-verify] T1 (updated)' && t1Updated.isRequired === true,
      t1Updated
    )

    const updateForeign = await expectThrow(() =>
      updateQcItemTemplate(organizationId, {
        templateId: 'nonexistent-template-id-000000',
        title: 'nope',
      })
    )
    check(
      'updateQcItemTemplate: unknown id -> NotFoundError',
      updateForeign instanceof NotFoundError,
      updateForeign
    )

    // Reverse the order: t3 -> 0, t2 -> 1, t1 -> 2.
    await reorderQcItemTemplates(organizationId, [
      { id: t3.id, sortOrder: 0 },
      { id: t2.id, sortOrder: 1 },
      { id: t1.id, sortOrder: 2 },
    ])
    const listAfterReorder = await listQcItemTemplates(organizationId)
    const reorderedIds = listAfterReorder
      .filter((t) => t.title.startsWith('[WS2-verify]'))
      .map((t) => t.id)
    check(
      'reorderQcItemTemplates: batch persists — t3,t2,t1',
      reorderedIds.length === 3 &&
        reorderedIds[0] === t3.id &&
        reorderedIds[1] === t2.id &&
        reorderedIds[2] === t1.id,
      reorderedIds
    )

    const sortOrdersBeforeBadReorder = new Map(listAfterReorder.map((t) => [t.id, t.sortOrder]))
    const reorderForbidden = await expectThrow(() =>
      reorderQcItemTemplates(organizationId, [
        { id: t1.id, sortOrder: 99 },
        { id: 'nonexistent-template-id-000000', sortOrder: 100 },
      ])
    )
    check(
      'reorderQcItemTemplates: unknown id in the batch -> ForbiddenError',
      reorderForbidden instanceof ForbiddenError,
      reorderForbidden
    )
    const listAfterBadReorder = await listQcItemTemplates(organizationId)
    const t1AfterBadReorder = listAfterBadReorder.find((t) => t.id === t1.id)
    check(
      'reorderQcItemTemplates: forbidden batch made NO partial writes (t1.sortOrder unchanged)',
      t1AfterBadReorder?.sortOrder === sortOrdersBeforeBadReorder.get(t1.id),
      { before: sortOrdersBeforeBadReorder.get(t1.id), after: t1AfterBadReorder?.sortOrder }
    )

    const t3Deactivated = await updateQcItemTemplate(organizationId, {
      templateId: t3.id,
      isActive: false,
    })
    check('updateQcItemTemplate: t3 deactivated', t3Deactivated.isActive === false, t3Deactivated)

    // ══════════════════════════════════════════════════════════════════════
    // 2. Materialize-once (t3 excluded — deactivated; t2 then t1 by sortOrder)
    // ══════════════════════════════════════════════════════════════════════
    console.log('2: materialize-once')
    const { visit: vA } = await createWO('materialize-once')
    await assignVisit({ organizationId, userId, visitId: vA.id, assigneeUserId: userId })

    const first = await listMyVisitQcItems(organizationId, userId, vA.id)
    check(
      'materialize: only 2 ACTIVE templates copied (t3 deactivated, excluded)',
      first.items.length === 2,
      first.items
    )
    check(
      'materialize: snapshot order follows template sortOrder (t2 then t1)',
      first.items[0]?.templateId === t2.id && first.items[1]?.templateId === t1.id,
      first.items.map((i) => i.templateId)
    )
    check(
      'materialize: t1 snapshot carries the CURRENT title/isRequired at copy time',
      first.items[1]?.title === t1Updated.title && first.items[1]?.isRequired === true,
      first.items[1]
    )
    check(
      'materialize: item shape carries ONLY the contracted keys',
      first.items.every((i) =>
        hasOnlyKeys(i as unknown as Record<string, unknown>, [
          'id',
          'templateId',
          'title',
          'isRequired',
          'note',
          'checkedAt',
          'sortOrder',
          'photos',
        ])
      ),
      first.items
    )

    const second = await listMyVisitQcItems(organizationId, userId, vA.id)
    check(
      'materialize: second call does NOT duplicate (same count)',
      second.items.length === first.items.length,
      { first: first.items.length, second: second.items.length }
    )
    check(
      'materialize: second call returns the SAME row ids (pure read-back)',
      second.items.map((i) => i.id).join(',') === first.items.map((i) => i.id).join(','),
      { first: first.items.map((i) => i.id), second: second.items.map((i) => i.id) }
    )

    // ── 2b. Zero active templates -> empty items, no throw ──
    console.log('2b: zero active templates -> empty items, no throw')
    await updateQcItemTemplate(organizationId, { templateId: t1.id, isActive: false })
    await updateQcItemTemplate(organizationId, { templateId: t2.id, isActive: false })
    const activeCountNow = (await listQcItemTemplates(organizationId)).filter(
      (t) => t.isActive
    ).length
    check(
      'precondition: no active templates remain (t1/t2/t3 all deactivated)',
      activeCountNow === 0,
      activeCountNow
    )

    const { visit: vZero } = await createWO('zero-active-templates')
    await assignVisit({ organizationId, userId, visitId: vZero.id, assigneeUserId: userId })
    const zeroResult = await listMyVisitQcItems(organizationId, userId, vZero.id)
    check(
      'materialize: zero active templates -> empty items array, no error thrown',
      zeroResult.items.length === 0,
      zeroResult
    )

    // Reactivate for the rest of the script.
    await updateQcItemTemplate(organizationId, { templateId: t1.id, isActive: true })
    await updateQcItemTemplate(organizationId, { templateId: t2.id, isActive: true })

    // ══════════════════════════════════════════════════════════════════════
    // 3. Snapshot integrity
    // ══════════════════════════════════════════════════════════════════════
    console.log('3: snapshot integrity')
    const t1Edited = await updateQcItemTemplate(organizationId, {
      templateId: t1.id,
      title: '[WS2-verify] T1 (edited-after-materialize)',
      isRequired: false,
    })
    check(
      'updateQcItemTemplate: title + isRequired changed post-materialization',
      t1Edited.title !== t1Updated.title && t1Edited.isRequired === false,
      t1Edited
    )

    const vAItemsAfterEdit = await listMyVisitQcItems(organizationId, userId, vA.id)
    const vAT1Item = vAItemsAfterEdit.items.find((i) => i.templateId === t1.id)
    check(
      'snapshot integrity: existing VisitQcItem title UNCHANGED after template edit',
      vAT1Item?.title === t1Updated.title,
      vAT1Item
    )
    check(
      'snapshot integrity: existing VisitQcItem isRequired UNCHANGED after template edit',
      vAT1Item?.isRequired === true,
      vAT1Item
    )

    const { visit: vB } = await createWO('snapshot-new-visit')
    await assignVisit({ organizationId, userId, visitId: vB.id, assigneeUserId: userId })
    const vBItems = await listMyVisitQcItems(organizationId, userId, vB.id)
    const vBT1Item = vBItems.items.find((i) => i.templateId === t1.id)
    check(
      'snapshot integrity: a NEW visit materializes the EDITED title',
      vBT1Item?.title === t1Edited.title,
      vBT1Item
    )
    check(
      'snapshot integrity: a NEW visit materializes the EDITED isRequired',
      vBT1Item?.isRequired === false,
      vBT1Item
    )

    // ══════════════════════════════════════════════════════════════════════
    // 4. Check/uncheck, note, ad-hoc
    // ══════════════════════════════════════════════════════════════════════
    console.log('4: check/uncheck, note, ad-hoc')
    const vAT2Item = vAItemsAfterEdit.items.find((i) => i.templateId === t2.id)
    if (!vAT2Item) throw new Error('t2 snapshot item not found on visit A')

    const checked = await setMyQcItemChecked(organizationId, userId, {
      itemId: vAT2Item.id,
      checked: true,
    })
    check(
      'setMyQcItemChecked(true): checkedAt + checkedByUserId stamped',
      checked.checkedAt instanceof Date && checked.checkedByUserId === userId,
      checked
    )
    const unchecked = await setMyQcItemChecked(organizationId, userId, {
      itemId: vAT2Item.id,
      checked: false,
    })
    check(
      'setMyQcItemChecked(false): checkedAt + checkedByUserId cleared',
      unchecked.checkedAt === null && unchecked.checkedByUserId === null,
      unchecked
    )

    const noted = await setMyQcItemNote(organizationId, userId, {
      itemId: vAT2Item.id,
      note: 'looks good',
    })
    check('setMyQcItemNote: note set', noted.note === 'looks good', noted.note)
    const notedCleared = await setMyQcItemNote(organizationId, userId, {
      itemId: vAT2Item.id,
      note: null,
    })
    check('setMyQcItemNote: note cleared (null)', notedCleared.note === null, notedCleared.note)

    const beforeAdhoc = await listMyVisitQcItems(organizationId, userId, vA.id)
    const maxSortBefore = Math.max(...beforeAdhoc.items.map((i) => i.sortOrder))
    const adhoc = await addMyAdhocQcItem(organizationId, userId, {
      visitId: vA.id,
      title: '[WS2-verify] adhoc item',
    })
    check('addMyAdhocQcItem: templateId null', adhoc.templateId === null, adhoc.templateId)
    check('addMyAdhocQcItem: isRequired false', adhoc.isRequired === false, adhoc.isRequired)
    check('addMyAdhocQcItem: sortOrder appended (max+1)', adhoc.sortOrder === maxSortBefore + 1, {
      adhoc: adhoc.sortOrder,
      maxSortBefore,
    })

    // ══════════════════════════════════════════════════════════════════════
    // 5. Assignee guard on EVERY worker fn
    // ══════════════════════════════════════════════════════════════════════
    console.log('5: assignee guard on every worker fn')
    const { visit: vC } = await createWO('assignee guard')
    await assignVisit({ organizationId, userId, visitId: vC.id, assigneeUserId: userId })
    const guardItem = await addMyAdhocQcItem(organizationId, userId, {
      visitId: vC.id,
      title: '[WS2-verify] guard item',
    })

    const listForbidden = await expectThrow(() =>
      listMyVisitQcItems(organizationId, otherUserId, vC.id)
    )
    check(
      'listMyVisitQcItems: stranger -> ForbiddenError',
      listForbidden instanceof ForbiddenError,
      listForbidden
    )
    const listNotFound = await expectThrow(() =>
      listMyVisitQcItems(organizationId, userId, 'nonexistent-visit-id-000000')
    )
    check(
      'listMyVisitQcItems: nonexistent visit -> NotFoundError',
      listNotFound instanceof NotFoundError,
      listNotFound
    )

    const adhocForbidden = await expectThrow(() =>
      addMyAdhocQcItem(organizationId, otherUserId, { visitId: vC.id, title: 'x' })
    )
    check(
      'addMyAdhocQcItem: stranger -> ForbiddenError',
      adhocForbidden instanceof ForbiddenError,
      adhocForbidden
    )
    const adhocNotFound = await expectThrow(() =>
      addMyAdhocQcItem(organizationId, userId, {
        visitId: 'nonexistent-visit-id-000000',
        title: 'x',
      })
    )
    check(
      'addMyAdhocQcItem: nonexistent visit -> NotFoundError',
      adhocNotFound instanceof NotFoundError,
      adhocNotFound
    )

    const checkedForbidden = await expectThrow(() =>
      setMyQcItemChecked(organizationId, otherUserId, { itemId: guardItem.id, checked: true })
    )
    check(
      'setMyQcItemChecked: stranger -> ForbiddenError',
      checkedForbidden instanceof ForbiddenError,
      checkedForbidden
    )
    const checkedNotFound = await expectThrow(() =>
      setMyQcItemChecked(organizationId, userId, {
        itemId: 'nonexistent-item-id-000000',
        checked: true,
      })
    )
    check(
      'setMyQcItemChecked: nonexistent item -> NotFoundError',
      checkedNotFound instanceof NotFoundError,
      checkedNotFound
    )

    const noteForbidden = await expectThrow(() =>
      setMyQcItemNote(organizationId, otherUserId, { itemId: guardItem.id, note: 'x' })
    )
    check(
      'setMyQcItemNote: stranger -> ForbiddenError',
      noteForbidden instanceof ForbiddenError,
      noteForbidden
    )
    const noteNotFound = await expectThrow(() =>
      setMyQcItemNote(organizationId, userId, { itemId: 'nonexistent-item-id-000000', note: 'x' })
    )
    check(
      'setMyQcItemNote: nonexistent item -> NotFoundError',
      noteNotFound instanceof NotFoundError,
      noteNotFound
    )

    const photoAddForbidden = await expectThrow(() =>
      addMyQcItemPhoto(organizationId, otherUserId, {
        itemId: guardItem.id,
        assetId: 'fake-asset-id',
      })
    )
    check(
      'addMyQcItemPhoto: stranger -> ForbiddenError',
      photoAddForbidden instanceof ForbiddenError,
      photoAddForbidden
    )
    const photoAddNotFound = await expectThrow(() =>
      addMyQcItemPhoto(organizationId, userId, {
        itemId: 'nonexistent-item-id-000000',
        assetId: 'fake-asset-id',
      })
    )
    check(
      'addMyQcItemPhoto: nonexistent item -> NotFoundError',
      photoAddNotFound instanceof NotFoundError,
      photoAddNotFound
    )

    const photoRemoveForbidden = await expectThrow(() =>
      removeMyQcItemPhoto(organizationId, otherUserId, {
        itemId: guardItem.id,
        attachmentId: 'fake-attachment-id',
      })
    )
    check(
      'removeMyQcItemPhoto: stranger -> ForbiddenError',
      photoRemoveForbidden instanceof ForbiddenError,
      photoRemoveForbidden
    )
    const photoRemoveNotFound = await expectThrow(() =>
      removeMyQcItemPhoto(organizationId, userId, {
        itemId: 'nonexistent-item-id-000000',
        attachmentId: 'fake-attachment-id',
      })
    )
    check(
      'removeMyQcItemPhoto: nonexistent item -> NotFoundError',
      photoRemoveNotFound instanceof NotFoundError,
      photoRemoveNotFound
    )

    // ══════════════════════════════════════════════════════════════════════
    // 6. Photos
    // ══════════════════════════════════════════════════════════════════════
    console.log('6: photos')
    const asset1 = await insertMediaAsset()
    const photo1 = await addMyQcItemPhoto(organizationId, userId, {
      itemId: guardItem.id,
      assetId: asset1.id,
    })
    createdAttachmentIds.push(photo1.attachmentId)
    check(
      'addMyQcItemPhoto: returns { attachmentId, assetId }',
      !!photo1.attachmentId && photo1.assetId === asset1.id,
      photo1
    )

    const attachmentRow1 = await database.query.Attachment.findFirst({
      where: (t, { eq }) => eq(t.id, photo1.attachmentId),
    })
    check(
      'addMyQcItemPhoto: Attachment row created (entityType=visit_qc_item, entityId=itemId, org matches)',
      attachmentRow1?.entityType === 'visit_qc_item' &&
        attachmentRow1?.entityId === guardItem.id &&
        attachmentRow1?.organizationId === organizationId,
      attachmentRow1
    )

    const item2 = await addMyAdhocQcItem(organizationId, userId, {
      visitId: vC.id,
      title: '[WS2-verify] guard item 2',
    })
    const asset2 = await insertMediaAsset()
    const photo2 = await addMyQcItemPhoto(organizationId, userId, {
      itemId: item2.id,
      assetId: asset2.id,
    })
    createdAttachmentIds.push(photo2.attachmentId)

    const mismatchRemove = await expectThrow(() =>
      removeMyQcItemPhoto(organizationId, userId, {
        itemId: guardItem.id, // wrong item — photo2 belongs to item2
        attachmentId: photo2.attachmentId,
      })
    )
    check(
      'removeMyQcItemPhoto: attachment belonging to a DIFFERENT item -> NotFoundError',
      mismatchRemove instanceof NotFoundError,
      mismatchRemove
    )
    const survivingAttachment = await database.query.Attachment.findFirst({
      where: (t, { eq }) => eq(t.id, photo2.attachmentId),
    })
    check(
      'removeMyQcItemPhoto: mismatched attempt did NOT delete the row',
      !!survivingAttachment,
      survivingAttachment
    )

    await removeMyQcItemPhoto(organizationId, userId, {
      itemId: guardItem.id,
      attachmentId: photo1.attachmentId,
    })
    const deletedAttachment = await database.query.Attachment.findFirst({
      where: (t, { eq }) => eq(t.id, photo1.attachmentId),
    })
    check('removeMyQcItemPhoto: row deleted', deletedAttachment === undefined, deletedAttachment)

    // ══════════════════════════════════════════════════════════════════════
    // 7. Required-open semantics (dedicated templates, isolated from earlier edits)
    // ══════════════════════════════════════════════════════════════════════
    console.log('7: required-open semantics')
    const tReqA = await createQcItemTemplate(organizationId, {
      title: '[WS2-verify] ReqA',
      isRequired: true,
    })
    const tReqB = await createQcItemTemplate(organizationId, {
      title: '[WS2-verify] ReqB',
      isRequired: true,
    })
    createdTemplateIds.push(tReqA.id, tReqB.id)

    const { visit: vD } = await createWO('required-open-count')
    await assignVisit({ organizationId, userId, visitId: vD.id, assigneeUserId: userId })
    const dResult = await listMyVisitQcItems(organizationId, userId, vD.id)
    const dReqA = dResult.items.find((i) => i.templateId === tReqA.id)
    const dReqB = dResult.items.find((i) => i.templateId === tReqB.id)
    if (!dReqA || !dReqB) throw new Error('required-open fixture items missing after materialize')

    await setMyQcItemChecked(organizationId, userId, { itemId: dReqA.id, checked: true })
    const dResultAfter = await listMyVisitQcItems(organizationId, userId, vD.id)
    const requiredOpen = dResultAfter.items.filter((i) => i.isRequired && !i.checkedAt).length
    check(
      'required-open count: 2 required templates, 1 checked -> 1 open',
      requiredOpen === 1,
      dResultAfter.items
    )
  } finally {
    // ── Cleanup (ws2-contract.md order: VisitQcItem, QcItemTemplate, Attachment, MediaAsset,
    // then work orders) ──
    console.log(
      `Cleanup: ${createdVisitIds.length} visits' QC items, ${createdTemplateIds.length} ` +
        `templates, ${createdAttachmentIds.length} attachments, ${createdMediaAssetIds.length} ` +
        `media assets, ${createdWorkOrderIds.length} work orders`
    )
    for (const visitId of [...new Set(createdVisitIds)]) {
      try {
        await database.$client.query('DELETE FROM "VisitQcItem" WHERE "visitId" = $1', [visitId])
      } catch (err) {
        console.log(
          `  cleanup failed for VisitQcItem(visitId=${visitId}):`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdAttachmentIds)]) {
      try {
        await database.$client.query('DELETE FROM "Attachment" WHERE id = $1', [id])
      } catch (err) {
        console.log(
          `  cleanup failed for Attachment:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdMediaAssetIds)]) {
      try {
        await database.$client.query('DELETE FROM "MediaAsset" WHERE id = $1', [id])
      } catch (err) {
        console.log(
          `  cleanup failed for MediaAsset:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdTemplateIds)]) {
      try {
        await database.$client.query('DELETE FROM "QcItemTemplate" WHERE id = $1', [id])
      } catch (err) {
        console.log(
          `  cleanup failed for QcItemTemplate:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
    for (const id of [...new Set(createdWorkOrderIds)]) {
      try {
        await handler.delete(`work_order:${id}` as never)
      } catch (err) {
        console.log(
          `  cleanup failed for work_order:${id}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
