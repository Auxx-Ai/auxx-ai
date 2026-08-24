// apps/web/src/components/file-upload/stores/__tests__/session-orchestration.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeUploadTransport } from '../../transport/__fixtures__/fake-upload-transport'
import type { DirectUploadResult } from '../../transport/types'
import { useUploadStore } from '../upload-store'

/**
 * Orchestration state used to live in three module-level `Map`s plus a global
 * `activeSessionId` that `startUploadForSession` reassigned around every call. Two
 * uploaders in one tab therefore raced on the same three globals, and none of it was
 * reachable from a test: the maps outlived `reset()`, so a run left in flight by one
 * test blocked the next one.
 *
 * These tests upload through the substituted transport from PR 8a — no `fetch` stub,
 * no URL matching — and read the per-session run state directly, which is the point
 * of moving it onto the store.
 */

/**
 * A transport whose object writes hang until released by name.
 *
 * The gate map lives in this closure rather than on the transport object: the
 * transport is assigned into an Immer draft by `setTransport`, and Immer deep-freezes
 * plain objects and arrays it finds there — a frozen `Map` field would throw, and a
 * frozen array would swallow every `push` in silence.
 */
function gatedTransport() {
  const gates = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  const aborted: string[] = []

  const transport = createFakeUploadTransport({
    uploadObject: (params) => {
      const name = params.file.name
      let resolveGate: () => void = () => {}
      let rejectGate: (error: Error) => void = () => {}
      const promise = new Promise<DirectUploadResult>((resolve, reject) => {
        resolveGate = () => resolve({ etag: `etag_${name}` })
        rejectGate = reject
      })
      gates.set(name, { resolve: resolveGate, reject: rejectGate })
      return {
        abort: () => {
          aborted.push(name)
          rejectGate(new Error('Upload aborted'))
        },
        promise,
      }
    },
  })

  return {
    transport,
    /** Files whose bytes are being written right now. */
    pending: () => [...gates.keys()],
    /** Files whose upload handle was aborted, in call order. */
    aborted: () => [...aborted],
    release: (name: string) => gates.get(name)?.resolve(),
    /** Resolve once the named file's write has actually started. */
    waitForPending: (name: string) => vi.waitFor(() => expect(gates.has(name)).toBe(true)),
  }
}

function addFile(sessionId: string, name: string): string {
  const file = new File([new Uint8Array(4)], name, { type: 'image/jpeg' })
  const [id] = useUploadStore.getState().addFiles([file], sessionId)
  if (!id) throw new Error(`file ${name} was not added`)
  return id
}

function newSession(entityId: string) {
  return useUploadStore.getState().createSession({ entityType: 'FILE', entityId })
}

describe('per-session upload runs', () => {
  beforeEach(() => {
    useUploadStore.getState().reset()
  })

  it('does not trade activeSessionId between two sessions uploading at once', async () => {
    const gated = gatedTransport()
    useUploadStore.getState().setTransport(gated.transport)

    const sessionA = await newSession('fld_a')
    addFile(sessionA, 'a1.jpg')
    const sessionB = await newSession('fld_b')
    addFile(sessionB, 'b1.jpg')

    // Creating B selected it. Uploading must not change that, in either direction.
    expect(useUploadStore.getState().activeSessionId).toBe(sessionB)

    const runA = useUploadStore.getState().startUpload(sessionA)
    const runB = useUploadStore.getState().startUpload(sessionB)
    await gated.waitForPending('a1.jpg')
    await gated.waitForPending('b1.jpg')

    expect(useUploadStore.getState().activeSessionId).toBe(sessionB)

    // B finishes first, while A is still writing bytes. The old implementation
    // restored the `activeSessionId` it had captured on entry — which was A, because
    // A's own call had already overwritten the global — leaving the store pointed at a
    // session the user never selected.
    gated.release('b1.jpg')
    const resultB = await runB
    expect(useUploadStore.getState().activeSessionId).toBe(sessionB)

    gated.release('a1.jpg')
    const resultA = await runA
    expect(useUploadStore.getState().activeSessionId).toBe(sessionB)

    // Neither batch saw the other's file.
    expect(resultA.results.map((r) => r.filename)).toEqual(['a1.jpg'])
    expect(resultB.results.map((r) => r.filename)).toEqual(['b1.jpg'])
    expect(resultA.successCount).toBe(1)
    expect(resultB.successCount).toBe(1)

    const sessions = useUploadStore.getState().sessions
    expect(sessions[sessionA]?.uploadResult?.results.map((r) => r.filename)).toEqual(['a1.jpg'])
    expect(sessions[sessionB]?.uploadResult?.results.map((r) => r.filename)).toEqual(['b1.jpg'])
  })

  it('keeps the global uploading flag set while another session is still running', async () => {
    const gated = gatedTransport()
    useUploadStore.getState().setTransport(gated.transport)

    const sessionA = await newSession('fld_a')
    addFile(sessionA, 'a1.jpg')
    const sessionB = await newSession('fld_b')
    addFile(sessionB, 'b1.jpg')

    const runA = useUploadStore.getState().startUpload(sessionA)
    const runB = useUploadStore.getState().startUpload(sessionB)
    await gated.waitForPending('a1.jpg')
    await gated.waitForPending('b1.jpg')

    expect(Object.keys(useUploadStore.getState().sessionRuns).sort()).toEqual(
      [sessionA, sessionB].sort()
    )
    expect(useUploadStore.getState().uploading).toBe(true)

    gated.release('b1.jpg')
    await runB

    // A is still uploading, so the flag its spinner reads must stay true.
    expect(useUploadStore.getState().uploading).toBe(true)
    expect(useUploadStore.getState().sessions[sessionB]?.uploading).toBe(false)
    expect(useUploadStore.getState().sessions[sessionA]?.uploading).toBe(true)

    gated.release('a1.jpg')
    await runA

    expect(useUploadStore.getState().uploading).toBe(false)
    expect(useUploadStore.getState().sessionRuns).toEqual({})
  })

  it('joins the run already in flight instead of uploading the same files twice', async () => {
    const gated = gatedTransport()
    useUploadStore.getState().setTransport(gated.transport)

    const sessionId = await newSession('fld_a')
    addFile(sessionId, 'a1.jpg')

    const first = useUploadStore.getState().startUpload(sessionId)
    const second = useUploadStore.getState().startUpload(sessionId)
    // The deprecated alias is the same run, not a third one.
    const third = useUploadStore.getState().startUploadForSession(sessionId)
    await gated.waitForPending('a1.jpg')

    gated.release('a1.jpg')
    const [a, b, c] = await Promise.all([first, second, third])

    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(gated.transport.createdSessions()).toHaveLength(1)
    expect(gated.transport.completedSessions()).toHaveLength(1)
  })

  it('reset() clears the in-flight run map that the module-level Map used to survive', async () => {
    const gated = gatedTransport()
    useUploadStore.getState().setTransport(gated.transport)

    const sessionId = await newSession('fld_a')
    addFile(sessionId, 'a1.jpg')

    const run = useUploadStore.getState().startUpload(sessionId)
    await gated.waitForPending('a1.jpg')
    expect(Object.keys(useUploadStore.getState().sessionRuns)).toEqual([sessionId])

    useUploadStore.getState().reset()
    expect(useUploadStore.getState().sessionRuns).toEqual({})
    expect(useUploadStore.getState().uploaderRuns).toEqual({})

    // Let the abandoned run settle so it cannot leak into the next test.
    gated.release('a1.jpg')
    await run
  })

  it('cancels only the named session, leaving a second session uploading', async () => {
    const gated = gatedTransport()
    useUploadStore.getState().setTransport(gated.transport)

    const sessionA = await newSession('fld_a')
    addFile(sessionA, 'a1.jpg')
    const sessionB = await newSession('fld_b')
    addFile(sessionB, 'b1.jpg')

    const runA = useUploadStore.getState().startUpload(sessionA)
    const runB = useUploadStore.getState().startUpload(sessionB)
    await gated.waitForPending('a1.jpg')
    await gated.waitForPending('b1.jpg')

    useUploadStore.getState().cancelUpload(sessionA)
    const resultA = await runA

    // The blanket `Object.values(inFlight).forEach(abort)` aborted every uploader on
    // the page, not just this session's files.
    expect(gated.aborted()).toEqual(['a1.jpg'])
    expect(resultA.successCount).toBe(0)
    expect(useUploadStore.getState().sessions[sessionA]?.status).toBe('cancelled')

    gated.release('b1.jpg')
    const resultB = await runB

    expect(resultB.successCount).toBe(1)
    expect(useUploadStore.getState().sessions[sessionB]?.status).not.toBe('cancelled')
  })

  it('retries a session that is not the selected one', async () => {
    useUploadStore.getState().setTransport(createFakeUploadTransport())

    const sessionA = await newSession('fld_a')
    const fileId = addFile(sessionA, 'a1.jpg')
    useUploadStore.getState().setFileError(fileId, 'Upload failed')

    // Selecting another session must not decide whether A's retry does anything.
    const sessionB = await newSession('fld_b')
    expect(useUploadStore.getState().activeSessionId).toBe(sessionB)

    await useUploadStore.getState().retrySession(sessionA)

    expect(useUploadStore.getState().files[fileId]?.status).toBe('completed')
  })

  it('leaves a session with nothing pending marked idle', async () => {
    useUploadStore.getState().setTransport(createFakeUploadTransport())

    const sessionId = await newSession('fld_a')
    const result = await useUploadStore.getState().startUpload(sessionId)

    expect(result.totalFiles).toBe(0)
    // The early return used to skip the flag reset, so the session read as uploading
    // forever — which is the flag consumers check before dropping a completion handler.
    expect(useUploadStore.getState().sessions[sessionId]?.uploading).toBe(false)
    expect(useUploadStore.getState().sessionRuns).toEqual({})
  })
})

describe('per-uploader session creation', () => {
  beforeEach(() => {
    useUploadStore.getState().reset()
  })

  it('registers one creation guard per uploader and clears it when it settles', async () => {
    const uploaderId = 'uploader_guard_1'
    const store = useUploadStore.getState()

    const first = store.createSessionWithGuard(uploaderId, { entityType: 'FILE', entityId: 'f_1' })
    // Registered synchronously, so a second caller in the same tick joins it.
    expect(Object.keys(useUploadStore.getState().uploaderRuns)).toEqual([uploaderId])
    const second = store.createSessionWithGuard(uploaderId, { entityType: 'FILE', entityId: 'f_1' })

    expect(await second).toBe(await first)
    expect(Object.keys(useUploadStore.getState().sessions)).toHaveLength(1)
    expect(useUploadStore.getState().uploaderRuns).toEqual({})
  })

  it('cleanupUploader aborts the creation still in flight', async () => {
    const uploaderId = 'uploader_guard_2'
    const creating = useUploadStore
      .getState()
      .createSessionWithGuard(uploaderId, { entityType: 'FILE', entityId: 'f_1' })

    useUploadStore.getState().cleanupUploader(uploaderId)

    await expect(creating).rejects.toThrow('Session creation cancelled')
    expect(useUploadStore.getState().uploaderRuns).toEqual({})
    expect(useUploadStore.getState().uploaderSessions[uploaderId]).toBeUndefined()
  })
})
