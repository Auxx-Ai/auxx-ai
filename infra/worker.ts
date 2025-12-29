// infra/worker.ts
import { cluster, vpc } from './router-vpc'
import { getAllSecretsForLinking, getSelectedEnvVars } from './secrets'
import { rds, redis } from './db'
import { publicBucket, privateBucket } from './storage'

/**
 * Worker service - only created in non-dev mode
 * Container runtime not available in sst dev, run manually: pnpm -F @auxx/worker dev
 */
export const worker = $dev
  ? undefined
  : new sst.aws.Service('AuxxAiWorker', {
      cluster,
      image: { context: '.', dockerfile: 'apps/worker/Dockerfile' },
      cpu: '0.25 vCPU',
      memory: '0.5 GB',
      environment: getSelectedEnvVars('worker'),
      link: [...getAllSecretsForLinking(), rds, redis, publicBucket, privateBucket],
    })
