// packages/database/src/db/models/provider-preference.ts
// ProviderPreference model built on BaseModel (org-scoped)

import { ProviderPreference } from '../schema/provider-preference'
import { BaseModel } from '../utils/base-model'

/** Selected ProviderPreference entity type */
export type ProviderPreferenceEntity = typeof ProviderPreference.$inferSelect
/** Insertable ProviderPreference input type */
export type CreateProviderPreferenceInput = typeof ProviderPreference.$inferInsert
/** Updatable ProviderPreference input type */
export type UpdateProviderPreferenceInput = Partial<CreateProviderPreferenceInput>

/**
 * ProviderPreferenceModel encapsulates CRUD for the ProviderPreference table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ProviderPreferenceModel extends BaseModel<
  typeof ProviderPreference,
  CreateProviderPreferenceInput,
  ProviderPreferenceEntity,
  UpdateProviderPreferenceInput
> {
  /** Drizzle table */
  get table() {
    return ProviderPreference
  }
}
