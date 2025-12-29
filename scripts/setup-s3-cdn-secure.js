#!/usr/bin/env node

/**
 * AWS S3 and CDN Setup Script for Auxx.ai - Security Enhanced Version
 * Supports two modes: CloudFront (production) and Direct-S3 (development)
 *
 * Usage:
 *   node setup-s3-cdn-secure.js <environment> <mode>
 *
 * Examples:
 *   node setup-s3-cdn-secure.js development direct-s3
 *   node setup-s3-cdn-secure.js production cloudfront
 */

const {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  HeadBucketCommand,
  PutBucketEncryptionCommand,
  PutBucketOwnershipControlsCommand,
  PutBucketTaggingCommand,
} = require('@aws-sdk/client-s3')
const { CloudFrontClient, GetDistributionCommand } = require('@aws-sdk/client-cloudfront')
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts')
const fs = require('fs')
const path = require('path')

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
}

// Configuration
const ENVIRONMENT = process.argv[2] || 'development'
const MODE = (process.argv[3] || process.env.CDN_MODE || 'direct-s3').toLowerCase() // 'cloudfront' | 'direct-s3'
const DRY_RUN = process.argv.includes('--dry-run')
const AWS_REGION = process.env.AWS_REGION || 'us-east-2'
const CLOUDFRONT_DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || ''
const S3_KMS_KEY_ID = process.env.S3_KMS_KEY_ID || '' // Optional KMS key for encryption

// Validate mode
if (!['cloudfront', 'direct-s3'].includes(MODE)) {
  console.error(
    `${colors.red}Invalid mode: ${MODE}. Use 'cloudfront' or 'direct-s3'${colors.reset}`
  )
  process.exit(1)
}

// Warn if CloudFront mode without distribution ID
if (MODE === 'cloudfront' && !CLOUDFRONT_DISTRIBUTION_ID) {
  console.warn(
    `${colors.yellow}Warning: CloudFront mode selected but CLOUDFRONT_DISTRIBUTION_ID not set.${colors.reset}`
  )
  console.warn(
    `${colors.yellow}Set it as environment variable or update the bucket policy later.${colors.reset}`
  )
}

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
const s3Client = new S3Client({ region: AWS_REGION })
const stsClient = new STSClient({ region: AWS_REGION })
const cloudFrontClient = new CloudFrontClient({ region: 'us-east-1' }) // CloudFront is global

// Utility functions
const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  mode: (msg) => console.log(`${colors.magenta}◆${colors.reset} ${msg}`),
  header: (msg) => {
    console.log('')
    console.log(`${colors.green}${'='.repeat(50)}${colors.reset}`)
    console.log(`${colors.green}${msg}${colors.reset}`)
    console.log(`${colors.green}${'='.repeat(50)}${colors.reset}`)
    console.log('')
  },
  dryRun: (msg) => console.log(`${colors.magenta}[DRY RUN]${colors.reset} ${msg}`),
}

// Get CloudFront domain from distribution ID
async function getCloudFrontDomain(distributionId) {
  if (!distributionId) return ''
  try {
    const { Distribution } = await cloudFrontClient.send(
      new GetDistributionCommand({ Id: distributionId })
    )
    return Distribution?.DomainName || ''
  } catch (error) {
    log.warning(`Could not fetch CloudFront domain: ${error.message}`)
    return ''
  }
}

// Enhanced bucket existence check
async function bucketExists(bucketName) {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }))
    return true
  } catch (error) {
    const code = error.$metadata?.httpStatusCode
    if (code === 404) return false // Bucket doesn't exist
    if (code === 301 || code === 403) {
      // Bucket exists but not owned by us or in different region
      throw new Error(
        `Bucket name '${bucketName}' is already taken by another account or exists in a different region.`
      )
    }
    throw error
  }
}

// Create bucket with security best practices
async function createBucket(bucketName, isPublic = false) {
  log.info(`Creating bucket: ${bucketName}`)

  try {
    // Check if bucket exists
    if (await bucketExists(bucketName)) {
      log.success(`Bucket ${bucketName} already exists`)
      return
    }

    // Create bucket
    const createParams = {
      Bucket: bucketName,
    }

    // Add location constraint for non us-east-1 regions
    if (AWS_REGION !== 'us-east-1') {
      createParams.CreateBucketConfiguration = {
        LocationConstraint: AWS_REGION,
      }
    }

    await s3Client.send(new CreateBucketCommand(createParams))
    log.success(`Created bucket ${bucketName}`)
  } catch (error) {
    if (error.message?.includes('already taken')) {
      throw error // Re-throw bucket name collision errors
    }
    if (error.name === 'BucketAlreadyOwnedByYou') {
      log.success(`Bucket ${bucketName} already owned by you`)
    } else {
      throw error
    }
  }

  // Enable versioning
  log.info('  Enabling versioning...')
  await s3Client.send(
    new PutBucketVersioningCommand({
      Bucket: bucketName,
      VersioningConfiguration: { Status: 'Enabled' },
    })
  )

  // Enforce bucket owner ownership (no ACLs)
  log.info('  Setting ownership controls...')
  await s3Client.send(
    new PutBucketOwnershipControlsCommand({
      Bucket: bucketName,
      OwnershipControls: {
        Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
      },
    })
  )

  // Enable default encryption (SSE-S3 or KMS)
  log.info('  Enabling encryption...')
  const encryptionConfig = S3_KMS_KEY_ID
    ? { SSEAlgorithm: 'aws:kms', KMSMasterKeyID: S3_KMS_KEY_ID }
    : { SSEAlgorithm: 'AES256' }

  if (!DRY_RUN) {
    await s3Client.send(
      new PutBucketEncryptionCommand({
        Bucket: bucketName,
        ServerSideEncryptionConfiguration: {
          Rules: [
            {
              ApplyServerSideEncryptionByDefault: encryptionConfig,
            },
          ],
        },
      })
    )
  } else {
    log.dryRun(`Would enable ${encryptionConfig.SSEAlgorithm} encryption`)
  }

  // Configure public access block
  // In CloudFront mode, always block public access
  // In Direct-S3 mode, allow public access only for public bucket
  const shouldBlockPublic = MODE === 'cloudfront' || !isPublic

  if (shouldBlockPublic) {
    log.info('  Blocking public access...')
    await s3Client.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucketName,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: MODE === 'cloudfront', // Allow policy in direct-s3 mode
          RestrictPublicBuckets: MODE === 'cloudfront',
        },
      })
    )
  } else {
    log.info('  Configuring selective public access...')
    await s3Client.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucketName,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: false,
          IgnorePublicAcls: false,
          BlockPublicPolicy: false,
          RestrictPublicBuckets: false,
        },
      })
    )
  }
}

// Setup CORS (no wildcards, added OPTIONS)
async function setupCORS(bucketName) {
  log.info('Setting up CORS configuration...')

  const corsConfig = {
    CORSRules: [
      {
        AllowedHeaders: [
          'content-type',
          'x-amz-date',
          'x-amz-content-sha256',
          'x-amz-security-token',
          'authorization',
        ],
        AllowedMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'], // OPTIONS is handled automatically
        AllowedOrigins: [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://127.0.0.1:3000',
          'https://auxx.ai',
          'https://app.auxx.ai',
          'https://www.auxx.ai',
          // Add more explicit origins as needed
        ],
        ExposeHeaders: ['ETag', 'Content-Length', 'x-amz-request-id', 'x-amz-version-id'],
        MaxAgeSeconds: 3600,
      },
    ],
  }

  await s3Client.send(
    new PutBucketCorsCommand({
      Bucket: bucketName,
      CORSConfiguration: corsConfig,
    })
  )

  log.success('CORS configuration applied')
}

// Mode-aware bucket policy
async function setupBucketPolicy(bucketName, accountId) {
  log.info(`Setting up bucket policy (${MODE} mode)...`)

  const statements = [
    // Always deny insecure transport
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
  ]

  if (MODE === 'direct-s3') {
    // Direct S3 mode: Allow public read for /public/* path
    statements.push({
      Sid: 'PublicReadGetObject',
      Effect: 'Allow',
      Principal: '*',
      Action: 's3:GetObject',
      Resource: `arn:aws:s3:::${bucketName}/public/*`,
    })
    log.mode('Direct-S3 mode: Public read enabled for /public/* path')
  } else if (MODE === 'cloudfront') {
    if (CLOUDFRONT_DISTRIBUTION_ID) {
      const cfArn = `arn:aws:cloudfront::${accountId}:distribution/${CLOUDFRONT_DISTRIBUTION_ID}`

      // CloudFront mode: Only allow access from specific distribution
      statements.push({
        Sid: 'AllowCloudFrontOACOnly',
        Effect: 'Allow',
        Principal: { Service: 'cloudfront.amazonaws.com' },
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${bucketName}/*`,
        Condition: {
          StringEquals: {
            'AWS:SourceArn': cfArn,
          },
        },
      })

      // Explicitly deny all other access
      statements.push({
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
      })

      log.mode(`CloudFront mode: Access restricted to distribution ${CLOUDFRONT_DISTRIBUTION_ID}`)
    } else {
      // CloudFront mode but no distribution ID yet
      statements.push({
        Sid: 'AllowCloudFrontOACTemp',
        Effect: 'Allow',
        Principal: { Service: 'cloudfront.amazonaws.com' },
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${bucketName}/*`,
        Condition: {
          StringEquals: {
            'AWS:SourceAccount': accountId,
          },
        },
      })
      log.warning('CloudFront mode: Using account-level access (update with distribution ID later)')
    }
  }

  const policy = {
    Version: '2012-10-17',
    Statement: statements,
  }

  await s3Client.send(
    new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify(policy),
    })
  )

  log.success('Bucket policy applied')
}

// Setup lifecycle rules with intelligent tiering
async function setupLifecycle(bucketName, isPublic = false) {
  log.info('Setting up lifecycle policies...')

  const rules = [
    {
      Id: 'DeleteTempFiles',
      Status: 'Enabled',
      Filter: { Prefix: 'temp/' },
      Expiration: { Days: 7 },
    },
    {
      Id: 'DeleteOldVersions',
      Status: 'Enabled',
      Filter: {},
      NoncurrentVersionExpiration: { NoncurrentDays: 30 },
    },
  ]

  // Add intelligent tiering for cost optimization
  if (isPublic) {
    rules.push({
      Id: 'TieringPublic',
      Status: 'Enabled',
      Filter: { Prefix: 'public/' },
      Transitions: [{ Days: 30, StorageClass: 'INTELLIGENT_TIERING' }],
    })
  } else {
    rules.push({
      Id: 'TieringPrivate',
      Status: 'Enabled',
      Filter: { Prefix: 'private/' },
      Transitions: [
        { Days: 30, StorageClass: 'INTELLIGENT_TIERING' },
        { Days: 180, StorageClass: 'GLACIER_IR' },
      ],
    })
  }

  const lifecycleConfig = { Rules: rules }

  await s3Client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucketName,
      LifecycleConfiguration: lifecycleConfig,
    })
  )

  log.success('Lifecycle policies applied')
}

// Create folder structure (optional, S3 is flat)
async function createFolders(bucketName, folders) {
  log.info('Creating folder structure...')

  for (const folder of folders) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: folder.endsWith('/') ? folder : `${folder}/`,
      })
    )
  }

  log.success('Folder structure created')
}

// Add bucket tags for cost allocation and management
async function setupBucketTags(bucketName, isPublic = false) {
  log.info('Setting up bucket tags...')

  const tags = [
    { Key: 'app', Value: 'auxx' },
    { Key: 'env', Value: ENVIRONMENT },
    { Key: 'mode', Value: MODE },
    { Key: 'type', Value: isPublic ? 'public' : 'private' },
    { Key: 'managed-by', Value: 'setup-script' },
  ]

  if (!DRY_RUN) {
    await s3Client.send(
      new PutBucketTaggingCommand({
        Bucket: bucketName,
        Tagging: { TagSet: tags },
      })
    )
  } else {
    log.dryRun(`Would add tags: ${tags.map((t) => `${t.Key}=${t.Value}`).join(', ')}`)
  }

  log.success('Bucket tags applied')
}

// Upload test files with cache control
async function uploadTestFiles(bucketName) {
  log.info('Uploading test files...')

  const testFiles = [
    {
      key: 'public/test.txt',
      body: 'Test file for CDN',
      contentType: 'text/plain',
      cacheControl: 'public, max-age=3600',
    },
    {
      key: 'public/health.json',
      body: JSON.stringify({
        status: 'ok',
        environment: ENVIRONMENT,
        mode: MODE,
        timestamp: new Date().toISOString(),
      }),
      contentType: 'application/json',
      cacheControl: 'public, max-age=60',
    },
    {
      key: 'public/images/test.png',
      // 1x1 transparent PNG
      body: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8,
        0x0f, 0x00, 0x00, 0x01, 0x01, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
        0xae, 0x42, 0x60, 0x82,
      ]),
      contentType: 'image/png',
      cacheControl: 'public, max-age=86400',
    },
  ]

  for (const file of testFiles) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: file.key,
        Body: file.body,
        ContentType: file.contentType,
        CacheControl: file.cacheControl,
      })
    )
  }

  log.success('Test files uploaded')
}

// Generate .env content
async function generateEnvContent() {
  const cfDomain =
    MODE === 'cloudfront' ? await getCloudFrontDomain(CLOUDFRONT_DISTRIBUTION_ID) : ''

  return `
# S3 Configuration
S3_REGION=${AWS_REGION}

# CDN Mode Configuration
CLOUDFRONT_DISTRIBUTION_ID=${CLOUDFRONT_DISTRIBUTION_ID}

# For local development
S3_ENDPOINT=https://s3.${AWS_REGION}.amazonaws.com
AWS_REGION=${AWS_REGION}

# Public file access
${MODE === 'direct-s3' ? `S3_PUBLIC_URL=https://${BUCKETS.public}.s3.${AWS_REGION}.amazonaws.com` : `# S3_PUBLIC_URL=${cfDomain ? `https://${cfDomain}` : '<CloudFront URL will be here>'}`}

# CDN Configuration

# Optional KMS encryption
S3_KMS_KEY_ID=${S3_KMS_KEY_ID}
`
}

// Main setup function
async function main() {
  try {
    log.header(`AWS S3 CDN Setup - ${ENVIRONMENT} (${MODE} mode)${DRY_RUN ? ' [DRY RUN]' : ''}`)

    if (DRY_RUN) {
      log.warning('DRY RUN MODE - No changes will be made')
      console.log('')
    }

    log.info(`Region: ${AWS_REGION}`)
    log.info(`Environment: ${ENVIRONMENT}`)
    log.mode(`Mode: ${MODE.toUpperCase()}`)
    log.info(`Public Bucket: ${BUCKETS.public}`)
    log.info(`Private Bucket: ${BUCKETS.private}`)
    log.info(`Logs Bucket: ${BUCKETS.logs}`)
    console.log('')

    // Check AWS credentials
    log.info('Checking AWS credentials...')
    const identity = await stsClient.send(new GetCallerIdentityCommand({}))
    const accountId = identity.Account
    log.success(`AWS credentials valid (Account: ${accountId})`)
    console.log('')

    // Create buckets
    // In CloudFront mode, public bucket is not actually public
    const isPublicBucket = MODE === 'direct-s3'
    await createBucket(BUCKETS.public, isPublicBucket)
    await createBucket(BUCKETS.private, false)
    await createBucket(BUCKETS.logs, false)
    console.log('')

    // Setup CORS
    // Apply to private bucket for uploads, public for direct-s3 mode
    if (MODE === 'direct-s3') {
      await setupCORS(BUCKETS.public)
    }
    await setupCORS(BUCKETS.private) // For presigned uploads
    console.log('')

    // Setup bucket policy for public bucket
    await setupBucketPolicy(BUCKETS.public, accountId)
    console.log('')

    // Setup lifecycle policies with intelligent tiering
    await setupLifecycle(BUCKETS.public, isPublicBucket)
    await setupLifecycle(BUCKETS.private, false)
    console.log('')

    // Add bucket tags for management
    await setupBucketTags(BUCKETS.public, isPublicBucket)
    await setupBucketTags(BUCKETS.private, false)
    await setupBucketTags(BUCKETS.logs, false)
    console.log('')

    // Create folder structure
    await createFolders(BUCKETS.public, [
      'public/',
      'public/avatars/',
      'public/logos/',
      'public/images/',
      'temp/',
    ])

    await createFolders(BUCKETS.private, [
      'private/',
      'private/tickets/',
      'private/messages/',
      'private/documents/',
      'temp/',
    ])
    console.log('')

    // Upload test files
    await uploadTestFiles(BUCKETS.public)
    console.log('')

    // Generate environment variables
    log.header('Setup Complete!')

    log.warning('Add these environment variables to your .env.local file:')
    const envContent = await generateEnvContent()
    console.log(envContent)

    // Save to file
    const envPath = path.join(process.cwd(), `.env.${ENVIRONMENT}.${MODE}.example`)
    if (!DRY_RUN) {
      fs.writeFileSync(envPath, envContent)
      log.success(`Environment variables saved to: ${envPath}`)
    } else {
      log.dryRun(`Would save environment variables to: ${envPath}`)
    }
    console.log('')

    // Mode-specific instructions
    if (MODE === 'direct-s3') {
      log.warning('Direct-S3 Mode - Test URLs:')
      console.log('')
      console.log('Public bucket (direct S3):')
      console.log(`  https://${BUCKETS.public}.s3.${AWS_REGION}.amazonaws.com/public/test.txt`)
      console.log(`  https://${BUCKETS.public}.s3.${AWS_REGION}.amazonaws.com/public/health.json`)
      console.log(
        `  https://${BUCKETS.public}.s3.${AWS_REGION}.amazonaws.com/public/images/test.png`
      )
      console.log('')
      log.info('These URLs work directly from localhost for development.')
    } else {
      log.warning('CloudFront Mode - Next Steps:')
      console.log('')
      if (!CLOUDFRONT_DISTRIBUTION_ID) {
        console.log('1. Create CloudFront distribution with OAC')
        console.log('2. Set CLOUDFRONT_DISTRIBUTION_ID environment variable')
        console.log('3. Re-run this script to update bucket policy')
      } else {
        console.log('1. Verify CloudFront distribution is active')
        console.log('2. Test via CloudFront URL')
        console.log('3. Set up custom domain (optional)')
      }
    }
    console.log('')

    log.warning('General Next Steps:')
    console.log('1. Copy environment variables to your .env.local file')
    console.log('2. Test file uploads and downloads')
    console.log('3. Monitor CloudWatch metrics')
    console.log('')
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

module.exports = { main, BUCKETS, AWS_REGION, MODE }
