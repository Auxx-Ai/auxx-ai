// packages/database/src/db/models/user.ts
// Example model for users built on BaseModel

import { eq } from 'drizzle-orm'
import { User } from '../schema/user'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected User entity type */
export type UserEntity = typeof User.$inferSelect

/** Insertable User input type */
export type CreateUserInput = typeof User.$inferInsert

/** Updatable User input type */
export type UpdateUserInput = Partial<CreateUserInput>

/**
 * UserModel encapsulates common CRUD for the User table.
 * Users are global (no organizationId scope here), so scopeFilter is undefined.
 */
export class UserModel extends BaseModel<typeof User, CreateUserInput, UserEntity, UpdateUserInput> {
  /** Drizzle table */
  get table() {
    return User
  }

  /** No org scope for users */
  get scopeFilter() {
    return undefined
  }

  /** Default select shape is inherited via select().from(User) */

  /** Find a user by email */
  async findByEmail(email: string): Promise<TypedResult<UserEntity | null, Error>> {
    try {
      const res = await this.db.select().from(User).where(eq(User.email, email)).limit(1)
      return Result.ok((res?.[0] as UserEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
