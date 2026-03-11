/// <reference path="../.sst/platform/config.d.ts" />

import { shouldDeployInboundEmailInfrastructure } from './deploy-profile'
import { emailDomain } from './dns'

/**
 * inboundEmailRegion is the AWS region used for SES inbound processing.
 */
const inboundEmailRegion =
  process.env.INBOUND_EMAIL_QUEUE_REGION || process.env.AWS_REGION || 'us-west-1'

/**
 * shouldDeployInboundEmailResources controls whether the current stage owns SES inbound infrastructure.
 */
const shouldDeployInboundEmailResources = shouldDeployInboundEmailInfrastructure($app.stage)

/**
 * inboundEmailDomain is the public forwarding domain used for inbound routing.
 */
export const inboundEmailDomain = (process.env.INBOUND_EMAIL_DOMAIN || 'mail.auxx.ai')
  .trim()
  .toLowerCase()

/**
 * inboundKeyPrefix is the S3 prefix used for raw SES MIME objects.
 */
const inboundKeyPrefix = 'ses/raw'

/**
 * railwayWorkerInboundSsmPrefix is the SSM path prefix used to publish Railway worker inbound-email config.
 */
const railwayWorkerInboundSsmPrefix = `/auxx/${$app.stage}/railway/worker`

/**
 * shouldManageInboundMxRecord controls whether SST manages the MX record in Route53.
 */
const shouldManageInboundMxRecord = process.env.INBOUND_EMAIL_MANAGE_MX !== 'false'

/**
 * inboundHostedZoneName is the Route53 hosted zone used for MX management.
 */
const inboundHostedZoneName = process.env.INBOUND_EMAIL_HOSTED_ZONE_NAME || emailDomain

/**
 * callerIdentity is used to scope SES bucket permissions to this AWS account.
 */
const callerIdentity = aws.getCallerIdentityOutput({})

/**
 * inboundHostedZone looks up the public Route53 zone when MX management is enabled.
 */
const inboundHostedZone =
  shouldDeployInboundEmailResources && shouldManageInboundMxRecord
    ? aws.route53.getZoneOutput({
        name: `${inboundHostedZoneName}.`,
        privateZone: false,
      })
    : undefined

/**
 * inboundEmailBucket stores raw MIME from SES for later worker processing.
 */
export const inboundEmailBucket = shouldDeployInboundEmailResources
  ? new sst.aws.Bucket('InboundEmailBucket', {
      transform: {
        bucket: {
          bucket:
            $app.stage === 'production' ? 'auxx-inbound-email' : `auxx-${$app.stage}-inbound-email`,
          publicAccessBlockConfiguration: {
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
          },
          serverSideEncryptionConfiguration: {
            rules: [
              {
                applyServerSideEncryptionByDefault: {
                  sseAlgorithm: 'AES256',
                },
              },
            ],
          },
          lifecycleRules: [
            {
              id: 'DeleteOldInboundRawEmails',
              enabled: true,
              prefix: `${inboundKeyPrefix}/`,
              expirations: [{ days: 30 }],
            },
          ],
          tags: {
            app: 'auxxai',
            stage: $app.stage,
            purpose: 'inbound-email',
          },
        },
      },
    })
  : undefined

/**
 * inboundEmailDlq captures poison inbound email jobs.
 */
export const inboundEmailDlq = shouldDeployInboundEmailResources
  ? new aws.sqs.Queue('InboundEmailDlq', {
      messageRetentionSeconds: 1_209_600,
      receiveWaitTimeSeconds: 20,
    })
  : undefined

/**
 * inboundEmailQueue carries SES handoff payloads to the worker.
 */
export const inboundEmailQueue = shouldDeployInboundEmailResources
  ? new aws.sqs.Queue('InboundEmailQueue', {
      visibilityTimeoutSeconds: 300,
      messageRetentionSeconds: 604_800,
      receiveWaitTimeSeconds: 20,
      redrivePolicy: inboundEmailDlq!.arn.apply((deadLetterTargetArn) =>
        JSON.stringify({
          deadLetterTargetArn,
          maxReceiveCount: 5,
        })
      ),
    })
  : undefined

/**
 * sesInboundReceiver is the thin Lambda bridge from SES to SQS.
 */
export const sesInboundReceiver = shouldDeployInboundEmailResources
  ? new sst.aws.Function('SesInboundReceiver', {
      runtime: 'nodejs22.x',
      handler: 'apps/mail-ingress/src/ses-inbound-receiver.handler',
      architecture: 'arm64',
      timeout: '15 seconds',
      memory: '256 MB',
      environment: {
        AWS_REGION: inboundEmailRegion,
        INBOUND_EMAIL_BUCKET: inboundEmailBucket!.name,
        INBOUND_EMAIL_DOMAIN: inboundEmailDomain,
        INBOUND_EMAIL_KEY_PREFIX: inboundKeyPrefix,
        INBOUND_EMAIL_QUEUE_URL: inboundEmailQueue!.url,
      },
      permissions: [
        {
          actions: ['sqs:SendMessage'],
          resources: [inboundEmailQueue!.arn],
        },
      ],
    })
  : undefined

/**
 * inboundBucketPolicyDocument scopes SES writes to the raw MIME prefix.
 */
const inboundBucketPolicyDocument = shouldDeployInboundEmailResources
  ? aws.iam.getPolicyDocumentOutput({
      statements: [
        {
          effect: 'Allow',
          principals: [
            {
              type: 'Service',
              identifiers: ['ses.amazonaws.com'],
            },
          ],
          actions: ['s3:PutObject'],
          resources: [$interpolate`${inboundEmailBucket!.arn}/${inboundKeyPrefix}/*`],
          conditions: [
            {
              test: 'StringEquals',
              variable: 'AWS:SourceAccount',
              values: [callerIdentity.accountId],
            },
          ],
        },
      ],
    })
  : undefined

/**
 * inboundEmailBucketPolicy grants SES permission to write raw MIME into the bucket prefix.
 */
export const inboundEmailBucketPolicy = shouldDeployInboundEmailResources
  ? new aws.s3.BucketPolicy('InboundEmailBucketPolicy', {
      bucket: inboundEmailBucket!.name,
      policy: inboundBucketPolicyDocument!.json,
    })
  : undefined

/**
 * allowSesInvokeInboundReceiver allows SES receipt rules to invoke the bridge Lambda.
 */
export const allowSesInvokeInboundReceiver = shouldDeployInboundEmailResources
  ? new aws.lambda.Permission('AllowSesInvokeInboundReceiver', {
      action: 'lambda:InvokeFunction',
      function: sesInboundReceiver!.name,
      principal: 'ses.amazonaws.com',
      sourceAccount: callerIdentity.accountId,
    })
  : undefined

/**
 * inboundReceiptRuleSet is the rule set used for SES inbound processing.
 */
export const inboundReceiptRuleSet = shouldDeployInboundEmailResources
  ? new aws.ses.ReceiptRuleSet('InboundEmailRuleSet', {
      ruleSetName: `auxx-${$app.stage}-inbound`,
    })
  : undefined

/**
 * activeInboundReceiptRuleSet activates the inbound SES rule set.
 */
export const activeInboundReceiptRuleSet = shouldDeployInboundEmailResources
  ? new aws.ses.ActiveReceiptRuleSet('InboundEmailActiveRuleSet', {
      ruleSetName: inboundReceiptRuleSet!.ruleSetName,
    })
  : undefined

/**
 * inboundReceiptRule stores raw MIME in S3 and dispatches the Lambda bridge.
 */
export const inboundReceiptRule = shouldDeployInboundEmailResources
  ? new aws.ses.ReceiptRule(
      'InboundEmailReceiptRule',
      {
        name: `auxx-${$app.stage}-inbound-store-and-dispatch`,
        ruleSetName: inboundReceiptRuleSet!.ruleSetName,
        recipients: [inboundEmailDomain],
        enabled: true,
        scanEnabled: true,
        tlsPolicy: 'Optional',
        s3Actions: [
          {
            position: 1,
            bucketName: inboundEmailBucket!.name,
            objectKeyPrefix: `${inboundKeyPrefix}/`,
          },
        ],
        lambdaActions: [
          {
            position: 2,
            functionArn: sesInboundReceiver!.arn,
            invocationType: 'Event',
          },
        ],
      },
      {
        dependsOn: [
          inboundEmailBucketPolicy!,
          allowSesInvokeInboundReceiver!,
          activeInboundReceiptRuleSet!,
        ],
      }
    )
  : undefined

/**
 * inboundEmailMxRecord points the forwarding domain to the regional SES SMTP endpoint.
 */
export const inboundEmailMxRecord =
  shouldManageInboundMxRecord && inboundHostedZone
    ? new aws.route53.Record('InboundEmailMxRecord', {
        zoneId: inboundHostedZone.zoneId,
        name: inboundEmailDomain,
        type: 'MX',
        ttl: 300,
        records: [`10 inbound-smtp.${inboundEmailRegion}.amazonaws.com`],
      })
    : undefined

/**
 * inboundEmailRailwayEnv exposes the runtime values Railway needs to run the worker against the AWS-managed ingress resources.
 */
export const inboundEmailRailwayEnv = {
  AWS_REGION: inboundEmailRegion,
  INBOUND_EMAIL_ENABLED: shouldDeployInboundEmailResources ? 'true' : 'false',
  INBOUND_EMAIL_DOMAIN: inboundEmailDomain,
  INBOUND_EMAIL_BUCKET: inboundEmailBucket?.name,
  INBOUND_EMAIL_QUEUE_URL: inboundEmailQueue?.url,
  INBOUND_EMAIL_QUEUE_REGION: inboundEmailRegion,
}

/**
 * railwayWorkerInboundEmailBucketParam publishes the worker bucket name for Railway env sync.
 */
export const railwayWorkerInboundEmailBucketParam = shouldDeployInboundEmailResources
  ? new aws.ssm.Parameter('RailwayWorkerInboundEmailBucketParam', {
      name: `${railwayWorkerInboundSsmPrefix}/INBOUND_EMAIL_BUCKET`,
      type: 'String',
      value: inboundEmailBucket!.name,
      tags: {
        app: 'auxxai',
        stage: $app.stage,
        managedBy: 'sst',
        consumer: 'railway-worker',
      },
    })
  : undefined

/**
 * railwayWorkerInboundEmailQueueUrlParam publishes the worker queue URL for Railway env sync.
 */
export const railwayWorkerInboundEmailQueueUrlParam = shouldDeployInboundEmailResources
  ? new aws.ssm.Parameter('RailwayWorkerInboundEmailQueueUrlParam', {
      name: `${railwayWorkerInboundSsmPrefix}/INBOUND_EMAIL_QUEUE_URL`,
      type: 'String',
      value: inboundEmailQueue!.url,
      tags: {
        app: 'auxxai',
        stage: $app.stage,
        managedBy: 'sst',
        consumer: 'railway-worker',
      },
    })
  : undefined
