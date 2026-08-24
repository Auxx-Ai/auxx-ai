// infra/storage.ts
/// <reference path="../.sst/platform/config.d.ts" />
import { appify } from './dns'

// ============= PUBLIC BUCKET (CDN-cached) =============

export const publicBucket = new sst.aws.Bucket('PublicAssets', {
  access: 'public', // SST handles public read policy automatically
  transform: {
    bucket: {
      bucket: $app.stage === 'production' ? 'auxx-public' : appify('public'), // auxx-public (prod), auxx-dev-public, auxx-local-public

      // CORS for browser uploads (still use presigned POST for upload)
      corsRules: [
        {
          allowedHeaders: ['*'],
          allowedMethods: ['GET', 'HEAD', 'PUT', 'POST'],
          allowedOrigins: [
            'http://localhost:3000',
            'http://localhost:3006',
            'https://*.auxx.ai',
            'https://auxx.ai',
          ],
          exposeHeaders: ['ETag'],
          maxAgeSeconds: 3600,
        },
      ],

      // Lifecycle rules (can be applied per org or globally)
      lifecycleRules: [
        {
          id: 'DeleteOldAvatarVersions',
          enabled: true,
          // Applies to all user-profile files across all orgs
          // For per-org rules, use prefix: 'org123/user-profile/'
          noncurrentVersionExpirations: [{ days: 7 }],
        },
        {
          id: 'TransitionOldThumbnails',
          enabled: true,
          // Applies to all thumbnails across all orgs
          transitions: [{ days: 90, storageClass: 'INTELLIGENT_TIERING' }],
        },
        {
          // PUBLIC uploads go multipart too (a large ARTICLE cover, a workflow
          // artifact), so the same backstop is required here.
          id: 'AbortIncompleteMultipartUploads',
          enabled: true,
          abortIncompleteMultipartUploadDays: 7,
        },
      ],

      tags: {
        app: 'auxxai',
        stage: $app.stage,
        visibility: 'public',
        cdn: 'enabled',
      },
    },
  },
})

// ============= PRIVATE BUCKET (Presigned URLs) =============

export const privateBucket = new sst.aws.Bucket('PrivateAssets', {
  transform: {
    bucket: {
      bucket: $app.stage === 'production' ? 'auxx-private' : appify('private'), // auxx-private (prod), auxx-dev-private, auxx-local-private

      // CORS for presigned uploads
      corsRules: [
        {
          allowedHeaders: ['*'],
          allowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
          allowedOrigins: [
            'http://localhost:3000',
            'http://localhost:3006',
            'https://*.auxx.ai',
            'https://auxx.ai',
          ],
          exposeHeaders: ['ETag'],
          maxAgeSeconds: 3600,
        },
      ],

      // Aggressive cleanup for private files
      lifecycleRules: [
        {
          // S3 matches a lifecycle prefix from the START of the key, and every
          // key here begins with the org id (`{orgId}/file/temp/...`), so the
          // old `temp/` prefix matched nothing at all — verified against
          // auxx-dev-private, zero objects. No prefix means every object is
          // considered, and only the abort below acts on anything.
          id: 'AbortIncompleteMultipartUploads',
          enabled: true,
          abortIncompleteMultipartUploadDays: 7,
        },
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpirations: [{ days: 30 }],
        },
        {
          id: 'TransitionOldAttachments',
          enabled: true,
          transitions: [
            { days: 90, storageClass: 'INTELLIGENT_TIERING' },
            { days: 365, storageClass: 'GLACIER_IR' },
          ],
        },
      ],
      tags: {
        app: 'auxxai',
        stage: $app.stage,
        visibility: 'private',
        cdn: 'disabled',
      },
    },
    // Block all public access on the private bucket.
    publicAccessBlock: {
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    },
  },
})

// ============= CloudFront CDN for Public Bucket =============

export const publicCdn =
  $app.stage === 'production'
    ? new sst.aws.Cdn('PublicCdn', {
        origins: [
          {
            domainName: publicBucket.domain, // S3 bucket domain
            originId: 'public-s3',
            s3OriginConfig: {
              originAccessIdentity: '', // Public bucket, no OAI needed
            },
          },
        ],

        // Custom domain for production
        domain: 'cdn.auxx.ai',

        defaultCacheBehavior: {
          targetOriginId: 'public-s3',
          viewerProtocolPolicy: 'redirect-to-https',
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachedMethods: ['GET', 'HEAD'],
          compress: true,

          // Aggressive caching for public assets
          minTtl: 0,
          defaultTtl: 86400, // 1 day default
          maxTtl: 31536000, // 1 year max

          forwardedValues: {
            queryString: false,
            cookies: { forward: 'none' },
          },
        },

        // Path-specific cache behaviors (orgId doesn't affect caching logic)
        // CloudFront matches patterns after orgId prefix
        orderedCacheBehaviors: [
          {
            pathPattern: '*/user-profile/*', // Matches: org123/user-profile/*
            targetOriginId: 'public-s3',
            viewerProtocolPolicy: 'redirect-to-https',
            minTtl: 0,
            defaultTtl: 86400, // 1 day for avatars
            maxTtl: 604800, // 1 week max (avatars can change)
            compress: true,
            allowedMethods: ['GET', 'HEAD'],
            cachedMethods: ['GET', 'HEAD'],
            forwardedValues: {
              queryString: false,
              cookies: { forward: 'none' },
            },
          },
          {
            pathPattern: '*/thumbnail/*', // Matches: org123/thumbnail/*
            targetOriginId: 'public-s3',
            viewerProtocolPolicy: 'redirect-to-https',
            minTtl: 0,
            defaultTtl: 2592000, // 30 days for thumbnails
            maxTtl: 31536000, // 1 year max (thumbnails rarely change)
            compress: true,
            allowedMethods: ['GET', 'HEAD'],
            cachedMethods: ['GET', 'HEAD'],
            forwardedValues: {
              queryString: false,
              cookies: { forward: 'none' },
            },
          },
          {
            pathPattern: '*/knowledge-base/*', // Matches: org123/knowledge-base/*
            targetOriginId: 'public-s3',
            viewerProtocolPolicy: 'redirect-to-https',
            minTtl: 0,
            defaultTtl: 86400, // 1 day for KB logos
            maxTtl: 2592000, // 30 days max
            compress: true,
            allowedMethods: ['GET', 'HEAD'],
            cachedMethods: ['GET', 'HEAD'],
            forwardedValues: {
              queryString: false,
              cookies: { forward: 'none' },
            },
          },
        ],
      })
    : undefined

// Export for env config
export const publicBucketName = publicBucket.name
export const privateBucketName = privateBucket.name
export const publicCdnUrl = publicCdn?.url ?? publicBucket.domain
