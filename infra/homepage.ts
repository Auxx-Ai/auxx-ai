// infra/homepage.ts

import { getHomepageDomain } from './dns'
import { router, vpc } from './router-vpc'
import { getSecretsForLinking, getSelectedEnvVars } from './secrets'

export const homepage = new sst.aws.Nextjs('AuxxAiHomepage', {
  vpc,
  path: 'apps/homepage',
  buildCommand:
    'if [ "${SST_USE_PREBUILT_OPENNEXT:-0}" = "1" ] && [ -d ".open-next" ]; then echo "Using pre-built OpenNext artifacts"; else pnpm run build:opennext; fi',
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
