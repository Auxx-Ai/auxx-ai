// apps/web/src/lib/apps/select-version.ts

/**
 * Select the appropriate version to install based on priority
 * Priority: dev version > prod version
 *
 * @param versions - Array of available versions
 * @returns Version ID and installation type, or undefined if no versions
 */
export function selectVersionToInstall(
  versions: Array<{
    id: string
    versionString: string
    versionType: 'dev' | 'prod'
    status: string
  }>
):
  | {
      versionId: string
      installationType: 'development' | 'production'
    }
  | undefined {
  // Filter active versions
  const activeVersions = versions.filter((v) => v.status === 'active')

  // Priority 1: Find latest active dev version
  const devVersion = activeVersions.find((v) => v.versionType === 'dev')
  if (devVersion) {
    return {
      versionId: devVersion.id,
      installationType: 'development',
    }
  }

  // Priority 2: Find latest active prod version
  const prodVersion = activeVersions.find((v) => v.versionType === 'prod')
  if (prodVersion) {
    return {
      versionId: prodVersion.id,
      installationType: 'production',
    }
  }

  // Fallback: Return first version if no active versions
  const firstVersion = versions[0]
  if (firstVersion) {
    return {
      versionId: firstVersion.id,
      installationType: firstVersion.versionType === 'dev' ? 'development' : 'production',
    }
  }

  return undefined
}
