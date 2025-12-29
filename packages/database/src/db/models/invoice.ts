// packages/database/src/db/models/invoice.ts
// Invoice model built on BaseModel (org-scoped)

import { Invoice } from '../schema/invoice'
import { BaseModel } from '../utils/base-model'

/** Selected Invoice entity type */
export type InvoiceEntity = typeof Invoice.$inferSelect
/** Insertable Invoice input type */
export type CreateInvoiceInput = typeof Invoice.$inferInsert
/** Updatable Invoice input type */
export type UpdateInvoiceInput = Partial<CreateInvoiceInput>

/**
 * InvoiceModel encapsulates CRUD for the Invoice table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class InvoiceModel extends BaseModel<
  typeof Invoice,
  CreateInvoiceInput,
  InvoiceEntity,
  UpdateInvoiceInput
> {
  /** Drizzle table */
  get table() {
    return Invoice
  }
}
