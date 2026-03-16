// packages/lib/src/permissions/feature-permission-service.ts

import { isSelfHosted } from '@auxx/deployment'
import { getOrgCache, onCacheEvent } from '../cache'
import { ForbiddenError } from '../errors'
import type { FeatureLimit, FeatureMapObject } from './types'
import { FEATURE_REGISTRY_MAP, FeatureKey } from './types'

export type FeatureMap = Map<string, FeatureLimit>

export class FeaturePermissionService {
  // biome-ignore lint/complexity/noUselessConstructor: backward compat — callers pass db
  constructor(_db?: unknown) {}

  async getOrganizationFeaturesMap(organizationId: string): Promise<FeatureMapObject | null> {
    if (isSelfHosted()) return this.createUnlimitedFeaturesObject()

    const { features } = await getOrgCache().getOrRecompute(organizationId, ['features'])
    return features
  }

  async getOrganizationFeatures(organizationId: string): Promise<FeatureMap | null> {
    if (isSelfHosted()) return this.createUnlimitedFeatureMap()

    const { features } = await getOrgCache().getOrRecompute(organizationId, ['features'])
    if (!features) return null
    return new Map(Object.entries(features))
  }

  async hasAccess(organizationId: string, featureKey: FeatureKey | string): Promise<boolean> {
    if (isSelfHosted()) return true
    const features = await this.getOrganizationFeatures(organizationId)
    if (!features) return false

    const limit = features.get(featureKey)
    if (limit === undefined || limit === false || limit === 0) return false
    return true
  }

  async getLimit(
    organizationId: string,
    featureKey: FeatureKey | string
  ): Promise<FeatureLimit | null> {
    if (isSelfHosted()) return '+'
    const features = await this.getOrganizationFeatures(organizationId)
    if (!features) return null

    const limit = features.get(featureKey)
    if (limit === undefined || limit === false || limit === 0) return null
    return limit
  }

  async checkLimit(
    organizationId: string,
    featureKey: FeatureKey | string,
    currentUsage: number
  ): Promise<boolean> {
    if (isSelfHosted()) return true
    const limit = await this.getLimit(organizationId, featureKey)

    if (limit === null || limit === false) return false
    if (limit === '+') return true
    if (typeof limit === 'number') return currentUsage < limit
    if (limit === true) return true
    return false
  }

  // ── Guard methods (throw on denial) ──

  async requireAccess(organizationId: string, featureKey: FeatureKey | string): Promise<void> {
    const allowed = await this.hasAccess(organizationId, featureKey)
    if (!allowed) {
      const label = FEATURE_REGISTRY_MAP.get(featureKey as FeatureKey)?.label ?? featureKey
      throw new ForbiddenError(`${label} is not available on your plan.`)
    }
  }

  async requireLimit(
    organizationId: string,
    featureKey: FeatureKey | string,
    countFn: () => Promise<number>
  ): Promise<void> {
    const limit = await this.getLimit(organizationId, featureKey)
    if (limit === null || limit === false) return
    if (limit === '+' || limit === true) return
    if (typeof limit === 'number') {
      const current = await countFn()
      if (current >= limit) {
        const label = FEATURE_REGISTRY_MAP.get(featureKey as FeatureKey)?.label ?? featureKey
        throw new ForbiddenError(`You have reached your ${label.toLowerCase()} limit (${limit}).`)
      }
    }
  }

  async requireAccessAndLimit(
    organizationId: string,
    accessKey: FeatureKey | string,
    limitKey: FeatureKey | string,
    countFn: () => Promise<number>
  ): Promise<void> {
    await this.requireAccess(organizationId, accessKey)
    await this.requireLimit(organizationId, limitKey, countFn)
  }

  /** @deprecated Use onCacheEvent('plan.changed', { orgId }) instead */
  async invalidateCache(organizationId: string): Promise<void> {
    await onCacheEvent('plan.changed', { orgId: organizationId })
  }

  private createUnlimitedFeatureMap(): FeatureMap {
    const map: FeatureMap = new Map()
    for (const key of Object.values(FeatureKey)) {
      map.set(key, '+')
    }
    return map
  }

  private createUnlimitedFeaturesObject(): FeatureMapObject {
    const obj: Record<string, FeatureLimit> = {}
    for (const key of Object.values(FeatureKey)) {
      obj[key] = '+'
    }
    return obj
  }
}
