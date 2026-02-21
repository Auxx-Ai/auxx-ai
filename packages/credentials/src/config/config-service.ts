// packages/credentials/src/config/config-service.ts

import { ConfigSource } from '@auxx/types/config'
import { ConfigCache } from './config-cache'
import {
  CONFIG_GROUP_META,
  CONFIG_VARIABLES,
  getAllConfigDefinitions,
  getConfigDefinition,
} from './config-registry'
import { ConfigStorage } from './config-storage'
import { convertEnvValue } from './config-value-converter'
import type {
  ConfigVariableDefinition,
  ConfigVariableGroupData,
  ResolvedConfigVariable,
} from './types'

const CACHE_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Core config service. Replaces the old `env` proxy from @auxx/config.
 *
 * Resolves values using:
 * 1. DB override (if enabled and not env-only) — from in-memory cache
 * 2. process.env[key] — read at call time (not a static snapshot)
 * 3. SST Resource (if in SST runtime) — sst.Secret resources only
 * 4. Default value from registry
 * 5. Fallback param
 *
 * Usage:
 *   import { configService } from '@auxx/credentials'
 *   const apiKey = configService.get<string>('OPENAI_API_KEY')
 *   const port = configService.get<number>('PORT', 3000)
 */
export class ConfigService {
  private cache = new ConfigCache()
  private storage = new ConfigStorage()
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private initPromise: Promise<void> | null = null
  private initialized = false

  /**
   * Whether DB overrides are enabled.
   * Always read from process.env (isEnvOnly).
   */
  get isDbEnabled(): boolean {
    const envVal = process.env.IS_CONFIG_VARIABLES_IN_DB_ENABLED
    return envVal === 'true' || envVal === '1'
  }

  /**
   * Initialize the service. Call once on server startup.
   * Warms the cache if DB overrides are enabled.
   *
   * Must be called AFTER the database connection is established,
   * since isEnvOnly vars (DATABASE_URL, REDIS_URL) are read from
   * process.env directly and are never stored in DB.
   */
  async init(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      if (this.isDbEnabled) {
        await this.refreshCache()
        this.startAutoRefresh()
      }
      this.initialized = true
    })()

    try {
      await this.initPromise
    } catch (error) {
      this.initPromise = null
      throw error
    }
  }

  /**
   * Get a config value. Synchronous — reads from in-memory cache + process.env.
   *
   * Resolution order:
   * 1. DB override (if enabled and not env-only) — from in-memory cache
   * 2. process.env[key] — read at call time (not a static snapshot)
   * 3. SST Resource (if in SST runtime) — sst.Secret resources only
   * 4. Default from registry
   * 5. Fallback param
   */
  get<T extends string | number | boolean | string[] = string>(
    key: string,
    fallback?: T
  ): T | undefined {
    const definition = getConfigDefinition(key)

    // 1. Try DB override (if enabled and not env-only)
    if (this.isDbEnabled && definition && !definition.isEnvOnly) {
      const cached = this.cache.get(key)
      if (cached.found && cached.value !== undefined) {
        return cached.value as T
      }
    }

    // 2. Try process.env at call time
    const envRaw = process.env[key]
    if (envRaw !== undefined && envRaw !== '') {
      if (definition) {
        const converted = convertEnvValue(envRaw, definition.type)
        if (converted !== undefined) return converted as T
      }
      return envRaw as T
    }

    // 3. Try SST Resource (if in SST runtime)
    if (this.isSstRuntime) {
      const resourceValue = this.getSstResourceValue(key)
      if (resourceValue !== undefined) {
        if (definition) {
          const converted = convertEnvValue(resourceValue, definition.type)
          if (converted !== undefined) return converted as T
        }
        return resourceValue as T
      }
    }

    // 4. Try default from registry
    if (definition?.defaultValue !== undefined) {
      return definition.defaultValue as T
    }

    // 5. Fallback param
    return fallback
  }

  /**
   * Set a DB override for a config variable.
   * Validates against the registry definition.
   * Cache updates immediately — takes effect on next get() call.
   */
  async set(key: string, value: unknown, userId?: string): Promise<void> {
    const definition = getConfigDefinition(key)

    if (!definition) {
      throw new Error(`Unknown config variable: ${key}`)
    }
    if (definition.isEnvOnly) {
      throw new Error(
        `Config variable '${key}' is environment-only and cannot be overridden via DB`
      )
    }
    if (!this.isDbEnabled) {
      throw new Error('DB config overrides are not enabled (IS_CONFIG_VARIABLES_IN_DB_ENABLED)')
    }

    this.validate(definition, value)
    await this.storage.setSystem(key, value, userId)

    // Update cache immediately — no wait for next refresh cycle
    this.cache.set(key, value)
  }

  /**
   * Delete a DB override (revert to env/default).
   */
  async delete(key: string): Promise<void> {
    const definition = getConfigDefinition(key)
    if (!definition) {
      throw new Error(`Unknown config variable: ${key}`)
    }
    if (!this.isDbEnabled) {
      throw new Error('DB config overrides are not enabled')
    }

    await this.storage.deleteSystem(key)
    this.cache.markMissing(key)
  }

  /**
   * Get all config variables with resolved values, grouped for the admin UI.
   */
  async getGrouped(): Promise<ConfigVariableGroupData[]> {
    if (this.isDbEnabled && !this.cache.warmed) {
      await this.refreshCache()
    }

    const groups = new Map<string, ResolvedConfigVariable[]>()

    for (const definition of getAllConfigDefinitions()) {
      const resolved = this.resolve(definition)
      if (!groups.has(definition.group)) {
        groups.set(definition.group, [])
      }
      groups.get(definition.group)!.push(resolved)
    }

    return Array.from(groups.entries()).map(([group, variables]) => ({
      group: group as any,
      label: CONFIG_GROUP_META[group]?.label ?? group,
      description: CONFIG_GROUP_META[group]?.description ?? '',
      iconId: CONFIG_GROUP_META[group]?.iconId ?? 'settings',
      variables,
    }))
  }

  /** Get a single resolved variable (for detail view). */
  getResolved(key: string): ResolvedConfigVariable | null {
    const definition = getConfigDefinition(key)
    if (!definition) return null
    return this.resolve(definition)
  }

  /**
   * Resolve a single variable to its current value + source.
   * Sensitive values are masked for the admin UI.
   */
  private resolve(definition: ConfigVariableDefinition): ResolvedConfigVariable {
    let value: unknown = null
    let source: (typeof ConfigSource)[keyof typeof ConfigSource] = ConfigSource.DEFAULT
    let hasDbOverride = false

    // 1. Check DB override
    if (this.isDbEnabled && !definition.isEnvOnly) {
      const cached = this.cache.get(definition.key)
      if (cached.found && cached.value !== undefined) {
        value = definition.isSensitive ? '••••••••' : cached.value
        source = ConfigSource.DATABASE
        hasDbOverride = true
      }
    }

    // 2. Check process.env (if no DB override)
    if (!hasDbOverride) {
      const envRaw = process.env[definition.key]
      if (envRaw !== undefined && envRaw !== '') {
        const converted = convertEnvValue(envRaw, definition.type)
        value = definition.isSensitive ? '••••••••' : (converted ?? envRaw)
        source = ConfigSource.ENVIRONMENT
      }
    }

    // 2.5 Check SST Resource (if no DB or env value)
    if (value === null && this.isSstRuntime) {
      const resourceValue = this.getSstResourceValue(definition.key)
      if (resourceValue !== undefined) {
        const converted = convertEnvValue(resourceValue, definition.type)
        value = definition.isSensitive ? '••••••••' : (converted ?? resourceValue)
        source = ConfigSource.SST_RESOURCE
      }
    }

    // 3. Fall back to default
    if (value === null && definition.defaultValue !== undefined) {
      value = definition.defaultValue
      source = ConfigSource.DEFAULT
    }

    return { definition, value: value as any, source, hasDbOverride }
  }

  /** Guard: only true in deployed Lambda or `sst dev`, never during Next.js build */
  private get isSstRuntime(): boolean {
    return process.env.SST === '1' && process.env.NEXT_PHASE !== 'phase-production-build'
  }

  /** Only sst.Secret resources have .value — buckets have .name, RDS has .host etc. */
  private getSstResourceValue(key: string): string | undefined {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Resource } = require('sst')
      const res = (Resource as any)[key]
      return typeof res?.value === 'string' ? res.value : undefined
    } catch {
      return undefined
    }
  }

  /** Validate a value against its definition. */
  private validate(definition: ConfigVariableDefinition, value: unknown): void {
    switch (definition.type) {
      case 'NUMBER': {
        const num = Number(value)
        if (Number.isNaN(num)) throw new Error(`'${definition.key}' must be a number`)
        if (definition.min !== undefined && num < definition.min)
          throw new Error(`'${definition.key}' must be >= ${definition.min}`)
        if (definition.max !== undefined && num > definition.max)
          throw new Error(`'${definition.key}' must be <= ${definition.max}`)
        break
      }
      case 'BOOLEAN':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false')
          throw new Error(`'${definition.key}' must be a boolean`)
        break
      case 'ENUM':
        if (definition.options && !definition.options.includes(String(value)))
          throw new Error(`'${definition.key}' must be one of: ${definition.options.join(', ')}`)
        break
      case 'ARRAY':
        if (!Array.isArray(value)) throw new Error(`'${definition.key}' must be an array`)
        break
      case 'STRING':
        if (definition.pattern && !new RegExp(definition.pattern).test(String(value)))
          throw new Error(`'${definition.key}' does not match required pattern`)
        break
    }
  }

  /** Refresh the cache from DB. */
  private async refreshCache(): Promise<void> {
    try {
      const allOverrides = await this.storage.getAllSystem()
      const allKnownKeys = Object.keys(CONFIG_VARIABLES)
      this.cache.warmUp(
        allOverrides.map((o) => ({ key: o.key, value: o.value })),
        allKnownKeys
      )
    } catch (error) {
      console.error('[ConfigService] Failed to refresh cache from DB:', error)
    }
  }

  /** Start periodic cache refresh. */
  private startAutoRefresh(): void {
    if (this.refreshTimer) return
    this.refreshTimer = setInterval(() => {
      void this.refreshCache()
    }, CACHE_REFRESH_INTERVAL_MS)

    // Don't keep Node.js alive solely for this interval.
    if (
      this.refreshTimer &&
      typeof this.refreshTimer === 'object' &&
      'unref' in this.refreshTimer &&
      typeof this.refreshTimer.unref === 'function'
    ) {
      this.refreshTimer.unref()
    }
  }

  /** Stop the service (for graceful shutdown). */
  destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    this.initialized = false
    this.initPromise = null
    this.cache.clear()
  }
}
