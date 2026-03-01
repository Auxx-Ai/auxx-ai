// apps/web/src/lib/apps/select-deployment.ts

/**
 * Select the appropriate deployment to install based on priority
 * Priority: development deployment > production deployment
 *
 * @param deployments - Array of available deployments
 * @returns Deployment ID and installation type, or undefined if no deployments
 */
export function selectDeploymentToInstall(
  deployments: Array<{
    id: string
    version: string | null
    deploymentType: 'development' | 'production'
    status: string
  }>
):
  | {
      deploymentId: string
      installationType: 'development' | 'production'
    }
  | undefined {
  // Priority 1: Find active dev deployment
  const devDeployment = deployments.find(
    (d) => d.deploymentType === 'development' && d.status === 'active'
  )
  if (devDeployment) {
    return {
      deploymentId: devDeployment.id,
      installationType: 'development',
    }
  }

  // Priority 2: Find published prod deployment
  const prodDeployment = deployments.find(
    (d) => d.deploymentType === 'production' && d.status === 'published'
  )
  if (prodDeployment) {
    return {
      deploymentId: prodDeployment.id,
      installationType: 'production',
    }
  }

  // Fallback: Return first deployment
  const first = deployments[0]
  if (first) {
    return {
      deploymentId: first.id,
      installationType: first.deploymentType,
    }
  }

  return undefined
}
