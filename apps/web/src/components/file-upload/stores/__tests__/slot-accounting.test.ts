// apps/web/src/components/file-upload/stores/__tests__/slot-accounting.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { useUploadStore } from '../upload-store'

/**
 * A session is reused for the whole life of its uploader and nothing empties
 * `fileIds`, so `maxFiles` must be charged against files that are still IN FLIGHT.
 * Counting every entry made each completed upload consume a slot permanently: a
 * single-file field accepted exactly one pick per page load and then rejected every
 * later one with "Maximum 1 files allowed" — while the caller had already absorbed
 * that file into its own value list, which is what it derives `maxFiles` from.
 */

/**
 * `reset()` clears sessions and files but leaves `uploaderSessions`, and
 * `createSessionWithGuard` reuses whatever that map points at — so every test
 * mints its own uploader id rather than sharing one.
 */
let seq = 0
function nextUploader(): string {
  seq += 1
  return `field-upload:rec_${seq}:fld_1`
}

function makeFile(name = 'shot.png', type = 'image/png', bytes = 4): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

async function createSession(uploaderId: string): Promise<string> {
  return useUploadStore.getState().createSessionWithGuard(uploaderId, {
    entityType: 'CUSTOM_FIELD',
    entityId: 'field-fld_1',
    behaviorConfig: { allowMultiple: false, autoStart: false },
  })
}

/** Drive a file to a terminal state the way the upload pipeline would. */
function settle(fileId: string, status: 'completed' | 'failed'): void {
  useUploadStore.getState().updateFileStatus(fileId, status)
}

function add(files: File[], uploaderId: string, maxFiles: number, sessionId: string) {
  return useUploadStore.getState().addFilesWithValidation(files, uploaderId, {
    maxFiles,
    sessionId,
  })
}

describe('maxFiles slot accounting', () => {
  beforeEach(() => {
    useUploadStore.getState().reset()
  })

  it('lets a single-file uploader pick again after the previous upload completed', async () => {
    const uploader = nextUploader()
    const sessionId = await createSession(uploader)

    const first = await add([makeFile()], uploader, 1, sessionId)
    expect(first.addedFileIds).toHaveLength(1)
    expect(first.validationErrors).toEqual([])

    settle(first.addedFileIds[0]!, 'completed')

    // The session still holds the completed file — that retention is the regression.
    expect(useUploadStore.getState().sessions[sessionId]!.fileIds).toHaveLength(1)

    const second = await add([makeFile('other.png')], uploader, 1, sessionId)
    expect(second.validationErrors).toEqual([])
    expect(second.addedFileIds).toHaveLength(1)
  })

  it('still refuses a second file while the first is in flight', async () => {
    const uploader = nextUploader()
    const sessionId = await createSession(uploader)

    const first = await add([makeFile()], uploader, 1, sessionId)
    expect(first.addedFileIds).toHaveLength(1)

    // No settle() — the file is still pending, so it owns the only slot.
    const second = await add([makeFile('other.png')], uploader, 1, sessionId)
    expect(second.addedFileIds).toEqual([])
    expect(second.validationErrors).toEqual(['Maximum 1 files allowed'])
  })

  it('does not charge a cancelled file against the cap', async () => {
    // `cancelFile` only flips status — the file stays in the session's fileIds,
    // so an in-flight predicate that misses 'cancelled' eats the slot forever.
    const uploader = nextUploader()
    const sessionId = await createSession(uploader)

    const first = await add([makeFile()], uploader, 1, sessionId)
    useUploadStore.getState().cancelFile(first.addedFileIds[0]!)

    const second = await add([makeFile('other.png')], uploader, 1, sessionId)
    expect(second.validationErrors).toEqual([])
    expect(second.addedFileIds).toHaveLength(1)
  })

  it('reports an in-flight duplicate as skipped, not as a validation error', async () => {
    const uploader = nextUploader()
    const sessionId = await createSession(uploader)

    const first = await add([makeFile()], uploader, 2, sessionId)
    expect(first.addedFileIds).toHaveLength(1)

    // Same name/size/type while the first is still pending — the dedupe drops it,
    // and callers must be able to tell that apart from a rejected pick.
    const dupe = await add([makeFile()], uploader, 2, sessionId)
    expect(dupe.addedFileIds).toEqual([])
    expect(dupe.validationErrors).toEqual([])
    expect(dupe.skippedDuplicates).toEqual(['shot.png'])
  })

  it('does not charge a failed file against the cap', async () => {
    const uploader = nextUploader()
    const sessionId = await createSession(uploader)

    const first = await add([makeFile()], uploader, 1, sessionId)
    settle(first.addedFileIds[0]!, 'failed')

    const retry = await add([makeFile('retry.png')], uploader, 1, sessionId)
    expect(retry.addedFileIds).toHaveLength(1)
  })

  it('counts in-flight files across repeated picks on a multi-file uploader', async () => {
    const uploader = nextUploader()
    const sessionId = await createSession(uploader)

    const a = await add([makeFile('a.png')], uploader, 2, sessionId)
    const b = await add([makeFile('b.png')], uploader, 2, sessionId)
    expect(a.addedFileIds).toHaveLength(1)
    expect(b.addedFileIds).toHaveLength(1)

    // Two in flight, cap of two — the third is refused.
    const c = await add([makeFile('c.png')], uploader, 2, sessionId)
    expect(c.addedFileIds).toEqual([])
    expect(c.validationErrors).toEqual(['Maximum 2 files allowed'])
  })

  it('frees the slots again once the in-flight files complete', async () => {
    const uploader = nextUploader()
    const sessionId = await createSession(uploader)

    const a = await add([makeFile('a.png')], uploader, 2, sessionId)
    const b = await add([makeFile('b.png')], uploader, 2, sessionId)
    settle(a.addedFileIds[0]!, 'completed')
    settle(b.addedFileIds[0]!, 'completed')

    const c = await add([makeFile('c.png')], uploader, 2, sessionId)
    expect(c.addedFileIds).toHaveLength(1)
  })
})

describe('identical-file dedupe', () => {
  beforeEach(() => {
    useUploadStore.getState().reset()
  })

  it('drops a byte-identical file already in flight in the same session', async () => {
    const sessionId = await createSession(nextUploader())

    expect(useUploadStore.getState().addFiles([makeFile()], sessionId)).toHaveLength(1)
    expect(useUploadStore.getState().addFiles([makeFile()], sessionId)).toEqual([])
  })

  it('accepts the same file again once the first one settled', async () => {
    const sessionId = await createSession(nextUploader())

    const first = useUploadStore.getState().addFiles([makeFile()], sessionId)
    settle(first[0]!, 'completed')

    // Re-picking the same image to replace a value is a real upload, not a dupe.
    expect(useUploadStore.getState().addFiles([makeFile()], sessionId)).toHaveLength(1)
  })

  it('accepts the same file again after the first one was cancelled', async () => {
    const sessionId = await createSession(nextUploader())

    const first = useUploadStore.getState().addFiles([makeFile()], sessionId)
    useUploadStore.getState().cancelFile(first[0]!)

    // Cancelling then re-picking the same image is a fresh upload, not a dupe.
    expect(useUploadStore.getState().addFiles([makeFile()], sessionId)).toHaveLength(1)
  })

  it('accepts the same file in a different session', async () => {
    const sessionA = await createSession(nextUploader())
    const sessionB = await createSession(nextUploader())
    expect(sessionA).not.toBe(sessionB)

    expect(useUploadStore.getState().addFiles([makeFile()], sessionA)).toHaveLength(1)
    // The same image on a second record must not be swallowed.
    expect(useUploadStore.getState().addFiles([makeFile()], sessionB)).toHaveLength(1)
  })

  it('does not confuse two different files that share a name', async () => {
    const sessionId = await createSession(nextUploader())

    expect(
      useUploadStore.getState().addFiles([makeFile('shot.png', 'image/png', 4)], sessionId)
    ).toHaveLength(1)
    expect(
      useUploadStore.getState().addFiles([makeFile('shot.png', 'image/png', 9)], sessionId)
    ).toHaveLength(1)
  })
})
