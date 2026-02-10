// infra/docs.ts
import { router, vpc } from './router-vpc'
import { getSelectedEnvVars } from './secrets'
import { subdomain } from './dns'

export const docs = new sst.aws.Nextjs('AuxxAiDocs', {
  vpc,
  path: 'apps/docs',
  buildCommand: 'pnpm run build:opennext',
  environment: getSelectedEnvVars('docs'),
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
