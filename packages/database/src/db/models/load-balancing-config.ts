// packages/database/src/db/models/load-balancing-config.ts
// LoadBalancingConfig model built on BaseModel (org-scoped)

import { LoadBalancingConfig } from '../schema/load-balancing-config'
import { BaseModel } from '../utils/base-model'

/** Selected LoadBalancingConfig entity type */
export type LoadBalancingConfigEntity = typeof LoadBalancingConfig.$inferSelect
/** Insertable LoadBalancingConfig input type */
export type CreateLoadBalancingConfigInput = typeof LoadBalancingConfig.$inferInsert
/** Updatable LoadBalancingConfig input type */
export type UpdateLoadBalancingConfigInput = Partial<CreateLoadBalancingConfigInput>

/**
 * LoadBalancingConfigModel encapsulates CRUD for the LoadBalancingConfig table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class LoadBalancingConfigModel extends BaseModel<
  typeof LoadBalancingConfig,
  CreateLoadBalancingConfigInput,
  LoadBalancingConfigEntity,
  UpdateLoadBalancingConfigInput
> {
  /** Drizzle table */
  get table() {
    return LoadBalancingConfig
  }
}
