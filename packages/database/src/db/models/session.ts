// packages/database/src/db/models/session.ts
// session model built on BaseModel (no org scope column)

import { session } from '../schema/session'
import { BaseModel } from '../utils/base-model'

/** Selected session entity type */
export type sessionEntity = typeof session.$inferSelect
/** Insertable session input type */
export type CreatesessionInput = typeof session.$inferInsert
/** Updatable session input type */
export type UpdatesessionInput = Partial<CreatesessionInput>

/**
 * sessionModel encapsulates CRUD for the session table.
 * No org scoping is applied by default.
 */
export class sessionModel extends BaseModel<
  typeof session,
  CreatesessionInput,
  sessionEntity,
  UpdatesessionInput
> {
  /** Drizzle table */
  get table() {
    return session
  }
}
