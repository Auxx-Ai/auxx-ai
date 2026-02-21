// infra/docs.ts

import { subdomain } from './dns'
import { router, vpc } from './router-vpc'
import { getSecretsForLinking, getSelectedEnvVars } from './secrets'

export const docs = new sst.aws.Nextjs('AuxxAiDocs', {
  vpc,
  path: 'apps/docs',
  buildCommand: 'pnpm run build:opennext',
  environment: getSelectedEnvVars('docs'),
  link: getSecretsForLinking('docs'),
  openNextVersion: '3.9.15',
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
