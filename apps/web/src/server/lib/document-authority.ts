// apps/web/src/server/lib/document-authority.ts

import { type Database, schema } from '@auxx/database'
import {
  DOCUMENT_EDIT_FAMILIES,
  type DocumentEditFamily,
  documentEditRow,
} from '@auxx/lib/accounting/documents/edit-in-place'
import type { LineDocumentType } from '@auxx/lib/accounting/documents/lines/client'
import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import {
  type CapabilitySet,
  FeaturePermissionService,
  PERMISSION_REGISTRY_MAP,
  PermissionKey,
} from '@auxx/lib/permissions'
import { and, eq } from 'drizzle-orm'

/** A document header whose edits (its own, or its lines') are authorized here. */
export type DocumentFamily = DocumentEditFamily | LineDocumentType

interface AuthorityCtx {
  db: Database
  session: { organizationId: string }
  capabilities: Pick<CapabilitySet, 'assert' | 'assertEditEntity' | 'assertViewEntity'>
}

/** Families that post their own ledger entry; editing one is a ledger act. */
function isLedgerFamily(family: DocumentFamily): boolean {
  return (
    (DOCUMENT_EDIT_FAMILIES as readonly string[]).includes(family) &&
    documentEditRow(family as DocumentEditFamily).ledger
  )
}

async function requireDocumentDefId(ctx: AuthorityCtx, family: DocumentFamily): Promise<string> {
  const defId = await getCachedEntityDefId(ctx.session.organizationId, family)
  if (!defId) throw new NotFoundError(`This organization has no ${family} records yet.`)
  return defId
}

/** Refuse an id that is not a `family` header in this org, so a family cannot borrow another's authority. */
async function requireDocument(
  ctx: AuthorityCtx,
  family: DocumentFamily,
  defId: string,
  documentId: string
): Promise<void> {
  const [row] = await ctx.db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, documentId),
        eq(schema.EntityInstance.organizationId, ctx.session.organizationId),
        eq(schema.EntityInstance.entityDefinitionId, defId)
      )
    )
    .limit(1)
  if (!row) throw new NotFoundError(`This ${family.replace(/_/g, ' ')} does not exist.`)
}

/**
 * Edit authority over a document and its lines (decision 10): a ledger family needs
 * `ledgerPost`, like Post and Void; any other needs edit on its own def.
 */
export async function assertMayEditDocument(
  ctx: AuthorityCtx,
  family: DocumentFamily,
  documentId: string
): Promise<void> {
  const { organizationId } = ctx.session
  if (isLedgerFamily(family)) {
    const featureKey = PERMISSION_REGISTRY_MAP.get(PermissionKey.ledgerPost)?.featureKey
    if (featureKey) await new FeaturePermissionService().requireAccess(organizationId, featureKey)
    ctx.capabilities.assert(PermissionKey.ledgerPost)
    await requireDocument(ctx, family, await requireDocumentDefId(ctx, family), documentId)
    return
  }
  const defId = await requireDocumentDefId(ctx, family)
  ctx.capabilities.assertEditEntity(defId)
  await requireDocument(ctx, family, defId, documentId)
}

/** View authority over a document and its lines: view on the header's def. */
export async function assertMayViewDocument(
  ctx: AuthorityCtx,
  family: DocumentFamily,
  documentId: string
): Promise<void> {
  const defId = await requireDocumentDefId(ctx, family)
  ctx.capabilities.assertViewEntity(defId)
  await requireDocument(ctx, family, defId, documentId)
}
