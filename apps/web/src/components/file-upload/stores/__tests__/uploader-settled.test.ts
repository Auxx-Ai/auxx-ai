// apps/web/src/components/file-upload/stores/__tests__/uploader-settled.test.ts

import type { BatchUploadResult } from '@auxx/lib/files/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeUploadTransport } from '../../transport/__fixtures__/fake-upload-transport'
import type { DirectUploadResult } from '../../transport/types'
import { useUploadStore } from '../upload-store'

/**
 * `onUploaderSettled` and the wave-draining run.
 *
 * The completion API replaces a module-level `Map` of handlers, a re-entrancy `Set`,
 * a `subscriptionActive` flag, a 30-minute staleness sweep and a one-shot latch on
 * the session — all of which lived in `use-field-file-upload.ts` because the store
 * had no per-uploader completion callback that survives a React unmount.
 *
 * The draining run is what makes the join guard honest: `startUpload` on a session
 * already uploading returns the run in flight, and that run now carries files added
 * after it started instead of stranding them.
 */

/** A transport whose object writes hang until released by name. See the note in
 *  `session-orchestration.test.ts`: the gate map must stay in this closure, because
 *  Immer replaces `add`/`set`/`delete` on any collection it freezes into the store. */
function gatedTransport() {
  const gates = new Map<string, { resolve: () => void }>()

  const transport = createFakeUploadTransport({
    uploadObject: (params) => {
      const name = params.file.name
      let resolveGate: () => void = () => {}
      const promise = new Promise<DirectUploadResult>((resolve) => {
        resolveGate = () => resolve({ etag: `etag_${name}` })
      })
      gates.set(name, { resolve: resolveGate })
      return { abort: () => {}, promise }
    },
  })

  return {
    transport,
    release: (name: string) => gates.get(name)?.resolve(),
    waitForPending: (name: string) => vi.waitFor(() => expect(gates.has(name)).toBe(true)),
  }
}

function addFile(sessionId: string, name: string): string {
  const file = new File([new Uint8Array(4)], name, { type: 'image/jpeg' })
  const [id] = useUploadStore.getState().addFiles([file], sessionId)
  if (!id) throw new Error(`file ${name} was not added`)
  return id
}

function newUploaderSession(uploaderId: string) {
  return useUploadStore
    .getState()
    .createSessionWithGuard(uploaderId, { entityType: 'FILE', entityId: 'fld_a' })
}

describe('files added while a run is in flight', () => {
  beforeEach(() => {
    useUploadStore.getState().reset()
  })

  it('are uploaded by the run already in flight, not stranded', async () => {
    const gated = gatedTransport()
    useUploadStore.getState().setTransport(gated.transport)

    const sessionId = await useUploadStore
      .getState()
      .createSession({ entityType: 'FILE', entityId: 'fld_a' })
    addFile(sessionId, 'a1.jpg')

    const run = useUploadStore.getState().startUpload(sessionId)
    await gated.waitForPending('a1.jpg')

    // The second pick lands mid-run. The join guard hands this caller the same
    // promise, which is only correct if that promise also covers 'a2.jpg'.
    addFile(sessionId, 'a2.jpg')
    const joined = useUploadStore.getState().startUpload(sessionId)

    gated.release('a1.jpg')
    await gated.waitForPending('a2.jpg')
    gated.release('a2.jpg')

    const result = await run
    expect(await joined).toBe(result)
    expect(result.results.map((r) => r.filename)).toEqual(['a1.jpg', 'a2.jpg'])
    expect(result.successCount).toBe(2)
    expect(result.totalFiles).toBe(2)
    expect(gated.transport.completedSessions()).toHaveLength(2)
  })

  it('does not re-claim a file that already failed in an earlier wave', async () => {
    let attempts = 0
    useUploadStore.getState().setTransport(
      createFakeUploadTransport({
        createSession: async () => {
          attempts += 1
          throw new Error('presign refused')
        },
      })
    )

    const sessionId = await useUploadStore
      .getState()
      .createSession({ entityType: 'FILE', entityId: 'fld_a' })
    addFile(sessionId, 'a1.jpg')

    // A failed file reads as `failed`, which is exactly what the pending filter
    // admits — so a naive drain loop would retry it forever.
    const result = await useUploadStore.getState().startUpload(sessionId)

    expect(attempts).toBe(1)
    expect(result.failedCount).toBe(1)
    expect(result.successCount).toBe(0)
  })

  it('reports only the files THIS run processed, not everything the session held', async () => {
    useUploadStore.getState().setTransport(createFakeUploadTransport())

    const sessionId = await useUploadStore
      .getState()
      .createSession({ entityType: 'FILE', entityId: 'fld_a' })
    addFile(sessionId, 'first.jpg')
    const first = await useUploadStore.getState().startUpload(sessionId)
    expect(first.results.map((r) => r.filename)).toEqual(['first.jpg'])

    addFile(sessionId, 'second.jpg')
    const second = await useUploadStore.getState().startUpload(sessionId)

    // `totalFiles` used to count every file the session had ever held while
    // `successCount` counted only this run's, so the two halves disagreed.
    expect(second.results.map((r) => r.filename)).toEqual(['second.jpg'])
    expect(second.totalFiles).toBe(1)
    expect(second.successCount).toBe(1)
  })
})

describe('onUploaderSettled', () => {
  beforeEach(() => {
    useUploadStore.getState().reset()
  })

  it('delivers the run result once, after the store is up to date', async () => {
    useUploadStore.getState().setTransport(createFakeUploadTransport())
    const uploaderId = 'uploader_settled_1'
    const sessionId = await newUploaderSession(uploaderId)

    const seen: BatchUploadResult[] = []
    const statusesAtDelivery: Array<string | undefined> = []
    const off = useUploadStore.getState().onUploaderSettled(uploaderId, (result) => {
      seen.push(result)
      statusesAtDelivery.push(
        useUploadStore.getState().files[result.results[0]?.fileId ?? '']?.status
      )
    })

    const fileId = addFile(sessionId, 'a1.jpg')
    const result = await useUploadStore.getState().startUpload(sessionId)

    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(result)
    expect(seen[0]?.results.map((r) => r.fileId)).toEqual([fileId])
    // The handler must see settled state, not the state mid-run.
    expect(statusesAtDelivery).toEqual(['completed'])
    expect(useUploadStore.getState().sessions[sessionId]?.uploading).toBe(false)

    off()
  })

  it('delivers again on the next run, with no latch to re-arm', async () => {
    useUploadStore.getState().setTransport(createFakeUploadTransport())
    const uploaderId = 'uploader_settled_2'
    const sessionId = await newUploaderSession(uploaderId)

    const seen: BatchUploadResult[] = []
    const off = useUploadStore.getState().onUploaderSettled(uploaderId, (r) => seen.push(r))

    addFile(sessionId, 'a1.jpg')
    await useUploadStore.getState().startUpload(sessionId)
    addFile(sessionId, 'a2.jpg')
    await useUploadStore.getState().startUpload(sessionId)

    // The old sweep kept a one-shot `__fieldNotifiedComplete` flag on the session,
    // so every pick after the first uploaded fine and never notified anyone.
    expect(seen.map((r) => r.results.map((x) => x.filename))).toEqual([['a1.jpg'], ['a2.jpg']])

    off()
  })

  it('keeps one handler per uploader: re-registering replaces, it does not stack', async () => {
    useUploadStore.getState().setTransport(createFakeUploadTransport())
    const uploaderId = 'uploader_settled_3'
    const sessionId = await newUploaderSession(uploaderId)

    const calls: string[] = []
    const offFirst = useUploadStore.getState().onUploaderSettled(uploaderId, () => {
      calls.push('first')
    })
    useUploadStore.getState().onUploaderSettled(uploaderId, () => {
      calls.push('second')
    })

    addFile(sessionId, 'a1.jpg')
    await useUploadStore.getState().startUpload(sessionId)

    expect(calls).toEqual(['second'])

    // The stale unsubscribe must not take the live registration with it — an
    // unmounting duplicate of the same field would otherwise silence the survivor.
    offFirst()
    expect(useUploadStore.getState().uploaderSettledHandlers[uploaderId]).toBeDefined()
  })

  it('stops delivering once unsubscribed, and never fires for another uploader', async () => {
    useUploadStore.getState().setTransport(createFakeUploadTransport())
    const uploaderId = 'uploader_settled_4'
    const otherId = 'uploader_settled_5'
    const sessionId = await newUploaderSession(uploaderId)
    await newUploaderSession(otherId)

    const mine: BatchUploadResult[] = []
    const theirs: BatchUploadResult[] = []
    const off = useUploadStore.getState().onUploaderSettled(uploaderId, (r) => mine.push(r))
    const offOther = useUploadStore.getState().onUploaderSettled(otherId, (r) => theirs.push(r))

    addFile(sessionId, 'a1.jpg')
    await useUploadStore.getState().startUpload(sessionId)
    expect(mine).toHaveLength(1)
    expect(theirs).toHaveLength(0)

    off()
    addFile(sessionId, 'a2.jpg')
    await useUploadStore.getState().startUpload(sessionId)
    expect(mine).toHaveLength(1)

    offOther()
  })

  it('survives reset(), because a reset clears the work and not the wiring', async () => {
    useUploadStore.getState().setTransport(createFakeUploadTransport())
    const uploaderId = 'uploader_settled_6'
    const seen: BatchUploadResult[] = []
    const off = useUploadStore.getState().onUploaderSettled(uploaderId, (r) => seen.push(r))

    useUploadStore.getState().reset()
    useUploadStore.getState().setTransport(createFakeUploadTransport())

    const sessionId = await newUploaderSession(uploaderId)
    addFile(sessionId, 'a1.jpg')
    await useUploadStore.getState().startUpload(sessionId)

    expect(seen).toHaveLength(1)
    off()
  })

  it('does not throw out of the run when a handler throws', async () => {
    useUploadStore.getState().setTransport(createFakeUploadTransport())
    const uploaderId = 'uploader_settled_7'
    const sessionId = await newUploaderSession(uploaderId)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const off = useUploadStore.getState().onUploaderSettled(uploaderId, () => {
      throw new Error('handler blew up')
    })

    addFile(sessionId, 'a1.jpg')
    await expect(useUploadStore.getState().startUpload(sessionId)).resolves.toMatchObject({
      successCount: 1,
    })

    off()
    consoleError.mockRestore()
  })
})
