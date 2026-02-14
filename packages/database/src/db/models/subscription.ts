// packages/database/src/db/models/subscription.ts
// Subscription model built on BaseModel (org-scoped)

import { and, desc, eq, type SQL } from 'drizzle-orm'
import { Subscription } from '../schema/subscription'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected Subscription entity type */
export type SubscriptionEntity = typeof Subscription.$inferSelect
/** Insertable Subscription input type */
export type CreateSubscriptionInput = typeof Subscription.$inferInsert
/** Updatable Subscription input type */
export type UpdateSubscriptionInput = Partial<CreateSubscriptionInput>

/**
 * Narrow list item selection for subscriptions (excludes secret)
 */
export type SubscriptionListItem = Pick<
  SubscriptionEntity,
  'id' | 'provider' | 'topic' | 'active' | 'integrationId' | 'createdAt'
>

/**
 * SubscriptionModel encapsulates CRUD for the Subscription table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class SubscriptionModel extends BaseModel<
  typeof Subscription,
  CreateSubscriptionInput,
  SubscriptionEntity,
  UpdateSubscriptionInput
> {
  /** Drizzle table */
  get table() {
    return Subscription
  }

  /**
   * List subscriptions by provider (and optional topic) with a safe, minimal selection
   */
  async listByProvider(input: {
    /** Provider id like 'google' or 'shopify' */
    provider: string
    /** Optional topic filter */
    topic?: string
  }): Promise<TypedResult<SubscriptionListItem[], Error>> {
    try {
      this.requireOrgIfScoped()

      // Build where parts: enforced org scope + provider (+ optional topic)
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      whereParts.push(eq(Subscription.provider, input.provider))
      if (input.topic) whereParts.push(eq(Subscription.topic, input.topic))

      // Safe selection shape (no secret)
      let q = this.db
        .select({
          id: Subscription.id,
          provider: Subscription.provider,
          topic: Subscription.topic,
          active: Subscription.active,
          integrationId: Subscription.integrationId,
          createdAt: Subscription.createdAt,
        })
        .from(Subscription)
        .$dynamic()

      if (whereParts.length) q = q.where(and(...whereParts))
      q = q.orderBy(desc(Subscription.createdAt))

      const rows = await q
      return Result.ok(rows as SubscriptionListItem[])
    } catch (error: any) {
      return Result.error(error)
    }
  }

  /** Global lookup by provider+integrationId+topic without org scoping */
  async findByProviderIntegrationTopicGlobal(input: {
    provider: string
    integrationId: string
    topic: string
  }): Promise<TypedResult<SubscriptionListItem | null, Error>> {
    try {
      const q = this.db
        .select({
          id: Subscription.id,
          provider: Subscription.provider,
          topic: Subscription.topic,
          active: Subscription.active,
          integrationId: Subscription.integrationId,
          createdAt: Subscription.createdAt,
          organizationId: Subscription.organizationId,
        })
        .from(Subscription)
        .where(
          and(
            eq(Subscription.provider, input.provider),
            eq(Subscription.integrationId, input.integrationId),
            eq(Subscription.topic, input.topic)
          )
        )
        .limit(1)
      const rows = await q
      const row = rows?.[0] as any
      if (!row) return Result.ok(null)
      // Drop organizationId from the return type to match SubscriptionListItem shape
      const { organizationId: _org, ...rest } = row
      return Result.ok(rest as SubscriptionListItem)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
