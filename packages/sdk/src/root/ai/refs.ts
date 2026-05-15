// packages/sdk/src/root/ai/refs.ts

import { z } from 'zod/v4'
import type { EntityRefKind } from './types.js'

/**
 * `auxxRef` markers attach to string nodes via zod's `.meta()`. The marker is
 * preserved into the published AI tool catalog (so the snapshot walker can
 * mine ids out of tool outputs) and is stripped from the LLM-facing JSON
 * Schema by the converter — the LLM doesn't need to see internal metadata.
 *
 * See plans/kopilot/apps/refs.md §3.
 */
export interface AuxxRefMeta {
  readonly kind: EntityRefKind
}

/**
 * One helper covering every fence-resolvable entity kind. Author marks the
 * id field itself, not a sibling field. Refs are output-only — the build
 * scanner emits a warning when an input field carries this marker.
 */
export const refs = {
  entity: <K extends EntityRefKind>(kind: K) =>
    z.string().meta({ auxxRef: { kind } satisfies AuxxRefMeta }),
}
