// packages/deployment/src/index.ts

/** Deployment mode for the application */
export type DeploymentMode = 'cloud' | 'self-hosted'

/**
 * Get the current deployment mode from the server environment.
 * Defaults to 'cloud' if not set — existing SaaS behavior is unchanged.
 */
export function getDeploymentMode(): DeploymentMode {
  const mode = process.env.DEPLOYMENT_MODE
  return mode === 'self-hosted' ? 'self-hosted' : 'cloud'
}

/** True when running as hosted SaaS (default) */
export function isCloud(): boolean {
  return getDeploymentMode() === 'cloud'
}

/** True when self-hosted by the user */
export function isSelfHosted(): boolean {
  return getDeploymentMode() === 'self-hosted'
}
