// packages/database/src/db/models/webhook-event.ts
// WebhookEvent model built on BaseModel (org-scoped)

import { WebhookEvent } from '../schema/webhook-event'
import { BaseModel } from '../utils/base-model'

/** Selected WebhookEvent entity type */
export type WebhookEventEntity = typeof WebhookEvent.$inferSelect
/** Insertable WebhookEvent input type */
export type CreateWebhookEventInput = typeof WebhookEvent.$inferInsert
/** Updatable WebhookEvent input type */
export type UpdateWebhookEventInput = Partial<CreateWebhookEventInput>

/**
 * WebhookEventModel encapsulates CRUD for the WebhookEvent table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class WebhookEventModel extends BaseModel<
  typeof WebhookEvent,
  CreateWebhookEventInput,
  WebhookEventEntity,
  UpdateWebhookEventInput
> {
  /** Drizzle table */
  get table() {
    return WebhookEvent
  }
}
