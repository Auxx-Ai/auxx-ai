// apps/web/src/components/manufacturing/builds/build-sheet-store.ts
'use client'

import { create } from 'zustand'

/** What the build sheet shows: one build, or one batch run's builds. */
export type BuildSheetFrame =
  | { kind: 'build'; buildId: string }
  | { kind: 'run'; runNumber: number }

interface BuildSheetState {
  /** Base first, top last; empty when the sheet is closed. */
  frames: BuildSheetFrame[]
  /** Push a frame onto an open sheet, or open it on this frame. */
  open: (frame: BuildSheetFrame) => void
  back: () => void
  close: () => void
}

const sameFrame = (a: BuildSheetFrame, b: BuildSheetFrame) =>
  a.kind === 'build' && b.kind === 'build'
    ? a.buildId === b.buildId
    : a.kind === 'run' && b.kind === 'run' && a.runNumber === b.runNumber

/** The one build sheet, mounted by `BuildSheetRoot`. */
export const useBuildSheetStore = create<BuildSheetState>((set) => ({
  frames: [],
  open: (frame) =>
    set(({ frames }) => {
      // Already on the stack: truncate back to it rather than stacking a cycle.
      const existing = frames.findIndex((f) => sameFrame(f, frame))
      return { frames: existing >= 0 ? frames.slice(0, existing + 1) : [...frames, frame] }
    }),
  back: () => set(({ frames }) => ({ frames: frames.slice(0, -1) })),
  close: () => set({ frames: [] }),
}))

/** Open a build in the sheet, from anywhere. */
export function openBuildSheet(buildId: string): void {
  useBuildSheetStore.getState().open({ kind: 'build', buildId })
}

/** Open a batch run's builds in the sheet, from anywhere. */
export function openBatchRunSheet(runNumber: number): void {
  useBuildSheetStore.getState().open({ kind: 'run', runNumber })
}
