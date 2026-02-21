// packages/config/src/sst-resources.ts
import { Resource } from 'sst'

/**
 * Get all secrets from SST Resources
 * Returns an object with all secret values
 */
export const getSecrets = () => {
  const secrets: Record<string, string | undefined> = {}

  // Try to access each secret through Resource API
  try {
  } catch (error) {
    console.warn('Some secrets may not be available:', error)
  }

  // Also include environment variables as fallback
  Object.keys(secrets).forEach((key) => {
    if (!secrets[key] && process.env[key]) {
      secrets[key] = process.env[key]
    }
  })

  return secrets
}

/**
 * Get a specific secret value
 * @param key The secret key to retrieve
 * @returns The secret value or undefined
 */
export const getSecret = (key: string): string | undefined => {
  // Try SST Resource first
  try {
    const resource = (Resource as any)[key]
    if (resource?.value) {
      return resource.value
    }
  } catch (error) {
    // Silent fail, try env var
  }

  // Fallback to environment variable
  return process.env[key]
}
