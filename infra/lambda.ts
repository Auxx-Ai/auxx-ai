// infra/lambda.ts
/// <reference path="../.sst/platform/config.d.ts" />

import { vpc } from './router-vpc'
import { privateBucket } from './storage'

/**
 * Lambda function for server function execution
 * Only created in non-dev mode (container runtime not available in sst dev)
 */
export const serverFunctionExecutor = $dev
  ? undefined
  : new sst.aws.Function('ServerFunctionExecutor', {
  // Use VPC for access to RDS/Redis if needed
  vpc,

  // Custom Deno runtime compiled as bootstrap binary
  runtime: 'provided.al2023',
  handler: 'bootstrap',
  architecture: 'arm64',
  bundle: 'apps/lambda/dist',

  // Resource limits
  timeout: '30 seconds',
  memory: '512 MB',

  // Environment variables
  environment: {
    NODE_ENV: $dev ? 'development' : 'production',
    BUNDLES_BUCKET_NAME: privateBucket.name, // Server bundles stored in private bucket
  },

  // Link resources (NOT secrets - extensions should not access platform secrets)
  link: [privateBucket],

  // Permissions
  permissions: [
    {
      actions: ['s3:GetObject'],
      resources: [
        $interpolate`${privateBucket.arn}/*/apps/*/bundles/*`, // Bundle files
      ],
    },
  ],

  // Enable function URL (simpler than API Gateway)
  url: {
    cors: {
      allowOrigins: ['*'], // Will be restricted by auth in API layer
      allowMethods: ['POST'],
      allowHeaders: ['*'],
    },
    authorization: 'none', // Auth handled by API layer
  },

  // Development - container runtime not supported in sst dev
  dev: false,
})

// Export function URL for API to invoke (undefined in dev mode)
export const serverFunctionExecutorUrl = serverFunctionExecutor?.url
