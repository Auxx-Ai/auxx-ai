// packages/database/src/db/models/signature-integration-share.ts
// SignatureIntegrationShare model built on BaseModel (no org scope column)

import { SignatureIntegrationShare } from '../schema/signature-integration-share'
import { BaseModel } from '../utils/base-model'

/** Selected SignatureIntegrationShare entity type */
export type SignatureIntegrationShareEntity = typeof SignatureIntegrationShare.$inferSelect
/** Insertable SignatureIntegrationShare input type */
export type CreateSignatureIntegrationShareInput = typeof SignatureIntegrationShare.$inferInsert
/** Updatable SignatureIntegrationShare input type */
export type UpdateSignatureIntegrationShareInput = Partial<CreateSignatureIntegrationShareInput>

/**
 * SignatureIntegrationShareModel encapsulates CRUD for the SignatureIntegrationShare table.
 * No org scoping is applied by default.
 */
export class SignatureIntegrationShareModel extends BaseModel<
  typeof SignatureIntegrationShare,
  CreateSignatureIntegrationShareInput,
  SignatureIntegrationShareEntity,
  UpdateSignatureIntegrationShareInput
> {
  /** Drizzle table */
  get table() {
    return SignatureIntegrationShare
  }
}
