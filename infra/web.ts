// infra/web.ts

import { rds, redis } from './db'
import { getAppDomain } from './dns'
import { router, vpc } from './router-vpc'
import { getSecretsForLinking, getSelectedEnvVars } from './secrets'
import { privateBucket, publicBucket } from './storage'

export const web = new sst.aws.Nextjs('AuxxAiWeb', {
  vpc,
  path: 'apps/web',
  buildCommand:
    'if [ "${SST_USE_PREBUILT_OPENNEXT:-0}" = "1" ] && [ -d ".open-next" ]; then echo "Using pre-built OpenNext artifacts"; else pnpm run build:opennext; fi',
  // Minimal env; secrets come via Resource links
  environment: getSelectedEnvVars('web'),
  // Link secrets and database resources for Resource access
  link: [...getSecretsForLinking('web'), rds, redis, publicBucket, privateBucket],
  openNextVersion: '3.9.15',
  dev: {
    autostart: true,
    command: 'pnpm dev',
  },
  router: {
    instance: router,
    domain: getAppDomain(),
  },
  // domain:{
  //   name: 'example.com',
  //   certificate: 'arn:aws:acm:us-east-1:123456789012:certificate/abcdefg-1234-5678-abcd-efghijklmnop',
  // },
  server: {
    runtime: 'nodejs22.x',
    install: ['sharp'],
    // memory: '2048 MB',
    // timeout: '20 seconds',
  },
})
