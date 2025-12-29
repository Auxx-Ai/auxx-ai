// packages/database/src/db/models/organization-setting.ts
// OrganizationSetting model built on BaseModel (org-scoped)

import { OrganizationSetting } from '../schema/organization-setting'
import { BaseModel } from '../utils/base-model'

/** Selected OrganizationSetting entity type */
export type OrganizationSettingEntity = typeof OrganizationSetting.$inferSelect
/** Insertable OrganizationSetting input type */
export type CreateOrganizationSettingInput = typeof OrganizationSetting.$inferInsert
/** Updatable OrganizationSetting input type */
export type UpdateOrganizationSettingInput = Partial<CreateOrganizationSettingInput>

/**
 * OrganizationSettingModel encapsulates CRUD for the OrganizationSetting table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class OrganizationSettingModel extends BaseModel<
  typeof OrganizationSetting,
  CreateOrganizationSettingInput,
  OrganizationSettingEntity,
  UpdateOrganizationSettingInput
> {
  /** Drizzle table */
  get table() {
    return OrganizationSetting
  }
}
