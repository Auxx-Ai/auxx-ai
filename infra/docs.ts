// infra/docs.ts

import { subdomain } from './dns'
import { router, vpc } from './router-vpc'
import { getSecretsForLinking, getSelectedEnvVars } from './secrets'

export const docs = new sst.aws.Nextjs('AuxxAiDocs', {
  vpc,
  path: 'apps/docs',
  buildCommand:
    'if [ "${SST_USE_PREBUILT_OPENNEXT:-0}" = "1" ] && [ -d ".open-next" ]; then echo "Using pre-built OpenNext artifacts"; else pnpm run build:opennext; fi',
  environment: getSelectedEnvVars('docs'),
  link: getSecretsForLinking('docs'),
  openNextVersion: '3.9.15',
  warm: $app.stage === 'production' ? 3 : 1,
  dev: {
    autostart: false, // Optional: set to true if you want auto-start
    command: 'pnpm dev',
  },
  router: {
    instance: router,
    domain: subdomain('docs'), // This will create docs.auxx.ai, docs.dev.auxx.ai, etc.
  },
  server: {
    runtime: 'nodejs22.x',
    // Keep these externalized to avoid esbuild parse issues in fdir during OpenNext bundling.
    install: ['fdir', 'picomatch'],
    // No sharp needed for docs (static content)
  },
})
