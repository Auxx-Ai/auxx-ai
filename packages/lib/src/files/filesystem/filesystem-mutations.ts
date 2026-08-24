// packages/lib/src/files/filesystem/filesystem-mutations.ts

/**
 * The filesystem writes: execute one planned move, and rename one item.
 *
 * Reads live in `filesystem-queries.ts` and the decision logic in
 * `move-plan.ts`, so nothing here decides anything — it applies a
 * {@link MovePlanEntry} that was already decided without a database.
 *
 * ## Where the transaction boundary went, and why
 *
 * `FilesystemService` opened **three** raw `this.dbInstance.transaction(...)`
 * calls: one wrapping the whole atomic move, and one per file and per folder in
 * the best-effort loop. Two things were wrong with that beyond the ownership
 * question:
 *
 * - `dbInstance` is `Database | Transaction`. Called on a client that is already
 *   inside a transaction, `transaction()` issues a **`SAVEPOINT`**, not a new
 *   transaction — the trap PR 5f hit in `processThumbnailDeletions`. Whether a
 *   best-effort move was actually isolated per item therefore depended on who
 *   constructed the service.
 * - Both loops constructed a `FileService` and a `FolderService` **on the open
 *   transaction**, which is four of the construction sites PR 5d's retro lists
 *   as still outstanding. Those are gone: this calls `folder-files/` and
 *   `folders/` directly.
 *
 * **Decision: lib opens no transaction.** {@link executeMoveEntry} takes
 * `tx: Transaction` positionally first and applies exactly one plan entry inside
 * it; the caller decides how many entries share a transaction, which *is* the
 * choice between atomic and best-effort. `fileRouter.moveItems` opens one per
 * entry, because best-effort means a failure must not roll back the items
 * already moved — and a move-plus-rename pair must still land together, since a
 * moved-but-not-renamed row sits in the target under the colliding name.
 *
 * That also deletes `mode: 'atomic'` and the `MoveMode` type: nothing has ever
 * passed it, and "all of these in one transaction" is now a loop the caller
 * writes with one `db.transaction` around it instead of a flag.
 */

import type { Transaction } from '@auxx/database'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { BadRequestError } from '../../errors'
import type { FilesCtx } from '../ctx'
import { moveFolderFile, renameFolderFile } from '../folder-files/file-mutations'
import { renameFolder, updateFolder } from '../folders/folder-mutations'
import { guard } from '../guard'
import type { FileItem } from './items'
import { fileItemFromFile, fileItemFromFolder } from './items'
import type { MovePlanEntry } from './move-plan'
import type { FilesystemWriteDeps } from './ports'

/**
 * Apply one entry of a move plan inside the caller's transaction.
 *
 * A folder move is a **single** {@link updateFolder} call carrying both the new
 * parent and, when the plan resolved a collision, the new name. The legacy ran
 * `move` and then `rename`, and each of those recomputed and rewrote the path
 * and depth of every row in the moved subtree — so a rename-on-collision paid
 * the whole cascade twice.
 *
 * A file move is two statements (`moveFolderFile`, then `renameFolderFile`),
 * because the rename has to re-derive the path *after* the row has landed in the
 * target folder.
 *
 * @param tx The caller's transaction. Positional and first, so a pool cannot be
 *   passed by accident (`files/ctx.ts`).
 * @param ctx Scope. Pass `{ ...ctx, db: tx }` so nested reads see uncommitted rows.
 * @param entry A plan entry with no `reason` — a refused entry is the caller's to skip.
 * @param deps `now`, for the `updatedAt` stamps.
 */
export async function executeMoveEntry(
  tx: Transaction,
  ctx: FilesCtx,
  entry: MovePlanEntry,
  deps: FilesystemWriteDeps
): Promise<Result<FileItem, AuxxError>> {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  return guard(
    async () => {
      if (entry.reason) {
        throw new BadRequestError(`Move entry ${entry.id} was not planned to run: ${entry.reason}`)
      }

      if (entry.type === 'file') {
        const moved = take(await moveFolderFile(txCtx, deps, entry.id, entry.toFolderId))
        const file =
          entry.willRename && entry.newName
            ? take(await renameFolderFile(txCtx, deps, entry.id, entry.newName))
            : moved
        return fileItemFromFile(file)
      }

      const folder = take(
        await updateFolder(
          tx,
          txCtx,
          entry.id,
          {
            parentId: entry.toFolderId,
            ...(entry.willRename && entry.newName ? { name: entry.newName } : {}),
          },
          deps
        )
      )
      return fileItemFromFolder(folder)
    },
    'Failed to execute a move plan entry',
    { id: entry.id, type: entry.type, organizationId: ctx.organizationId }
  )
}

/**
 * Rename one file or folder, whichever the id names.
 *
 * Takes `tx` even though the file branch is a single statement: a folder rename
 * rewrites the `path` of every descendant folder and file, and the caller cannot
 * know which branch it is on before the id resolves.
 */
export async function renameFilesystemItem(
  tx: Transaction,
  ctx: FilesCtx,
  id: string,
  type: 'file' | 'folder',
  newName: string,
  deps: FilesystemWriteDeps
): Promise<Result<FileItem, AuxxError>> {
  const txCtx: FilesCtx = { ...ctx, db: tx }
  return guard(
    async () => {
      if (type === 'file') {
        return fileItemFromFile(take(await renameFolderFile(txCtx, deps, id, newName)))
      }
      return fileItemFromFolder(take(await renameFolder(tx, txCtx, id, newName, deps)))
    },
    'Failed to rename item',
    { id, type, organizationId: ctx.organizationId }
  )
}

/**
 * Unwrap a collaborator's `Result`, throwing its `AuxxError` so the surrounding
 * {@link guard} converts it and — crucially — so the caller's transaction rolls
 * back. Returning `err()` up the chain would leave the transaction open and half
 * applied.
 */
function take<T>(result: Result<T, AuxxError>): T {
  if (result.isErr()) throw result.error
  return result.value
}
