// packages/lib/src/services/service-registrations.ts

import { database as db } from '@auxx/database'
import type { Database } from '@auxx/database'
import { ServiceRegistry } from './service-registry'
import { ProviderRegistryService } from '../providers/provider-registry-service'
import { MessageSenderService } from '../messages/message-sender.service'
import { WebhookManagerService } from '../providers/webhook-manager-service'
import { MessageSyncService } from '../messages/message-sync-service'
import { UniversalTagService } from '../tags/universal-tag-service'
import { TagService } from '../tags/tag-service'
import { ThreadQueryService } from '../threads/thread-query.service'
import { ThreadMutationService } from '../threads/thread-mutation.service'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('service-registrations')

/**
 * Service Keys for type-safe service retrieval
 */
export const ServiceKeys = {
  // Database
  DATABASE: 'database',

  // Provider Services
  PROVIDER_REGISTRY: 'provider-registry',
  MESSAGE_SENDER: 'message-sender',
  WEBHOOK_MANAGER: 'webhook-manager',
  MESSAGE_SYNC: 'message-sync',

  // Tag Services
  UNIVERSAL_TAG_SERVICE: 'universal-tag-service',
  TAG_SERVICE: 'tag-service',

  // Thread Services
  THREAD_QUERY_SERVICE: 'thread-query-service',
  THREAD_MUTATION_SERVICE: 'thread-mutation-service',

  // Action Services
  ACTION_EXECUTOR: 'action-executor',
  PROPOSED_ACTION_EXECUTOR: 'proposed-action-executor',

  // Organization Context
  ORGANIZATION_ID: 'organization-id',
  USER_ID: 'user-id',
} as const

export type ServiceKey = (typeof ServiceKeys)[keyof typeof ServiceKeys]

/**
 * Register all core services with the service registry
 */
function registerCoreServices(
  registry: ServiceRegistry,
  organizationId: string,
  userId?: string
): void {
  logger.info('Registering core services', { organizationId, userId })

  // Register organization context as singleton values
  registry.registerSingleton(ServiceKeys.ORGANIZATION_ID, () => organizationId)

  if (userId) {
    registry.registerSingleton(ServiceKeys.USER_ID, () => userId)
  }

  // Register database as singleton
  registry.registerSingleton(ServiceKeys.DATABASE, () => db)

  // Register provider services as singletons (shared across organization)
  registry.registerSingleton(
    ServiceKeys.PROVIDER_REGISTRY,
    async (reg) => {
      const orgId = await reg.get<string>(ServiceKeys.ORGANIZATION_ID)
      return new ProviderRegistryService(orgId)
    },
    [ServiceKeys.ORGANIZATION_ID]
  )

  registry.registerSingleton(
    ServiceKeys.MESSAGE_SENDER,
    async (reg) => {
      const database = await reg.get<Database>(ServiceKeys.DATABASE)
      const orgId = await reg.get<string>(ServiceKeys.ORGANIZATION_ID)
      const providerRegistry = await reg.get<ProviderRegistryService>(ServiceKeys.PROVIDER_REGISTRY)
      return new MessageSenderService(orgId, providerRegistry, database)
    },
    [ServiceKeys.DATABASE, ServiceKeys.ORGANIZATION_ID, ServiceKeys.PROVIDER_REGISTRY]
  )

  registry.registerSingleton(
    ServiceKeys.WEBHOOK_MANAGER,
    async (reg) => {
      const orgId = await reg.get<string>(ServiceKeys.ORGANIZATION_ID)
      const providerRegistry = await reg.get<ProviderRegistryService>(ServiceKeys.PROVIDER_REGISTRY)
      return new WebhookManagerService(orgId, providerRegistry)
    },
    [ServiceKeys.ORGANIZATION_ID, ServiceKeys.PROVIDER_REGISTRY]
  )

  registry.registerSingleton(
    ServiceKeys.MESSAGE_SYNC,
    async (reg) => {
      const orgId = await reg.get<string>(ServiceKeys.ORGANIZATION_ID)
      const providerRegistry = await reg.get<ProviderRegistryService>(ServiceKeys.PROVIDER_REGISTRY)
      return new MessageSyncService(orgId, providerRegistry)
    },
    [ServiceKeys.ORGANIZATION_ID, ServiceKeys.PROVIDER_REGISTRY]
  )

  // Register tag services as singletons
  registry.registerSingleton(
    ServiceKeys.UNIVERSAL_TAG_SERVICE,
    async (reg) => {
      const database = await reg.get<Database>(ServiceKeys.DATABASE)
      const orgId = await reg.get<string>(ServiceKeys.ORGANIZATION_ID)
      return new UniversalTagService(database, orgId)
    },
    [ServiceKeys.DATABASE, ServiceKeys.ORGANIZATION_ID]
  )

  registry.registerSingleton(
    ServiceKeys.TAG_SERVICE,
    async (reg) => {
      const database = await reg.get<Database>(ServiceKeys.DATABASE)
      const orgId = await reg.get<string>(ServiceKeys.ORGANIZATION_ID)
      const uId = userId || 'system'
      return new TagService(orgId, uId, database)
    },
    [ServiceKeys.DATABASE, ServiceKeys.ORGANIZATION_ID]
  )

  // Register new modular thread services as singletons
  registry.registerSingleton(
    ServiceKeys.THREAD_QUERY_SERVICE,
    async (reg) => {
      const database = await reg.get<Database>(ServiceKeys.DATABASE)
      const orgId = await reg.get<string>(ServiceKeys.ORGANIZATION_ID)
      return new ThreadQueryService(orgId, database)
    },
    [ServiceKeys.DATABASE, ServiceKeys.ORGANIZATION_ID]
  )

  registry.registerSingleton(
    ServiceKeys.THREAD_MUTATION_SERVICE,
    async (reg) => {
      const database = await reg.get<Database>(ServiceKeys.DATABASE)
      const orgId = await reg.get<string>(ServiceKeys.ORGANIZATION_ID)
      return new ThreadMutationService(orgId, database)
    },
    [ServiceKeys.DATABASE, ServiceKeys.ORGANIZATION_ID]
  )

  logger.info('Core services registered successfully', {
    serviceCount: registry.getRegisteredServices().length,
    organizationId,
  })
}

/**
 * Register action-specific services
 */
function registerActionServices(registry: ServiceRegistry): void {
  logger.info('Registering action services')

  // Action Executor will be registered as scoped to allow different configurations
  registry.registerScoped(
    ServiceKeys.ACTION_EXECUTOR,
    async (reg) => {
      const { createActionExecutor } = await import('../actions/core/action-executor')
      return await createActionExecutor(reg)
    },
    [ServiceKeys.ORGANIZATION_ID, ServiceKeys.PROVIDER_REGISTRY]
  )

  // Proposed Action Executor - handles execution of database-stored proposed actions
  registry.registerScoped(
    ServiceKeys.PROPOSED_ACTION_EXECUTOR,
    async (reg) => {
      const { createProposedActionExecutionService } = await import(
        '../actions/services/proposed-action-execution-service'
      )
      return await createProposedActionExecutionService(reg)
    },
    [ServiceKeys.ACTION_EXECUTOR, ServiceKeys.DATABASE, ServiceKeys.ORGANIZATION_ID]
  )
}

/**
 * Initialize a complete service registry for an organization
 */
export async function createOrganizationServices(
  organizationId: string,
  userId?: string
): Promise<ServiceRegistry> {
  const registry = new ServiceRegistry(`org-${organizationId}`)

  // Register all services
  registerCoreServices(registry, organizationId, userId)
  registerActionServices(registry)

  logger.info('Organization service registry created', {
    organizationId,
    userId,
    registeredServices: registry.getRegisteredServices(),
  })

  return registry
}

/**
 * Helper type for service resolution
 */
type ServiceMap = {
  [ServiceKeys.DATABASE]: typeof db
  [ServiceKeys.ORGANIZATION_ID]: string
  [ServiceKeys.USER_ID]: string
  [ServiceKeys.PROVIDER_REGISTRY]: ProviderRegistryService
  [ServiceKeys.MESSAGE_SENDER]: MessageSenderService
  [ServiceKeys.WEBHOOK_MANAGER]: WebhookManagerService
  [ServiceKeys.MESSAGE_SYNC]: MessageSyncService
  [ServiceKeys.UNIVERSAL_TAG_SERVICE]: UniversalTagService
  [ServiceKeys.TAG_SERVICE]: TagService
  [ServiceKeys.THREAD_QUERY_SERVICE]: ThreadQueryService
  [ServiceKeys.THREAD_MUTATION_SERVICE]: ThreadMutationService
}

/**
 * Type-safe service getter
 */
export async function getService<K extends keyof ServiceMap>(
  registry: ServiceRegistry,
  key: K
): Promise<ServiceMap[K]> {
  return registry.get(key)
}
