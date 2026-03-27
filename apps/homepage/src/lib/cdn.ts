// apps/homepage/src/lib/cdn.ts

/** Base URL for static assets served from S3. Swap to CloudFront CDN URL once deployed. */
export const CDN_URL = 'https://auxx-public.s3.us-west-1.amazonaws.com/homepage'

/** Returns the full CDN URL for a video file. */
export function videoUrl(filename: string) {
  return `${CDN_URL}/videos/${filename}`
}
