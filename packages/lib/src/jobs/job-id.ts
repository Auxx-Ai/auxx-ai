// packages/lib/src/jobs/job-id.ts
//
// One place for BullMQ's custom-id rule, because it is invisible until it
// throws and every enqueue that hits it is a door that silently does nothing.

/**
 * Build a custom BullMQ `jobId` from its parts, joined by `-`.
 *
 * 🛑 Every `:` is replaced, in the parts AND the separator. BullMQ rejects a
 * custom id containing a colon unless it splits into exactly three pieces
 * (`Job.addJob`, a compatibility check against old repeatable-job keys), so an
 * id built by interpolating a cursor, a timestamp or a `RecordId` throws
 * `Custom Id cannot contain :` and the caller gets a dropped enqueue.
 *
 * Pure - it imports nothing, so a module can key a job without pulling bullmq
 * and the Redis connection in behind it.
 */
export function jobId(...parts: (string | number)[]): string {
  return parts.join('-').replaceAll(':', '-')
}
