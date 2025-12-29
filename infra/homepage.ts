// infra/homepage.ts
import { router, vpc } from './router-vpc'
import { getHomepageDomain } from './dns'
import { getHomepageSecretsForLinking, getSelectedEnvVars } from './secrets'

export const homepage = new sst.aws.Nextjs('AuxxAiHomepage', {
  vpc,
  path: 'apps/homepage',
  environment: getSelectedEnvVars('homepage'),
  link: getHomepageSecretsForLinking(),
  openNextVersion: '3.7.6',
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
