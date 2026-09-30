// apps/web/src/components/manufacturing/builds/build-sheet-store.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { openBatchRunSheet, openBuildSheet, useBuildSheetStore } from './build-sheet-store'

const frames = () => useBuildSheetStore.getState().frames

beforeEach(() => {
  useBuildSheetStore.getState().close()
})

describe('the build sheet stack', () => {
  it('opens on a build and stacks another opened from inside it', () => {
    openBuildSheet('b1')
    openBatchRunSheet(7)
    openBuildSheet('b2')
    expect(frames()).toEqual([
      { kind: 'build', buildId: 'b1' },
      { kind: 'run', runNumber: 7 },
      { kind: 'build', buildId: 'b2' },
    ])
  })

  it('goes back one frame at a time', () => {
    openBuildSheet('b1')
    openBuildSheet('b2')
    useBuildSheetStore.getState().back()
    expect(frames()).toEqual([{ kind: 'build', buildId: 'b1' }])
  })

  it('truncates back to a frame already on the stack instead of stacking a cycle', () => {
    openBuildSheet('b1')
    openBatchRunSheet(7)
    openBuildSheet('b2')
    openBuildSheet('b1')
    expect(frames()).toEqual([{ kind: 'build', buildId: 'b1' }])

    openBatchRunSheet(7)
    openBuildSheet('b2')
    openBatchRunSheet(7)
    expect(frames()).toEqual([
      { kind: 'build', buildId: 'b1' },
      { kind: 'run', runNumber: 7 },
    ])
  })

  it('does not confuse a build with a run', () => {
    openBuildSheet('7')
    openBatchRunSheet(7)
    expect(frames()).toHaveLength(2)
  })

  it('clears every frame on close', () => {
    openBuildSheet('b1')
    openBuildSheet('b2')
    useBuildSheetStore.getState().close()
    expect(frames()).toEqual([])
  })
})
