// infra/deploy-profile.ts

/**
 * DeployProfile describes the high-level SST deployment modes supported by this repo.
 */
export type DeployProfile = 'full' | 'platform'

/**
 * RuntimeServiceName lists the app runtimes that can be owned either by SST or Railway.
 */
export type RuntimeServiceName = 'api' | 'build' | 'worker' | 'web' | 'docs' | 'homepage'

/**
 * deployProfileAliases maps legacy or descriptive profile names to the normalized deploy mode.
 */
const deployProfileAliases: Record<string, DeployProfile> = {
  full: 'full',
  platform: 'platform',
  'railway-hybrid': 'platform',
  'aws-only': 'platform',
}

/**
 * currentDeployProfile is the normalized profile for the active SST deploy.
 */
const currentDeployProfile = normalizeDeployProfile(process.env.DEPLOY_PROFILE)

/**
 * containerRuntimeServices identifies services that require the ECS cluster when deployed by SST.
 */
const containerRuntimeServices: RuntimeServiceName[] = ['api', 'build', 'worker']

/**
 * routedRuntimeServices identifies services that require the SST router when deployed by SST.
 */
const routedRuntimeServices: RuntimeServiceName[] = ['api', 'build', 'web', 'docs', 'homepage']

/**
 * normalizeDeployProfile converts env input into a supported deploy profile.
 */
function normalizeDeployProfile(value?: string): DeployProfile {
  const normalizedValue = value?.trim().toLowerCase() || 'full'
  return deployProfileAliases[normalizedValue] || 'full'
}

/**
 * getRuntimeServiceOverrideKey returns the env-var name for a service-specific SST deploy override.
 */
function getRuntimeServiceOverrideKey(service: RuntimeServiceName): string {
  return `DEPLOY_SST_${service.toUpperCase()}`
}

/**
 * parseBooleanOverride converts an env-var override to a boolean when explicitly set.
 */
function parseBooleanOverride(value?: string): boolean | undefined {
  if (value === undefined) return undefined

  const normalizedValue = value.trim().toLowerCase()
  if (normalizedValue === 'true') return true
  if (normalizedValue === 'false') return false
  return undefined
}

/**
 * getDeployProfile returns the normalized deploy profile selected for this SST run.
 */
export function getDeployProfile(): DeployProfile {
  return currentDeployProfile
}

/**
 * shouldDeployRuntimeService determines whether SST should own a given app runtime.
 */
export function shouldDeployRuntimeService(service: RuntimeServiceName): boolean {
  const explicitOverride = parseBooleanOverride(process.env[getRuntimeServiceOverrideKey(service)])
  if (explicitOverride !== undefined) return explicitOverride

  if (service === 'worker' && process.env.WORKER_RUNTIME === 'railway') {
    return false
  }

  return currentDeployProfile === 'full'
}

/**
 * shouldDeployClusterResources determines whether the ECS cluster should remain in the SST stack.
 */
export function shouldDeployClusterResources(): boolean {
  return containerRuntimeServices.some((service) => shouldDeployRuntimeService(service))
}

/**
 * shouldDeployRouterResources determines whether the SST router should remain in the stack.
 */
export function shouldDeployRouterResources(): boolean {
  return routedRuntimeServices.some((service) => shouldDeployRuntimeService(service))
}

/**
 * shouldDeployDatabaseResources determines whether SST should provision RDS and Redis.
 * In platform mode, these are managed externally (e.g. Railway).
 */
export function shouldDeployDatabaseResources(): boolean {
  return currentDeployProfile === 'full'
}

/**
 * shouldDeployMigrationResources determines whether SST should provision the migration lambda.
 * In platform mode, migrations are run externally.
 */
export function shouldDeployMigrationResources(): boolean {
  return currentDeployProfile === 'full'
}

/**
 * shouldDeployEmailInfrastructure ensures stage-global outbound email resources are managed by one stage only.
 */
export function shouldDeployEmailInfrastructure(stage: string): boolean {
  const ownerStage = (process.env.EMAIL_INFRA_OWNER_STAGE || 'dev').trim()
  return stage === ownerStage
}

/**
 * shouldDeployInboundEmailInfrastructure ensures stage-global inbound email resources are managed by one stage only.
 */
export function shouldDeployInboundEmailInfrastructure(stage: string): boolean {
  const ownerStage = (
    process.env.INBOUND_EMAIL_INFRA_OWNER_STAGE ||
    process.env.EMAIL_INFRA_OWNER_STAGE ||
    'dev'
  ).trim()
  return stage === ownerStage
}
