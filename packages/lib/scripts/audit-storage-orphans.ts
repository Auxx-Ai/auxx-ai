// packages/lib/scripts/audit-storage-orphans.ts
//
// DEV-ONLY. Finds storage nothing points at, per organization, in three layers:
//
//   1. S3 objects under the org's upload prefixes with no `StorageLocation` row -> deleted.
//   2. Live `StorageLocation` rows under those prefixes nothing reads -> marked for
//      `reapMarkedStorageLocations` (deletedFileCleanupJob, 02:00, rows older than 24 h).
//   3. Live FILE-field assets (`SYSTEM_BLOB`, `TEMP_UPLOAD`) no record, attachment or
//      owning row holds -> released the way a record delete releases them.
//      Other kinds are counted, never touched.
//
//   npx dotenv -- node --conditions=source --import tsx/esm \
//     packages/lib/scripts/audit-storage-orphans.ts DemoOrg1 [--all-orgs] [--prefix email/inbound/{org}/] [--confirm]
//
// Read-only without `--confirm`. Nothing younger than `--min-age-hours` (24) is touched,
// so an upload in flight is never an orphan.

import { database as db, schema } from '@auxx/database'
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  S3Client,
} from '@aws-sdk/client-s3'
import { and, eq, inArray, isNull, like, lt, or, sql } from 'drizzle-orm'
import { releaseAssets } from '../src/files/assets/release-record-assets'

const args = process.argv.slice(2)
const CONFIRM = args.includes('--confirm')
const ALL_ORGS = args.includes('--all-orgs')
const ORG_ARG = args.find((a) => !a.startsWith('--') && !isFlagValue(a))
const MIN_AGE_HOURS = Number(flagValue('--min-age-hours') ?? 24)
const EXTRA_PREFIXES = args.flatMap((a, i) => (args[i - 1] === '--prefix' ? [a] : []))

/** Layouts where every object is written through a `StorageLocation`. `{org}` is substituted. */
const DEFAULT_PREFIXES = ['{org}/', 'thumbs/{org}/', '/thumbs/{org}/']

/** Asset kinds only FILE field values hold; anything else has holders this script cannot see. */
const RELEASABLE_KINDS = ['SYSTEM_BLOB', 'TEMP_UPLOAD']

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function isFlagValue(arg: string): boolean {
  const i = args.indexOf(arg)
  return i > 0 && ['--min-age-hours', '--prefix'].includes(args[i - 1] ?? '')
}

function scannedPrefixes(organizationId: string): string[] {
  return [...DEFAULT_PREFIXES, ...EXTRA_PREFIXES].map((t) => t.replaceAll('{org}', organizationId))
}

function* chunked<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let offset = 0; offset < items.length; offset += size)
    yield items.slice(offset, offset + size)
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function resolveOrgs(): Promise<{ id: string; name: string | null }[]> {
  if (ALL_ORGS) {
    return db
      .select({ id: schema.Organization.id, name: schema.Organization.name })
      .from(schema.Organization)
  }
  if (!ORG_ARG) {
    console.error(
      'usage: audit-storage-orphans.ts <organizationId|name> | --all-orgs [--prefix p] [--min-age-hours n] [--confirm]'
    )
    process.exit(1)
  }
  const rows = await db
    .select({ id: schema.Organization.id, name: schema.Organization.name })
    .from(schema.Organization)
    .where(
      sql`${schema.Organization.id} = ${ORG_ARG} or ${schema.Organization.name} ilike ${ORG_ARG}`
    )
  if (rows.length !== 1) {
    console.error(`'${ORG_ARG}' matches ${rows.length} organizations`)
    process.exit(1)
  }
  return rows
}

/** Layer 1: objects under the org's prefixes that no `StorageLocation` row names. */
async function strayObjects(
  s3: S3Client,
  bucket: string,
  organizationId: string,
  known: ReadonlySet<string>,
  cutoff: Date
): Promise<{ key: string; size: number }[]> {
  const stray: { key: string; size: number }[] = []
  for (const prefix of scannedPrefixes(organizationId)) {
    let token: string | undefined
    do {
      const page: ListObjectsV2CommandOutput = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
      )
      for (const object of page.Contents ?? []) {
        if (!object.Key || known.has(object.Key)) continue
        if (object.LastModified && object.LastModified > cutoff) continue
        stray.push({ key: object.Key, size: object.Size ?? 0 })
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
  }
  return stray
}

/** Layer 2: live locations nothing reads. */
async function unreadLocations(organizationId: string, cutoff: Date) {
  return db
    .select({
      id: schema.StorageLocation.id,
      key: schema.StorageLocation.externalId,
      size: schema.StorageLocation.size,
    })
    .from(schema.StorageLocation)
    .where(
      and(
        eq(schema.StorageLocation.organizationId, organizationId),
        isNull(schema.StorageLocation.deletedAt),
        lt(schema.StorageLocation.createdAt, cutoff),
        or(
          ...scannedPrefixes(organizationId).map((p) =>
            like(schema.StorageLocation.externalId, `${p}%`)
          )
        ),
        sql`not exists (select 1 from "MediaAssetVersion" v where v."storageLocationId" = ${schema.StorageLocation.id})`,
        sql`not exists (select 1 from "FileVersion" v where v."storageLocationId" = ${schema.StorageLocation.id})`,
        sql`not exists (select 1 from "ExportJob" j where j."storageLocationId" = ${schema.StorageLocation.id})`,
        sql`not exists (select 1 from "Message" m where m."htmlBodyStorageLocationId" = ${schema.StorageLocation.id})`
      )
    )
}

/** Layer 3: live, non-derived assets no known holder names, grouped by kind. */
async function unheldAssets(organizationId: string, cutoff: Date) {
  const asset = schema.MediaAsset
  return db
    .select({ id: asset.id, kind: asset.kind })
    .from(asset)
    .where(
      and(
        eq(asset.organizationId, organizationId),
        isNull(asset.deletedAt),
        lt(asset.createdAt, cutoff),
        sql`${asset.kind} <> 'THUMBNAIL' and ${asset.purpose} <> 'DERIVED'`,
        sql`(${asset.expiresAt} is null or ${asset.expiresAt} < now())`,
        sql`not exists (select 1 from "MediaAssetVersion" v where v."assetId" = ${asset.id} and v."derivedFromVersionId" is not null)`,
        sql`not exists (select 1 from "FieldValue" f where f."assetId" = ${asset.id})`,
        sql`not exists (select 1 from "Attachment" a where a."assetId" = ${asset.id} and a."entityType" <> 'CUSTOM_FIELD')`,
        sql`not exists (select 1 from "User" u where u."avatarAssetId" = ${asset.id})`,
        sql`not exists (select 1 from "KnowledgeBase" k where ${asset.id} in (k."logoDarkId", k."logoLightId"))`,
        sql`not exists (select 1 from "ChatWidget" w where ${asset.id} in (w."logoDarkId", w."logoLightId"))`,
        sql`not exists (select 1 from "Document" d where d."mediaAssetId" = ${asset.id})`,
        sql`not exists (select 1 from "ArticleRevision" r where r."coverImageId" = ${asset.id})`,
        sql`not exists (select 1 from "CallRecording" c where ${asset.id} in
              (c."videoAssetId", c."audioAssetId", c."videoPreviewAssetId", c."videoStoryboardAssetId"))`
      )
    )
}

async function main() {
  const region = process.env.S3_REGION ?? process.env.AWS_REGION
  const buckets = [process.env.S3_PUBLIC_BUCKET, process.env.S3_PRIVATE_BUCKET].filter(
    (b): b is string => !!b
  )
  if (!region || buckets.length === 0) {
    console.error(
      'S3_REGION and S3_PUBLIC_BUCKET / S3_PRIVATE_BUCKET must be set (run through dotenv)'
    )
    process.exit(1)
  }
  const s3 = new S3Client({ region })
  const cutoff = new Date(Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000)
  const now = new Date()

  console.log(`mode     ${CONFIRM ? 'WRITE' : 'dry run (pass --confirm to write)'}`)
  console.log(`buckets  ${buckets.join(', ')}`)
  console.log(`prefixes ${[...DEFAULT_PREFIXES, ...EXTRA_PREFIXES].join('  ')}`)
  console.log(`min age  ${MIN_AGE_HOURS} h\n`)

  for (const org of await resolveOrgs()) {
    console.log(`── ${org.name ?? '?'} (${org.id})`)

    // Every row, marked or not: a marked row's object is the reaper's, not a stray.
    const locations = await db
      .select({ key: schema.StorageLocation.externalId, metadata: schema.StorageLocation.metadata })
      .from(schema.StorageLocation)
      .where(eq(schema.StorageLocation.organizationId, org.id))
    for (const bucket of buckets) {
      // A row without `metadata.bucket` counts as known in every bucket rather than guessed.
      const known = new Set(
        locations
          .filter((l) => {
            const recorded = (l.metadata as { bucket?: string } | null)?.bucket
            return !recorded || recorded === bucket
          })
          .map((l) => l.key)
      )
      const stray = await strayObjects(s3, bucket, org.id, known, cutoff)
      const bytes = stray.reduce((a, o) => a + o.size, 0)
      console.log(`  1. ${bucket}: ${stray.length} stray object(s), ${mb(bytes)}`)
      for (const o of stray.slice(0, 5)) console.log(`       ${o.key}`)
      if (CONFIRM) {
        for (const chunk of chunked(stray, 1000)) {
          const result = await s3.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: chunk.map((o) => ({ Key: o.key })), Quiet: true },
            })
          )
          for (const e of result.Errors ?? []) console.error(`       failed ${e.Key}: ${e.Message}`)
        }
      }
    }

    const unread = await unreadLocations(org.id, cutoff)
    const unreadBytes = unread.reduce((a, l) => a + Number(l.size ?? 0), 0)
    console.log(`  2. ${unread.length} StorageLocation row(s) nothing reads, ${mb(unreadBytes)}`)
    for (const l of unread.slice(0, 5)) console.log(`       ${l.key}`)
    if (CONFIRM) {
      for (const chunk of chunked(
        unread.map((l) => l.id),
        1000
      )) {
        await db
          .update(schema.StorageLocation)
          .set({ deletedAt: now })
          .where(
            and(
              eq(schema.StorageLocation.organizationId, org.id),
              inArray(schema.StorageLocation.id, chunk)
            )
          )
      }
    }

    const unheld = await unheldAssets(org.id, cutoff)
    const byKind = new Map<string, string[]>()
    for (const a of unheld) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a.id])
    console.log(`  3. ${unheld.length} asset(s) no known holder names`)
    for (const [kind, ids] of byKind) {
      const releasable = RELEASABLE_KINDS.includes(kind)
      console.log(
        `       ${kind.padEnd(18)} ${String(ids.length).padStart(5)}  ${releasable ? 'release' : 'report only'}`
      )
    }
    if (CONFIRM) {
      const releasable = unheld.filter((a) => RELEASABLE_KINDS.includes(a.kind)).map((a) => a.id)
      let released = 0
      for (const chunk of chunked(releasable, 500)) {
        released += await releaseAssets(db, { organizationId: org.id, assetIds: chunk, now })
      }
      console.log(`       released ${released} asset(s) incl. thumbnails`)
    }
    console.log('')
  }

  if (!CONFIRM) console.log('dry run — nothing was written. Re-run with --confirm.')
  else
    console.log('done. Marked locations are reaped by deletedFileCleanupJob (02:00, > 24 h old).')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
