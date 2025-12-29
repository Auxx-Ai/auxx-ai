// packages/database/src/db/models/signature.ts
// Signature model built on BaseModel (org-scoped)

import { and, eq, type SQL } from 'drizzle-orm'
import { Signature } from '../schema/signature'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected Signature entity type */
export type SignatureEntity = typeof Signature.$inferSelect
/** Insertable Signature input type */
export type CreateSignatureInput = typeof Signature.$inferInsert
/** Updatable Signature input type */
export type UpdateSignatureInput = Partial<CreateSignatureInput>

/**
 * SignatureModel encapsulates CRUD for the Signature table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class SignatureModel extends BaseModel<
  typeof Signature,
  CreateSignatureInput,
  SignatureEntity,
  UpdateSignatureInput
> {
  /** Drizzle table */
  get table() {
    return Signature
  }

  /** Find default signature for a user in current org */
  async findDefaultByUser(userId: string): Promise<TypedResult<SignatureEntity | null, Error>> {
    try {
      this.requireOrgIfScoped()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq(Signature.createdById, userId))
      whereParts.push(eq(Signature.isDefault, true))
      let q = this.db.select().from(Signature).limit(1).$dynamic()
      if (whereParts.length) q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok((rows?.[0] as SignatureEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
