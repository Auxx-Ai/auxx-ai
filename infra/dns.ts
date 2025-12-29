// infra/dns.ts
/// <reference path="../.sst/platform/config.d.ts" />

export const appify = (val: string) => `auxx-${$app.stage}-${val}`

export const isPermanentStage = ['production', 'dev'].includes($app.stage)

export const domain =
  $app.stage === 'production'
    ? 'auxx.ai'
    : $app.stage === 'dev'
      ? 'dev.auxx.ai'
      : `${$app.stage}.dev.auxx.ai`

export const emailDomain = 'auxx.ai'

export function subdomain(name: string) {
  if (isPermanentStage) return `${name}.${domain}`
  return `${name}-${domain}`
}

export function getHomepageDomain() {
  return domain
}

export function getAppDomain() {
  return subdomain('app')
}
// export const webDNS = `${environment}${domain}`
// export const apiDNS = `api.${environment}${domain}`
