// infra/worker.ts

import { rds, redis } from './db'
import {
  shouldDeployInboundEmailInfrastructure,
  shouldDeployRuntimeService,
} from './deploy-profile'
import { inboundEmailBucket, inboundEmailDomain, inboundEmailQueue } from './email-inbound'
import { serverFunctionExecutorUrl } from './lambda'
import { cluster } from './router-vpc'
import { getSecretsForLinking, getSelectedEnvVars } from './secrets'
import { privateBucket, publicBucket } from './storage'

/**
 * shouldAttachInboundEmailRuntimeConfig controls whether the SST worker should receive inbound-email env and permissions.
 */
const shouldAttachInboundEmailRuntimeConfig = shouldDeployInboundEmailInfrastructure($app.stage)

/**
 * Worker service - only created in non-dev mode
 * Container runtime not available in sst dev, run manually: pnpm -F @auxx/worker dev
 */
export const worker =
  $dev || !shouldDeployRuntimeService('worker')
    ? undefined
    : new sst.aws.Service('AuxxAiWorker', {
        cluster: cluster!,
        image: { context: '.', dockerfile: 'apps/worker/Dockerfile' },
        transform: {
          image: (args) => {
            // Keep cache reads if available, but disable cache export to avoid CI EOF/provider crashes.
            args.cacheTo = []
          },
        },
        cpu: '0.25 vCPU',
        memory: '0.5 GB',
        environment: {
          ...getSelectedEnvVars('worker', {
            lambdaUrl: serverFunctionExecutorUrl,
          }),
          INBOUND_EMAIL_ENABLED: shouldAttachInboundEmailRuntimeConfig ? 'true' : 'false',
          ...(shouldAttachInboundEmailRuntimeConfig
            ? {
                INBOUND_EMAIL_DOMAIN: inboundEmailDomain,
                INBOUND_EMAIL_BUCKET: inboundEmailBucket!.name,
                INBOUND_EMAIL_QUEUE_URL: inboundEmailQueue!.url,
                INBOUND_EMAIL_QUEUE_REGION:
                  process.env.INBOUND_EMAIL_QUEUE_REGION || process.env.AWS_REGION || 'us-west-1',
              }
            : {}),
        },
        link: [...getSecretsForLinking('worker'), rds, redis, publicBucket, privateBucket],
        permissions: [
          {
            actions: ['ses:SendEmail', 'ses:SendRawEmail'],
            resources: ['*'],
          },
          ...(shouldAttachInboundEmailRuntimeConfig
            ? [
                {
                  actions: ['s3:GetObject'],
                  resources: [$interpolate`${inboundEmailBucket!.arn}/ses/raw/*`],
                },
              ]
            : []),
          ...(shouldAttachInboundEmailRuntimeConfig
            ? [
                {
                  actions: [
                    'sqs:DeleteMessage',
                    'sqs:GetQueueAttributes',
                    'sqs:GetQueueUrl',
                    'sqs:ChangeMessageVisibility',
                    'sqs:ReceiveMessage',
                  ],
                  resources: [inboundEmailQueue!.arn],
                },
              ]
            : []),
        ],
      })
