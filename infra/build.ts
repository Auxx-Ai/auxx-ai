// infra/build.ts

import { rds, redis } from './db'
import { subdomain } from './dns'
import { cluster, router } from './router-vpc'
import { getSecretsForLinking, getSelectedEnvVars } from './secrets'

/**
 * Build (Developer Portal) service - only created in non-dev mode.
 * Container runtime not available in sst dev, run manually: pnpm -F @auxx/build dev
 */
export const build = $dev
  ? undefined
  : new sst.aws.Service('AuxxAiBuild', {
      cluster,
      image: { context: '.', dockerfile: 'apps/build/Dockerfile' },
      transform: {
        image: (args) => {
          // Keep cache reads if available, but disable cache export to avoid CI EOF/provider crashes.
          args.cacheTo = []
        },
      },
      cpu: '0.25 vCPU',
      memory: '0.5 GB',
      environment: getSelectedEnvVars('build'),
      link: [...getSecretsForLinking('build'), rds, redis],
      loadBalancer: {
        rules: [{ listen: '80/http', forward: '3006/http' }],
        health: {
          '3006/http': {
            path: '/health',
            successCodes: '200',
          },
        },
      },
    })

if (build) {
  router.route(subdomain('build'), build.url)
}
