// packages/lib/src/workflow-engine/catalog/registry.ts

import type { NodeManifest } from './types'

/**
 * The catalog registry — a plain module-level map, no class (lib-module
 * convention). Node manifests register themselves at module load via
 * `registerManifest`; consumers read through `getManifest` / `listManifests`.
 *
 * Migration discipline: a node type lives EITHER here or on the
 * `NOT_YET_MIGRATED` list (`not-yet-migrated.ts`) — never both, never
 * neither. The catalog coverage test asserts exact set equality against the
 * builder's `NodeType` enum, so migrating a type is always an explicit
 * two-file change: register the manifest, delete the list entry.
 */
const manifests = new Map<string, NodeManifest<any>>()

/** Register a node manifest. Throws on duplicate ids — two declarations of one type is the drift this catalog exists to end. */
export function registerManifest(manifest: NodeManifest<any>): void {
  if (manifests.has(manifest.id)) {
    throw new Error(`Node manifest already registered for type "${manifest.id}"`)
  }
  manifests.set(manifest.id, manifest)
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
