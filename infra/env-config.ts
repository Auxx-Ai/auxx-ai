// infra/env-config.ts
import { domain, getAppDomain, getHomepageDomain, subdomain } from './dns'

export type AppType = 'web' | 'homepage' | 'docs' | 'worker' | 'api'

/** Port mapping for development */
const DEV_PORTS: Record<AppType, number> = {
  web: 3000,
  homepage: 3001,
  docs: 3004,
  worker: 3003,
  api: 3002,
}

/**
 * Helper to get app URL based on stage
 */
export const getAppUrl = (app: AppType = 'web') => {
  if ($dev) return `http://localhost:${DEV_PORTS[app]}`

  switch (app) {
    case 'web':
      return `https://${getAppDomain()}`
    case 'homepage':
      return `https://${getHomepageDomain()}`
    case 'docs':
      return `https://${subdomain('docs')}`
    case 'worker':
      return `https://${subdomain('worker')}`
    case 'api':
      return `https://${subdomain('api')}`
    default:
      return `https://${domain}`
  }
}
