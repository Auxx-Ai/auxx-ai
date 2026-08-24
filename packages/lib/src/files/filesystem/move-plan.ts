// packages/lib/src/files/filesystem/move-plan.ts

/**
 * Deciding what a bulk move should do — as **pure functions over a snapshot**.
 *
 * `FilesystemService` wrapped this logic in a class for no reason other than
 * that it needed a database to answer each question one row at a time:
 *
 * | question | legacy | here |
 * | --- | --- | --- |
 * | is this name taken in the target? | one `SELECT` **per item** | one `Set` lookup |
 * | what free name should it get? | one `SELECT` **per candidate**, `while (true)` with no ceiling | one loop over the same `Set`, bounded |
 * | would this folder move inside itself? | one `SELECT` **per ancestor level** | one upward walk of an already-loaded graph |
 *
 * So a 50-item move into a folder holding a few collisions issued well over a
 * hundred round-trips. {@link buildMovePlan} answers all three from three
 * queries total (see `filesystem-queries.ts`), and needs no database to be
 * tested at all — `plans/attachments/09-testing-strategy.md` §9.2 shape 1.
 *
 * ## Three behaviour fixes that fall out of being pure
 *
 * - **Nested selections are pruned by `parentId`, not by `path`.** The legacy
 *   compared `file.path.startsWith(folderPath + '/')`, which is only right while
 *   every stored `path` is accurate — and `rebuildFolderPaths` exists precisely
 *   because they drift (PR 5d). Membership now comes from the foreign key.
 * - **Cycle detection walks `parentId`.** Same reason, same fix as 5d's
 *   {@link wouldCreateCycle}, which this reuses rather than re-deriving.
 * - **Two same-named items in one selection no longer collide with each other.**
 *   The legacy asked the database whether a name was free, and nothing had been
 *   written yet — so moving `a.txt` and `a.txt` into the same folder handed both
 *   the name `a.txt (1)`, and the second write clobbered or duplicated the
 *   first. Names assigned earlier in the plan are added to the taken set.
 */

import type { FolderNode } from '../folders/tree'
import { descendantsOf, indexById, normalizeParentId, wouldCreateCycle } from '../folders/tree'
import type { FileItem } from './items'

/** How many `name (n)` candidates a rename tries before giving up. */
export const MAX_RENAME_ATTEMPTS = 100

/** One thing the caller asked to move. */
export interface MoveItemRef {
  id: string
  type: 'file' | 'folder'
}

/**
 * What to do when the moved name already exists in the target.
 *
 * `'rename'` is the only policy any caller passes today, and it is the default.
 * The other two are kept because they are three lines of a pure `switch` that a
 * table test covers for free — not because anything asks for them.
 */
export type MoveCollisionPolicy = 'rename' | 'skip' | 'fail'

/** The `FolderFile` columns the planner needs. */
export interface MoveFileRow {
  id: string
  name: string
  folderId: string | null
}

/**
 * Everything {@link buildMovePlan} is allowed to look at.
 *
 * Loaded once by `planMoveItems`; the planner itself never queries, which is
 * what makes it testable and what removes the per-item round-trips.
 */
export interface MoveSnapshot {
  /** The selected files, resolved org-scoped. A requested id absent here does not exist. */
  files: readonly MoveFileRow[]
  /** The organization's whole live folder graph — the selection, the target and every ancestor. */
  folders: readonly FolderNode[]
  /** Names of the live files sitting directly in the target folder. */
  targetFileNames: readonly string[]
}

/** One decided move. `reason` set means "do not execute this entry". */
export interface MovePlanEntry {
  id: string
  type: 'file' | 'folder'
  fromFolderId: string | null
  toFolderId: string | null
  willRename?: boolean
  newName?: string
  /** Why this entry will not run: not found, already there, a cycle, or a collision. */
  reason?: string
}

/** What one executed (or refused) entry did. */
export type MoveEntryOutcome =
  | { id: string; type: 'file' | 'folder'; status: 'moved'; renamed: boolean; item: FileItem }
  | { id: string; type: 'file' | 'folder'; status: 'skipped'; reason: string }
  | { id: string; type: 'file' | 'folder'; status: 'failed'; error: string }

/** The tally `fileRouter.moveItems` returns. */
export interface MoveItemsResult {
  success: boolean
  moved: number
  failed: number
  skipped: number
  results: Array<{
    id: string
    type: 'file' | 'folder'
    success: boolean
    renamed?: boolean
    error?: string
  }>
}

/** Knobs {@link buildMovePlan} accepts. */
export interface BuildMovePlanOptions {
  /** Defaults to `'rename'`. */
  collision?: MoveCollisionPolicy
}

/**
 * Drop items that are already inside another selected folder.
 *
 * Moving `/A` and `/A/b.txt` together means moving `b.txt` twice: once because
 * its folder moved, once explicitly — and the second move re-parents it out of
 * `A`, which is not what dragging a folder and its visible child means.
 *
 * Membership is computed from the `parentId` edges, so it is correct against a
 * drifted `path` column and against folder names containing `LIKE`
 * metacharacters — the two failure modes PR 5d found in the delete cascade.
 */
export function pruneNestedSelections(
  items: readonly MoveItemRef[],
  snapshot: MoveSnapshot
): MoveItemRef[] {
  const selectedFolderIds = new Set(
    items.filter((item) => item.type === 'folder').map((item) => item.id)
  )
  if (selectedFolderIds.size === 0) return [...items]

  // Every folder strictly beneath a selected folder. A selected folder that is
  // itself beneath another selected folder lands in here and is dropped.
  const covered = new Set<string>()
  for (const folderId of selectedFolderIds) {
    for (const descendant of descendantsOf(snapshot.folders, folderId)) {
      covered.add(descendant.id)
    }
  }

  const filesById = new Map(snapshot.files.map((file) => [file.id, file]))

  return items.filter((item) => {
    if (item.type === 'folder') return !covered.has(item.id)
    const file = filesById.get(item.id)
    if (!file?.folderId) return true
    return !selectedFolderIds.has(file.folderId) && !covered.has(file.folderId)
  })
}

/**
 * The first free `name (n)` variant, or `null` if none is free within
 * {@link MAX_RENAME_ATTEMPTS}.
 *
 * The suffix goes before the extension for files (`report (1).pdf`) and at the
 * end for folders, matching the legacy. The legacy's loop was `do { … } while
 * (await exists(…))` with no ceiling and a query per candidate, so a folder
 * holding many `name (n)` siblings turned one move into an unbounded query
 * storm; here the whole search is over a `Set` and it is bounded.
 */
export function generateUniqueName(
  originalName: string,
  type: 'file' | 'folder',
  taken: ReadonlySet<string>
): string | null {
  const lastDot = originalName.lastIndexOf('.')
  const hasExtension = type === 'file' && lastDot > 0
  const stem = hasExtension ? originalName.slice(0, lastDot) : originalName
  const extension = hasExtension ? originalName.slice(lastDot) : ''

  for (let counter = 1; counter <= MAX_RENAME_ATTEMPTS; counter += 1) {
    const candidate = `${stem} (${counter})${extension}`
    if (!taken.has(candidate)) return candidate
  }
  return null
}

/**
 * Decide, for every requested item, whether and how it moves.
 *
 * Entries come out **files first, then folders** — the order the legacy
 * `executePlan` imposed by filtering the plan twice. It is preserved because a
 * folder move rewrites the paths of everything beneath it, so doing the files
 * first keeps each file's own path rewrite from being redone.
 *
 * An entry carrying `reason` is a decision not to act, not a failure: the caller
 * counts it as skipped and moves on. Every refusal the legacy could produce is
 * still produced, with the same strings, because the front end matches on none
 * of them and changing them buys nothing.
 *
 * @param items What the caller asked to move, before pruning.
 * @param targetFolderId The destination. `null` and the UI's `'root'` sentinel
 *   both mean the library root.
 * @param snapshot Everything loaded up front — see {@link MoveSnapshot}.
 */
export function buildMovePlan(
  items: readonly MoveItemRef[],
  targetFolderId: string | null,
  snapshot: MoveSnapshot,
  options: BuildMovePlanOptions = {}
): MovePlanEntry[] {
  const policy = options.collision ?? 'rename'
  const target = normalizeParentId(targetFolderId)
  const index = indexById(snapshot.folders)

  const filesById = new Map(snapshot.files.map((file) => [file.id, file]))
  const takenFileNames = new Set(snapshot.targetFileNames)
  const takenFolderNames = new Set(
    snapshot.folders.filter((node) => node.parentId === target).map((node) => node.name)
  )

  const pruned = pruneNestedSelections(items, snapshot)
  const ordered = [
    ...pruned.filter((item) => item.type === 'file'),
    ...pruned.filter((item) => item.type === 'folder'),
  ]

  const plan: MovePlanEntry[] = []

  for (const item of ordered) {
    const entry: MovePlanEntry = {
      id: item.id,
      type: item.type,
      fromFolderId: null,
      toFolderId: target,
    }

    if (item.type === 'file') {
      const file = filesById.get(item.id)
      if (!file) {
        plan.push({ ...entry, reason: 'File not found' })
        continue
      }
      entry.fromFolderId = file.folderId
      if (file.folderId === target) {
        plan.push({ ...entry, reason: 'Already in target folder' })
        continue
      }
      plan.push(resolveCollision(entry, file.name, takenFileNames, policy))
      continue
    }

    const folder = index.get(item.id)
    if (!folder) {
      plan.push({ ...entry, reason: 'Folder not found' })
      continue
    }
    entry.fromFolderId = folder.parentId
    if (folder.parentId === target) {
      plan.push({ ...entry, reason: 'Already in target folder' })
      continue
    }
    if (wouldCreateCycle(index, folder.id, target)) {
      plan.push({ ...entry, reason: 'Would create circular reference' })
      continue
    }
    plan.push(resolveCollision(entry, folder.name, takenFolderNames, policy))
  }

  return plan
}

/**
 * Apply the collision policy to one entry, claiming the name it settles on.
 *
 * Mutating `taken` is the point: it is what stops two identically-named items in
 * the same selection from being handed the same free name.
 */
function resolveCollision(
  entry: MovePlanEntry,
  originalName: string,
  taken: Set<string>,
  policy: MoveCollisionPolicy
): MovePlanEntry {
  if (!taken.has(originalName)) {
    taken.add(originalName)
    return entry
  }

  switch (policy) {
    case 'fail':
      return { ...entry, reason: `Name collision: ${originalName} already exists in target` }
    case 'skip':
      return { ...entry, reason: 'SKIPPED due to name collision' }
    default: {
      const newName = generateUniqueName(originalName, entry.type, taken)
      if (!newName) {
        return { ...entry, reason: `Name collision: ${originalName} already exists in target` }
      }
      taken.add(newName)
      return { ...entry, willRename: true, newName }
    }
  }
}

/**
 * Fold executed outcomes into the tally the router returns.
 *
 * Pure, and separate from the loop that produces the outcomes, because the loop
 * owns a transaction per entry and lives in the router — see
 * `filesystem-mutations.ts`. Counting is the part worth testing, so it is the
 * part that has no I/O in it.
 */
export function summarizeMoveOutcomes(outcomes: readonly MoveEntryOutcome[]): MoveItemsResult {
  let moved = 0
  let failed = 0
  let skipped = 0

  const results = outcomes.map((outcome) => {
    if (outcome.status === 'moved') {
      moved += 1
      return { id: outcome.id, type: outcome.type, success: true, renamed: outcome.renamed }
    }
    if (outcome.status === 'skipped') {
      skipped += 1
      // The legacy wrote `reason === 'SKIPPED' ? 'SKIPPED' : reason` here, a
      // ternary that could never take its first arm: the only skip reason it
      // produced was the sentence `'SKIPPED due to name collision'`.
      return { id: outcome.id, type: outcome.type, success: false, error: outcome.reason }
    }
    failed += 1
    return { id: outcome.id, type: outcome.type, success: false, error: outcome.error }
  })

  return { success: failed === 0, moved, failed, skipped, results }
}
