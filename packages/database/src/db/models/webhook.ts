// packages/database/src/db/models/webhook.ts
// Webhook model built on BaseModel (org-scoped)

import { and, eq, type SQL } from 'drizzle-orm'
import { Webhook } from '../schema/webhook'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected Webhook entity type */
export type WebhookEntity = typeof Webhook.$inferSelect
/** Insertable Webhook input type */
export type CreateWebhookInput = typeof Webhook.$inferInsert
/** Updatable Webhook input type */
export type UpdateWebhookInput = Partial<CreateWebhookInput>

/**
 * WebhookModel encapsulates CRUD for the Webhook table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class WebhookModel extends BaseModel<
  typeof Webhook,
  CreateWebhookInput,
  WebhookEntity,
  UpdateWebhookInput
> {
  /** Drizzle table */
  get table() {
    return Webhook
  }

  /** List active webhooks in current org */
  async listActive(): Promise<TypedResult<WebhookEntity[], Error>> {
    try {
      this.requireOrgIfScoped()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq(Webhook.isActive, true))
      let q = this.db.select().from(Webhook).$dynamic()
      if (whereParts.length) q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok(rows as WebhookEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** Global find by id if active (no org scope) */
  async findActiveByIdGlobal(id: string): Promise<TypedResult<WebhookEntity | null, Error>> {
    try {
      let q = this.db.select().from(Webhook).limit(1).$dynamic()
      q = q.where(and(eq(Webhook.id, id), eq(Webhook.isActive, true)))
      const rows = await q
      return Result.ok((rows?.[0] as WebhookEntity) ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** Global update by id without org scoping */
  async updateByIdGlobal(
    id: string,
    data: Partial<WebhookEntity>
  ): Promise<TypedResult<WebhookEntity, Error>> {
    try {
      const [row] = await this.db
        .update(Webhook)
        .set(data as any)
        .where(eq(Webhook.id, id))
        .returning()
      return row ? Result.ok(row as WebhookEntity) : Result.error(new Error('Webhook not found'))
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
