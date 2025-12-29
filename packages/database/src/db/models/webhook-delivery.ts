// packages/database/src/db/models/webhook-delivery.ts
// WebhookDelivery model built on BaseModel (no org scope column)

import { WebhookDelivery } from '../schema/webhook-delivery'
import { BaseModel } from '../utils/base-model'

/** Selected WebhookDelivery entity type */
export type WebhookDeliveryEntity = typeof WebhookDelivery.$inferSelect
/** Insertable WebhookDelivery input type */
export type CreateWebhookDeliveryInput = typeof WebhookDelivery.$inferInsert
/** Updatable WebhookDelivery input type */
export type UpdateWebhookDeliveryInput = Partial<CreateWebhookDeliveryInput>

/**
 * WebhookDeliveryModel encapsulates CRUD for the WebhookDelivery table.
 * No org scoping is applied by default.
 */
export class WebhookDeliveryModel extends BaseModel<
  typeof WebhookDelivery,
  CreateWebhookDeliveryInput,
  WebhookDeliveryEntity,
  UpdateWebhookDeliveryInput
> {
  /** Drizzle table */
  get table() {
    return WebhookDelivery
  }
}
