// packages/database/src/db/models/user-setting.ts
// UserSetting model built on BaseModel (no org scope column)

import { UserSetting } from '../schema/user-setting'
import { BaseModel } from '../utils/base-model'

/** Selected UserSetting entity type */
export type UserSettingEntity = typeof UserSetting.$inferSelect
/** Insertable UserSetting input type */
export type CreateUserSettingInput = typeof UserSetting.$inferInsert
/** Updatable UserSetting input type */
export type UpdateUserSettingInput = Partial<CreateUserSettingInput>

/**
 * UserSettingModel encapsulates CRUD for the UserSetting table.
 * No org scoping is applied by default.
 */
export class UserSettingModel extends BaseModel<
  typeof UserSetting,
  CreateUserSettingInput,
  UserSettingEntity,
  UpdateUserSettingInput
> {
  /** Drizzle table */
  get table() {
    return UserSetting
  }
}
