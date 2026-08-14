// packages/lib/src/workflow-engine/catalog/registry.ts

import { aiManifest } from './nodes/ai'
import { answerManifest } from './nodes/answer'
import { codeManifest } from './nodes/code'
import { crudManifest } from './nodes/crud'
import { dateTimeManifest } from './nodes/date-time'
import { endManifest } from './nodes/end'
import { findManifest } from './nodes/find'
import { formatManifest } from './nodes/format'
import { httpManifest } from './nodes/http'
import { humanConfirmationManifest } from './nodes/human'
import { ifElseManifest } from './nodes/if-else'
import { informationExtractorManifest } from './nodes/information-extractor'
import { listManifest } from './nodes/list'
import { loopManifest } from './nodes/loop'
import { manualManifest } from './nodes/manual'
import { messageReceivedManifest } from './nodes/message-received'
import { noteManifest } from './nodes/note'
import { resourceTriggerManifest } from './nodes/resource-trigger'
import { scheduledTriggerManifest } from './nodes/scheduled'
import { textClassifierManifest } from './nodes/text-classifier'
import { varAssignManifest } from './nodes/var-assign'
import { waitManifest } from './nodes/wait'
import type { NodeManifest } from './types'

/**
 * The catalog registry — a plain module-level map built from an explicit
 * manifest list, no class and no registration side effects (import order can
 * never change what's registered).
 *
 * Migration discipline: a node type lives EITHER here or on the
 * `NOT_YET_MIGRATED` list (`not-yet-migrated.ts`) — never both, never
 * neither. The catalog coverage test asserts exact set equality against the
 * builder's `NodeType` enum, so migrating a type is always an explicit
 * two-file change: add the manifest here, delete the list entry.
 */
const ALL_MANIFESTS: NodeManifest<any>[] = [
  aiManifest,
  answerManifest,
  codeManifest,
  crudManifest,
  dateTimeManifest,
  endManifest,
  findManifest,
  formatManifest,
  httpManifest,
  humanConfirmationManifest,
  ifElseManifest,
  informationExtractorManifest,
  listManifest,
  loopManifest,
  manualManifest,
  messageReceivedManifest,
  noteManifest,
  resourceTriggerManifest,
  scheduledTriggerManifest,
  textClassifierManifest,
  varAssignManifest,
  waitManifest,
]

const manifests = new Map<string, NodeManifest<any>>(ALL_MANIFESTS.map((m) => [m.id, m]))
if (manifests.size !== ALL_MANIFESTS.length) {
  throw new Error('Duplicate node manifest id in ALL_MANIFESTS')
}

/** Look up one node type's manifest. Undefined ⇒ not yet migrated (check `NOT_YET_MIGRATED`). */
export function getManifest(type: string): NodeManifest<any> | undefined {
  return manifests.get(type)
}

/** Every registered manifest. */
export function listManifests(): NodeManifest<any>[] {
  return Array.from(manifests.values())
}

/** Manifests Kopilot may author (`agent.authorable === true`). */
export function getAuthorableManifests(): NodeManifest<any>[] {
  return listManifests().filter((manifest) => manifest.agent?.authorable === true)
}
