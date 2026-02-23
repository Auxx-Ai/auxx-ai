// infra/worker.ts

import { rds, redis } from './db'
import { cluster } from './router-vpc'
import { getSecretsForLinking, getSelectedEnvVars } from './secrets'
import { privateBucket, publicBucket } from './storage'

/**
 * Worker service - only created in non-dev mode
 * Container runtime not available in sst dev, run manually: pnpm -F @auxx/worker dev
 */
export const worker = $dev
  ? undefined
  : new sst.aws.Service('AuxxAiWorker', {
      cluster,
      image: { context: '.', dockerfile: 'apps/worker/Dockerfile' },
      transform: {
        image: (args) => {
          // Keep cache reads if available, but disable cache export to avoid CI EOF/provider crashes.
          args.cacheTo = []
        },
      },
      cpu: '0.25 vCPU',
      memory: '0.5 GB',
      environment: getSelectedEnvVars('worker'),
      link: [...getSecretsForLinking('worker'), rds, redis, publicBucket, privateBucket],
    })
