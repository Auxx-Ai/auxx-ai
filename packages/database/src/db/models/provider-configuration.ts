// packages/database/src/db/models/provider-configuration.ts
// ProviderConfiguration model built on BaseModel (org-scoped)

import { ProviderConfiguration } from '../schema/provider-configuration'
import { BaseModel } from '../utils/base-model'

/** Selected ProviderConfiguration entity type */
export type ProviderConfigurationEntity = typeof ProviderConfiguration.$inferSelect
/** Insertable ProviderConfiguration input type */
export type CreateProviderConfigurationInput = typeof ProviderConfiguration.$inferInsert
/** Updatable ProviderConfiguration input type */
export type UpdateProviderConfigurationInput = Partial<CreateProviderConfigurationInput>

/**
 * ProviderConfigurationModel encapsulates CRUD for the ProviderConfiguration table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ProviderConfigurationModel extends BaseModel<
  typeof ProviderConfiguration,
  CreateProviderConfigurationInput,
  ProviderConfigurationEntity,
  UpdateProviderConfigurationInput
> {
  /** Drizzle table */
  get table() {
    return ProviderConfiguration
  }
}
