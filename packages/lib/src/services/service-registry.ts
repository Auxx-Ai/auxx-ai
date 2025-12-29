// packages/lib/src/services/service-registry.ts

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('service-registry')

/**
 * Service Lifecycle Types
 */
export enum ServiceLifetime {
  /** New instance every time */
  TRANSIENT = 'transient',
  /** One instance per scope/request */
  SCOPED = 'scoped',
  /** Single instance across entire application */
  SINGLETON = 'singleton',
}

/**
 * Service Factory Function Type
 */
export type ServiceFactory<T = any> = (registry: ServiceRegistry) => T | Promise<T>

/**
 * Service Registration Definition
 */
export interface ServiceRegistration<T = any> {
  factory: ServiceFactory<T>
  lifetime: ServiceLifetime
  instance?: T
  dependencies?: string[]
}

/**
 * Service Registry for centralized service management
 *
 * Features:
 * - Dependency injection with automatic resolution
 * - Service lifecycle management (singleton, scoped, transient)
 * - Circular dependency detection
 * - Service disposal and cleanup
 * - Type-safe service retrieval
 */
export class ServiceRegistry {
  private services = new Map<string, ServiceRegistration>()
  private scopedInstances = new Map<string, any>()
  private resolutionStack: string[] = []

  constructor(private scope?: string) {}

  /**
   * Register a service with the registry
   */
  register<T>(
    key: string,
    factory: ServiceFactory<T>,
    lifetime: ServiceLifetime = ServiceLifetime.TRANSIENT,
    dependencies?: string[]
  ): void {
    logger.debug('Registering service', {
      key,
      lifetime,
      dependencies,
      scope: this.scope,
    })

    this.services.set(key, {
      factory,
      lifetime,
      dependencies: dependencies || [],
    })
  }

  /**
   * Register a singleton service
   */
  registerSingleton<T>(key: string, factory: ServiceFactory<T>, dependencies?: string[]): void {
    this.register(key, factory, ServiceLifetime.SINGLETON, dependencies)
  }

  /**
   * Register a scoped service
   */
  registerScoped<T>(key: string, factory: ServiceFactory<T>, dependencies?: string[]): void {
    this.register(key, factory, ServiceLifetime.SCOPED, dependencies)
  }

  /**
   * Register a transient service
   */
  registerTransient<T>(key: string, factory: ServiceFactory<T>, dependencies?: string[]): void {
    this.register(key, factory, ServiceLifetime.TRANSIENT, dependencies)
  }

  /**
   * Get a service instance
   */
  async get<T>(key: string): Promise<T> {
    // Check for circular dependencies
    if (this.resolutionStack.includes(key)) {
      throw new Error(
        `Circular dependency detected: ${this.resolutionStack.join(' -> ')} -> ${key}`
      )
    }

    const registration = this.services.get(key)
    if (!registration) {
      throw new Error(`Service '${key}' is not registered`)
    }

    return await this.resolveService<T>(key, registration)
  }

  /**
   * Get a service instance synchronously (only works for already resolved services)
   */
  getSync<T>(key: string): T {
    const registration = this.services.get(key)
    if (!registration) {
      throw new Error(`Service '${key}' is not registered`)
    }

    // For singleton services, return cached instance
    if (registration.lifetime === ServiceLifetime.SINGLETON && registration.instance) {
      return registration.instance
    }

    // For scoped services, return cached instance
    if (registration.lifetime === ServiceLifetime.SCOPED && this.scopedInstances.has(key)) {
      return this.scopedInstances.get(key)
    }

    throw new Error(`Service '${key}' must be resolved asynchronously first`)
  }

  /**
   * Check if a service is registered
   */
  isRegistered(key: string): boolean {
    return this.services.has(key)
  }

  /**
   * Create a new scoped registry
   */
  createScope(scopeId: string): ServiceRegistry {
    const scopedRegistry = new ServiceRegistry(scopeId)

    // Copy service registrations to scoped registry
    for (const [key, registration] of this.services) {
      scopedRegistry.services.set(key, {
        ...registration,
        instance:
          registration.lifetime === ServiceLifetime.SINGLETON ? registration.instance : undefined,
      })
    }

    return scopedRegistry
  }

  /**
   * Get all registered service keys
   */
  getRegisteredServices(): string[] {
    return Array.from(this.services.keys())
  }

  /**
   * Clear all scoped instances (for cleanup)
   */
  dispose(): void {
    logger.debug('Disposing service registry', {
      scope: this.scope,
      scopedInstances: this.scopedInstances.size,
    })

    // Call dispose method on services that have it
    for (const [key, instance] of this.scopedInstances) {
      if (instance && typeof instance.dispose === 'function') {
        try {
          instance.dispose()
          logger.debug('Disposed service', { key })
        } catch (error) {
          logger.error('Error disposing service', {
            key,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }

    this.scopedInstances.clear()
  }

  /**
   * Resolve a service instance based on its lifetime
   */
  private async resolveService<T>(key: string, registration: ServiceRegistration): Promise<T> {
    this.resolutionStack.push(key)

    try {
      // Singleton: create once, reuse forever
      if (registration.lifetime === ServiceLifetime.SINGLETON) {
        if (!registration.instance) {
          logger.debug('Creating singleton service', { key })
          registration.instance = await registration.factory(this)
        }
        return registration.instance
      }

      // Scoped: create once per scope, reuse within scope
      if (registration.lifetime === ServiceLifetime.SCOPED) {
        if (!this.scopedInstances.has(key)) {
          logger.debug('Creating scoped service', { key, scope: this.scope })
          const instance = await registration.factory(this)
          this.scopedInstances.set(key, instance)
        }
        return this.scopedInstances.get(key)
      }

      // Transient: create new instance every time
      logger.debug('Creating transient service', { key })
      return await registration.factory(this)
    } finally {
      this.resolutionStack.pop()
    }
  }
}

/**
 * Global service registry instance
 */
export const globalServiceRegistry = new ServiceRegistry('global')

/**
 * Helper function to create organization-scoped service registry
 */
export function createOrganizationServiceRegistry(organizationId: string): ServiceRegistry {
  return globalServiceRegistry.createScope(`org-${organizationId}`)
}
