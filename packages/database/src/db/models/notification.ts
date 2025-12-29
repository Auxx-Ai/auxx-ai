// packages/database/src/db/models/notification.ts
// Notification model built on BaseModel (org-scoped)

import { Notification } from '../schema/notification'
import { BaseModel } from '../utils/base-model'

/** Selected Notification entity type */
export type NotificationEntity = typeof Notification.$inferSelect
/** Insertable Notification input type */
export type CreateNotificationInput = typeof Notification.$inferInsert
/** Updatable Notification input type */
export type UpdateNotificationInput = Partial<CreateNotificationInput>

/**
 * NotificationModel encapsulates CRUD for the Notification table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class NotificationModel extends BaseModel<
  typeof Notification,
  CreateNotificationInput,
  NotificationEntity,
  UpdateNotificationInput
> {
  /** Drizzle table */
  get table() {
    return Notification
  }
}
