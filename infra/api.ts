// infra/api.ts

import { rds, redis } from './db'
import { subdomain } from './dns'
import { serverFunctionExecutorUrl } from './lambda'
import { cluster, router } from './router-vpc'
import { getSecretsForLinking, getSelectedEnvVars } from './secrets'
import { privateBucket, publicBucket } from './storage'

/**
 * API service - only created in non-dev mode.
 * Container runtime not available in sst dev, run manually: pnpm -F @auxx/api dev
 */
export const api = $dev
  ? undefined
  : new sst.aws.Service('AuxxAiApi', {
      cluster,
      image: { context: '.', dockerfile: 'apps/api/Dockerfile' },
      transform: {
        image: (args) => {
          args.cacheTo = []
        },
      },
      cpu: '0.25 vCPU',
      memory: '0.5 GB',
      environment: getSelectedEnvVars('api', {
        lambdaUrl: serverFunctionExecutorUrl,
      }),
      link: [...getSecretsForLinking('api'), rds, redis, publicBucket, privateBucket],
      loadBalancer: {
        rules: [{ listen: '80/http', forward: '3007/http' }],
        health: {
          '3007/http': {
            path: '/health',
            successCodes: '200',
          },
        },
      },
    })

if (api) {
  router.route(subdomain('api'), api.url)
}
