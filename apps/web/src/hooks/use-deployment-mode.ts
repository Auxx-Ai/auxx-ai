// apps/web/src/hooks/use-deployment-mode.ts
import type { DeploymentMode } from '@auxx/deployment/client'
import { useEnv } from '~/providers/dehydrated-state-provider'

/** Hook to check deployment mode from dehydrated state */
export function useDeploymentMode(): DeploymentMode {
  const env = useEnv()
  return env.deploymentMode ?? 'cloud'
}

/** Hook that returns true when running in self-hosted mode */
export function useIsSelfHosted(): boolean {
  return useDeploymentMode() === 'self-hosted'
}

/** Hook that returns true when running as cloud SaaS */
export function useIsCloud(): boolean {
  return useDeploymentMode() === 'cloud'
}
