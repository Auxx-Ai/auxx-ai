// infra/homepage.ts

import { getHomepageDomain } from './dns'
import { router, vpc } from './router-vpc'
import { getSecretsForLinking, getSelectedEnvVars } from './secrets'

export const homepage = new sst.aws.Nextjs('AuxxAiHomepage', {
  vpc,
  path: 'apps/homepage',
  buildCommand: 'pnpm run build:opennext',
  environment: getSelectedEnvVars('homepage'),
  link: getSecretsForLinking('homepage'),
  openNextVersion: '3.9.15',
  dev: {
    autostart: false,
    command: 'pnpm --filter homepage dev',
  },
  router: {
    instance: router,
    domain: getHomepageDomain(),
    path: '/',
  },
  server: {
    runtime: 'nodejs22.x',
  },
})
