// infra/env-config.ts
import { domain, getAppDomain, getHomepageDomain, subdomain } from './dns'

export type AppType = 'web' | 'homepage' | 'kb' | 'docs' | 'worker' | 'build' | 'api' | 'lambda'

/** Port mapping for development — must match APP_REGISTRY in packages/config/src/url.ts */
const DEV_PORTS: Record<AppType, number> = {
  web: 3000,
  homepage: 3001,
  kb: 3002,
  docs: 3004,
  worker: 3005,
  build: 3006,
  api: 3007,
  lambda: 3008,
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
    case 'kb':
      return `https://${subdomain('kb')}`
    case 'worker':
      return `https://${subdomain('worker')}`
    case 'build':
      return `https://${subdomain('build')}`
    case 'api':
      return `https://${subdomain('api')}`
    case 'lambda':
      return `https://${subdomain('lambda')}`
    default:
      return `https://${domain}`
  }
}
