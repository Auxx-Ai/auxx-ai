// infra/migrate.ts - Drizzle migration Lambda wired for SST v3

import { DATABASE_URL, rds } from './db'
import { vpc } from './router-vpc'

export const databaseDeployFunction = new sst.aws.Function('DatabaseDeployFunction', {
  vpc,
  handler: 'packages/database/lambda/deploy.handler',
  timeout: '15 minutes',
  memory: '1024 MB',
  runtime: 'nodejs22.x',
  architecture: 'arm64',
  environment: {
    NODE_ENV: 'production',
    DB_SSL_MODE: $dev ? 'disable' : 'require',
    DB_POOL_IDLE_TIMEOUT: process.env.DB_POOL_IDLE_TIMEOUT || '30000',
    DB_POOL_CONNECTION_TIMEOUT: process.env.DB_POOL_CONNECTION_TIMEOUT || '2000',
    DATABASE_URL,
  },
  link: [rds],
  copyFiles: [{ from: 'packages/database/drizzle', to: 'drizzle' }],
  nodejs: {
    bundle: true,
    external: ['pg-native'],
  },
  url: true,
})

export const databaseDeployUrl = databaseDeployFunction.url

export const outputs = {
  databaseDeployUrl: databaseDeployFunction.url,
  databaseDeployFunctionName: databaseDeployFunction.name,
}
