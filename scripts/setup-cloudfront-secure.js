#!/usr/bin/env node

/**
 * CloudFront Distribution Setup Script - Security Enhanced & Idempotent
 * Creates or reuses CloudFront distribution with OAC and updates S3 bucket policy
 *
 * Usage:
 *   node setup-cloudfront-secure.js <environment>
 *
 * Example:
 *   node setup-cloudfront-secure.js production
 *   PRICE_CLASS=PriceClass_All node setup-cloudfront-secure.js production
 */

const {
  CloudFrontClient,
  CreateDistributionCommand,
  CreateOriginAccessControlCommand,
  ListOriginAccessControlsCommand,
  ListDistributionsCommand,
  GetDistributionCommand,
} = require('@aws-sdk/client-cloudfront')
const {
  S3Client,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
} = require('@aws-sdk/client-s3')
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts')
const fs = require('fs')
const path = require('path')

// Configuration
const ENVIRONMENT = process.argv[2] || 'production'
const AWS_REGION = process.env.AWS_REGION || 'us-east-2'
const PRICE_CLASS = process.env.PRICE_CLASS || 'PriceClass_100' // PriceClass_All for global
const ENABLE_ORIGIN_SHIELD = process.env.ENABLE_ORIGIN_SHIELD === 'true'
const WAIT_FOR_DEPLOYMENT = process.env.WAIT_FOR_DEPLOYMENT !== 'false'

// Bucket names
const getBucketNames = (env) => {
  if (env === 'production') {
    return {
      public: 'auxx-public-assets',
      private: 'auxx-private-assets',
      logs: 'auxx-logs',
    }
  }
  return {
    public: `auxx-${env}-public-assets`,
    private: `auxx-${env}-private-assets`,
    logs: `auxx-${env}-logs`,
  }
}

const BUCKETS = getBucketNames(ENVIRONMENT)

// Initialize AWS clients
const cloudFrontClient = new CloudFrontClient({ region: 'us-east-1' }) // CloudFront is global
const s3Client = new S3Client({ region: AWS_REGION })
const stsClient = new STSClient({ region: AWS_REGION })

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  progress: (msg) => console.log(`${colors.cyan}⏳${colors.reset} ${msg}`),
  header: (msg) => {
    console.log('')
    console.log(`${colors.green}${'='.repeat(50)}${colors.reset}`)
    console.log(`${colors.green}${msg}${colors.reset}`)
    console.log(`${colors.green}${'='.repeat(50)}${colors.reset}`)
    console.log('')
  },
}

// Get or create Origin Access Control (idempotent)
async function getOrCreateOAC(bucketName) {
  log.info('Checking for existing Origin Access Control...')

  const oacName = `${bucketName}-oac`

  try {
    // List existing OACs
    const listResponse = await cloudFrontClient.send(new ListOriginAccessControlsCommand({}))
    const existing = (listResponse.OriginAccessControlList?.Items || []).find(
      (oac) => oac.Name === oacName
    )

    if (existing) {
      log.success(`Found existing OAC: ${existing.Id}`)
      return existing.Id
    }

    // Create new OAC if not found
    log.info('Creating new Origin Access Control...')
    const createResponse = await cloudFrontClient.send(
      new CreateOriginAccessControlCommand({
        OriginAccessControlConfig: {
          Name: oacName,
          Description: `OAC for ${bucketName} (${ENVIRONMENT})`,
          SigningProtocol: 'sigv4',
          SigningBehavior: 'always',
          OriginAccessControlOriginType: 's3',
        },
      })
    )

    log.success(`Created OAC: ${createResponse.OriginAccessControl.Id}`)
    return createResponse.OriginAccessControl.Id
  } catch (error) {
    log.error(`Failed to get/create OAC: ${error.message}`)
    throw error
  }
}

// Find existing CloudFront distribution for bucket
async function findExistingDistribution(bucketName) {
  log.info('Checking for existing CloudFront distribution...')

  const originDomain = `${bucketName}.s3.${AWS_REGION}.amazonaws.com`
  let Marker

  do {
    try {
      const response = await cloudFrontClient.send(new ListDistributionsCommand({ Marker }))
      const items = response.DistributionList?.Items || []

      const match = items.find((dist) =>
        (dist.Origins?.Items || []).some((origin) => origin.DomainName === originDomain)
      )

      if (match) {
        log.success(`Found existing distribution: ${match.Id} (${match.DomainName})`)
        return {
          id: match.Id,
          domainName: match.DomainName,
          arn: match.ARN,
          status: match.Status,
        }
      }

      Marker = response.DistributionList?.NextMarker
    } catch (error) {
      log.warning(`Error listing distributions: ${error.message}`)
      return null
    }
  } while (Marker)

  log.info('No existing distribution found for this bucket')
  return null
}

// Create CloudFront distribution
async function createDistribution(bucketName, oacId, accountId) {
  log.info('Creating new CloudFront distribution...')

  const originConfig = {
    Id: `S3-${bucketName}`,
    DomainName: `${bucketName}.s3.${AWS_REGION}.amazonaws.com`,
    S3OriginConfig: {
      OriginAccessIdentity: '', // Empty for OAC
    },
    OriginAccessControlId: oacId,
  }

  // Add Origin Shield if enabled
  if (ENABLE_ORIGIN_SHIELD) {
    originConfig.OriginShield = {
      Enabled: true,
      OriginShieldRegion: AWS_REGION, // Use same region as S3 bucket
    }
    log.info(`Origin Shield enabled in ${AWS_REGION}`)
  }

  const config = {
    CallerReference: `${bucketName}-${Date.now()}`,
    Comment: `CDN for ${bucketName} (${ENVIRONMENT})`,
    Enabled: true,

    Origins: {
      Quantity: 1,
      Items: [originConfig],
    },

    DefaultCacheBehavior: {
      TargetOriginId: `S3-${bucketName}`,
      ViewerProtocolPolicy: 'redirect-to-https',
      AllowedMethods: {
        Quantity: 3,
        Items: ['GET', 'HEAD', 'OPTIONS'],
        CachedMethods: {
          Quantity: 3,
          Items: ['GET', 'HEAD', 'OPTIONS'],
        },
      },
      Compress: true,
      CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // Managed-CachingOptimized
      OriginRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf', // Managed-CORS-S3Origin
      ResponseHeadersPolicyId: '60669652-455b-4ae9-85a4-c4c02393f86c', // Managed-SimpleCORS
      TrustedSigners: {
        Enabled: false,
        Quantity: 0,
      },
    },

    CacheBehaviors: {
      Quantity: 2,
      Items: [
        {
          PathPattern: 'public/avatars/*',
          TargetOriginId: `S3-${bucketName}`,
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD'],
            },
          },
          Compress: true,
          CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
          TrustedSigners: {
            Enabled: false,
            Quantity: 0,
          },
        },
        {
          PathPattern: 'public/images/*',
          TargetOriginId: `S3-${bucketName}`,
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD'],
            },
          },
          Compress: true,
          CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
          TrustedSigners: {
            Enabled: false,
            Quantity: 0,
          },
        },
      ],
    },

    // No DefaultRootObject - we're serving assets, not a website

    PriceClass: PRICE_CLASS,

    // Enable logging to track requests
    Logging: {
      Enabled: true,
      IncludeCookies: false,
      Bucket: `${BUCKETS.logs}.s3.amazonaws.com`,
      Prefix: `cloudfront/${ENVIRONMENT}/`,
    },

    HttpVersion: 'http2and3',
    IsIPV6Enabled: true,
  }

  try {
    const command = new CreateDistributionCommand({ DistributionConfig: config })
    const response = await cloudFrontClient.send(command)

    log.success(`Created distribution: ${response.Distribution.Id}`)
    log.info(`Domain Name: ${response.Distribution.DomainName}`)
    log.info(`Price Class: ${PRICE_CLASS}`)

    return {
      id: response.Distribution.Id,
      domainName: response.Distribution.DomainName,
      arn: response.Distribution.ARN,
      status: response.Distribution.Status,
    }
  } catch (error) {
    log.error(`Failed to create distribution: ${error.message}`)
    throw error
  }
}

// Ensure public access is blocked (for CloudFront-only access)
async function ensurePublicAccessBlocked(bucketName) {
  log.info('Ensuring S3 public access is blocked...')

  try {
    await s3Client.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucketName,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: false, // Allow bucket policy
          RestrictPublicBuckets: false, // Allow policy-based access
        },
      })
    )
    log.success('Public access block configured for CloudFront-only access')
  } catch (error) {
    log.warning(`Could not update public access block: ${error.message}`)
  }
}

// Update S3 bucket policy for CloudFront (with explicit deny)
async function updateBucketPolicy(bucketName, distributionId, accountId) {
  log.info('Updating S3 bucket policy for CloudFront-only access...')

  const cfArn = `arn:aws:cloudfront::${accountId}:distribution/${distributionId}`

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'DenyInsecureTransport',
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: [`arn:aws:s3:::${bucketName}`, `arn:aws:s3:::${bucketName}/*`],
        Condition: {
          Bool: { 'aws:SecureTransport': 'false' },
        },
      },
      {
        Sid: 'AllowCloudFrontOACOnly',
        Effect: 'Allow',
        Principal: { Service: 'cloudfront.amazonaws.com' },
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${bucketName}/*`,
        Condition: {
          StringEquals: {
            'AWS:SourceArn': cfArn,
            'AWS:SourceAccount': accountId,
          },
        },
      },
      {
        Sid: 'DenyNonCloudFrontAccess',
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${bucketName}/*`,
        Condition: {
          StringNotEquals: {
            'AWS:SourceArn': cfArn,
          },
        },
      },
    ],
  }

  await s3Client.send(
    new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify(policy),
    })
  )

  log.success('Bucket policy updated for CloudFront-only access')
}

// Wait for distribution to be deployed
async function waitForDistribution(distributionId) {
  log.progress('Waiting for distribution to deploy (this can take 15-20 minutes)...')

  const maxWaitTime = 30 * 60 * 1000 // 30 minutes
  const checkInterval = 30 * 1000 // 30 seconds
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const response = await cloudFrontClient.send(
        new GetDistributionCommand({ Id: distributionId })
      )

      const status = response.Distribution?.Status

      if (status === 'Deployed') {
        log.success('Distribution is deployed and ready!')
        return true
      }

      log.progress(`Distribution status: ${status} (checking again in 30s...)`)
      await new Promise((resolve) => setTimeout(resolve, checkInterval))
    } catch (error) {
      log.warning(`Error checking distribution status: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, checkInterval))
    }
  }

  log.warning('Timeout waiting for distribution deployment. Check AWS console for status.')
  return false
}

// Generate updated environment variables
function generateEnvUpdate(distributionId, domainName) {
  return `
# CloudFront Configuration - Add to your .env file

# Public URLs (via CloudFront)
PUBLIC_AVATAR_URL=https://${domainName}/public/avatars
PUBLIC_IMAGES_URL=https://${domainName}/public/images
PUBLIC_API_URL=https://${domainName}

# S3 Configuration (keep for uploads)
S3_REGION=${AWS_REGION}
`
}

// Main function
async function main() {
  try {
    log.header(`CloudFront Setup for ${ENVIRONMENT}`)

    log.info(`Environment: ${ENVIRONMENT}`)
    log.info(`AWS Region: ${AWS_REGION}`)
    log.info(`Price Class: ${PRICE_CLASS}`)
    log.info(`Origin Shield: ${ENABLE_ORIGIN_SHIELD ? 'Enabled' : 'Disabled'}`)
    console.log('')

    // Get AWS account ID
    log.info('Getting AWS account information...')
    const identity = await stsClient.send(new GetCallerIdentityCommand({}))
    const accountId = identity.Account
    log.success(`Account ID: ${accountId}`)
    console.log('')

    // Ensure public access is blocked (CloudFront-only mode)
    await ensurePublicAccessBlocked(BUCKETS.public)
    console.log('')

    // Get or create OAC
    const oacId = await getOrCreateOAC(BUCKETS.public)
    console.log('')

    // Find or create CloudFront distribution
    let distribution = await findExistingDistribution(BUCKETS.public)

    if (!distribution) {
      distribution = await createDistribution(BUCKETS.public, oacId, accountId)
      console.log('')

      if (WAIT_FOR_DEPLOYMENT && distribution.status !== 'Deployed') {
        await waitForDistribution(distribution.id)
      } else {
        log.warning('Distribution is being deployed. This can take 15-20 minutes.')
      }
    } else if (distribution.status !== 'Deployed') {
      log.warning(`Distribution status: ${distribution.status}`)
      if (WAIT_FOR_DEPLOYMENT) {
        await waitForDistribution(distribution.id)
      }
    }
    console.log('')

    // Update S3 bucket policy
    await updateBucketPolicy(BUCKETS.public, distribution.id, accountId)
    console.log('')

    // Generate environment variables
    log.header('Setup Complete!')

    const envUpdate = generateEnvUpdate(distribution.id, distribution.domainName)
    console.log(envUpdate)

    // Save to file
    const envPath = path.join(process.cwd(), `.env.cloudfront.${ENVIRONMENT}`)
    fs.writeFileSync(envPath, envUpdate)
    log.success(`Environment variables saved to: ${envPath}`)
    console.log('')

    // Test URLs
    log.warning('Test URLs:')
    console.log(`  https://${distribution.domainName}/public/test.txt`)
    console.log(`  https://${distribution.domainName}/public/health.json`)
    console.log(`  https://${distribution.domainName}/public/images/test.png`)
    console.log('')

    log.warning('Next Steps:')
    if (distribution.status !== 'Deployed') {
      console.log('1. Wait for distribution to finish deploying')
      console.log('2. Test the URLs above')
    } else {
      console.log('1. Test the URLs above')
    }
    console.log('2. Update your .env file with CloudFront settings')
    console.log('3. Optional: Set up custom domain (CNAME)')
    console.log('4. Optional: Request SSL certificate in ACM')
    console.log('')

    log.info(
      `CloudFront Console: https://console.aws.amazon.com/cloudfront/v4/home#/distributions/${distribution.id}`
    )
  } catch (error) {
    log.error(`Setup failed: ${error.message}`)
    console.error(error)
    process.exit(1)
  }
}

// Run the script
if (require.main === module) {
  main()
}

module.exports = { main }
