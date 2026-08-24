// packages/lib/src/files/filesystem/items.ts

/**
 * The **pure** half of the filesystem read: the unified `FileItem` shape the
 * Files UI renders, the mappers that produce it, and the keyset cursor.
 *
 * Nothing here touches a database. `FilesystemService` reached all of it only
 * through a `db`-bound class, which is why three of its four mappers were wrong
 * and nobody noticed:
 *
 * 1. **File breadcrumbs were fabricated.** `buildPathBreadcrumbs` split the
 *    folder `path` on `/` and emitted the literal id `'folder-lookup-needed'`
 *    for every crumb, with a comment conceding it. A crumb whose id is a
 *    placeholder cannot be navigated to.
 * 2. **Folder breadcrumbs never had ancestors.** `buildFolderBreadcrumbs`
 *    looped `while (currentFolder?.parent)`, and `parent` was not one of the ten
 *    columns the folder query selected — so the loop body never ran once and
 *    every folder's breadcrumb trail was `[Files, itself]`, no matter how deep.
 * 3. **The walk had no visited set.** Had `parent` ever been populated, an
 *    `A -> B -> A` pair in `parentId` (the schema permits one; there is no check
 *    constraint) would have looped forever.
 *
 * {@link buildBreadcrumbs} walks `parentId` through the same
 * {@link ancestorsOf} the folder module uses, so it is bounded, carries real
 * ids, and agrees with `folders/` by construction rather than by coincidence.
 */

import type { FolderEntity, FolderFileEntity } from '@auxx/database/types'
import type { FolderNode } from '../folders/tree'
import { ancestorsOf, ROOT_PATH } from '../folders/tree'

/**
 * What the root of the library is called in a breadcrumb trail.
 *
 * The library root is not a `Folder` row — a file at the top level has
 * `folderId IS NULL` — so the crumb carries `id: null` and this name.
 */
export const ROOT_FOLDER_NAME = 'Files'

/** One step in a navigable trail. `id: null` is the library root. */
export interface BreadcrumbItem {
  id: string | null
  name: string
  path: string
}

/**
 * A file or a folder, in the one shape the Files UI stores and renders.
 *
 * The upload-progress fields the legacy interface carried (`status`,
 * `progress`, `error`, `tempId`, `serverFileId`, `url`) are **not** here: the
 * server never set one of them, and they exist on the front-end store's own
 * `FileItem` where the uploader actually populates them. `isUploading` survives
 * because the store reads it to tell a server row from an in-flight upload.
 */
export interface FileItem {
  id: string
  name: string
  type: 'file' | 'folder'
  size?: number | null
  /** `size` normalised to a number so the UI never formats `null`. */
  displaySize: number
  mimeType?: string | null
  ext?: string | null
  createdAt: Date
  updatedAt: Date
  path: string
  /** Unified parent link: `Folder.parentId` for folders, `FolderFile.folderId` for files. */
  parentId?: string | null
  isArchived?: boolean
  isUploading?: boolean

  organizationId?: string
  createdById?: string | null
  currentVersionId?: string | null
  deletedAt?: Date | null

  /** Folders only. */
  fileCount?: number
  /** Folders only. */
  subfolderCount?: number
  /** Folders only. */
  depth?: number

  hierarchy?: {
    folderName: string
    folderPath: string
    fullPath: string
    breadcrumbs: BreadcrumbItem[]
  }
}

/**
 * The `FolderFile` columns the filesystem read projects, plus the joined
 * folder name and path.
 *
 * The join stays even though {@link buildBreadcrumbs} could derive both from the
 * folder index: the folder list is filtered to live, unarchived rows, so a file
 * sitting in an archived folder would lose its `folderName` / `folderPath` — two
 * fields the UI's local search indexes. The join has no such filter and costs
 * nothing on a query that is already reading `FolderFile`.
 */
export interface FilesystemFileRow {
  id: string
  name: string
  size: number | null
  mimeType: string | null
  ext: string | null
  createdAt: Date
  updatedAt: Date
  path: string
  folderId: string | null
  isArchived: boolean
  organizationId: string
  createdById: string | null
  currentVersionId: string | null
  deletedAt: Date | null
  folderName: string | null
  folderPath: string | null
}

/** The `Folder` columns the filesystem read projects. Extends the graph shape `folders/tree.ts` walks. */
export interface FilesystemFolderRow extends FolderNode {
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  isArchived: boolean
  organizationId: string
  createdById: string | null
}

/** Live file count and direct-subfolder count for one folder. */
export interface FolderCountPair {
  fileCount: number
  subfolderCount: number
}

// ============= Breadcrumbs =============

/**
 * The navigable trail from the library root down to `folderId`, inclusive.
 *
 * `null` — a file or folder at the top level — yields just the root crumb.
 * A `folderId` that is not in `index` (soft-deleted, archived, or another
 * organization's) also yields just the root crumb rather than a partial trail
 * with a hole in it.
 */
export function buildBreadcrumbs(
  index: ReadonlyMap<string, FolderNode>,
  folderId: string | null | undefined
): BreadcrumbItem[] {
  const root: BreadcrumbItem = { id: null, name: ROOT_FOLDER_NAME, path: ROOT_PATH }
  if (!folderId) return [root]

  const self = index.get(folderId)
  if (!self) return [root]

  return [
    root,
    ...ancestorsOf(index, folderId).map((node) => ({
      id: node.id,
      name: node.name,
      path: node.path ?? ROOT_PATH,
    })),
    { id: self.id, name: self.name, path: self.path ?? ROOT_PATH },
  ]
}

// ============= Mappers =============

/** Join a folder path and a leaf name for the `fullPath` search key. */
function fullPathFor(folderPath: string | null | undefined, name: string): string {
  const base = !folderPath || folderPath === ROOT_PATH ? '' : folderPath
  return `${base}/${name}`.replace(/\/+/g, '/')
}

/** A projected `FolderFile` row as the UI's unified item. */
export function fileItemFromRow(
  row: FilesystemFileRow,
  index: ReadonlyMap<string, FolderNode>
): FileItem {
  return {
    id: row.id,
    name: row.name,
    type: 'file',
    size: row.size,
    displaySize: row.size ? Number(row.size) : 0,
    mimeType: row.mimeType,
    ext: row.ext,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    path: row.path,
    parentId: row.folderId,
    isArchived: row.isArchived,
    organizationId: row.organizationId,
    createdById: row.createdById,
    currentVersionId: row.currentVersionId,
    deletedAt: row.deletedAt,
    isUploading: false,
    hierarchy: {
      folderName: row.folderName ?? ROOT_FOLDER_NAME,
      folderPath: row.folderPath ?? ROOT_PATH,
      fullPath: fullPathFor(row.folderPath, row.name),
      breadcrumbs: buildBreadcrumbs(index, row.folderId),
    },
  }
}

/** A projected `Folder` row as the UI's unified item, with its two counts folded in. */
export function fileItemFromFolderRow(
  row: FilesystemFolderRow,
  counts: FolderCountPair,
  index: ReadonlyMap<string, FolderNode>
): FileItem {
  const parent = row.parentId ? index.get(row.parentId) : undefined
  const path = row.path ?? ROOT_PATH

  return {
    id: row.id,
    name: row.name,
    type: 'folder',
    displaySize: 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    path,
    parentId: row.parentId,
    depth: row.depth,
    isArchived: row.isArchived,
    organizationId: row.organizationId,
    createdById: row.createdById,
    deletedAt: row.deletedAt,
    isUploading: false,
    fileCount: counts.fileCount,
    subfolderCount: counts.subfolderCount,
    hierarchy: {
      folderName: parent?.name ?? ROOT_FOLDER_NAME,
      folderPath: parent?.path ?? ROOT_PATH,
      fullPath: path,
      breadcrumbs: buildBreadcrumbs(index, row.id),
    },
  }
}

/**
 * A full `FolderFile` row as a `FileItem`, for the write paths.
 *
 * No `hierarchy`: a mutation returns the row it changed, and the caller already
 * holds the tree. The legacy `renameItem` did exactly this.
 */
export function fileItemFromFile(file: FolderFileEntity): FileItem {
  return {
    id: file.id,
    name: file.name,
    type: 'file',
    size: file.size,
    displaySize: file.size ? Number(file.size) : 0,
    mimeType: file.mimeType,
    ext: file.ext,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    path: file.path,
    parentId: file.folderId,
    isArchived: file.isArchived,
    organizationId: file.organizationId,
    createdById: file.createdById,
    currentVersionId: file.currentVersionId,
    deletedAt: file.deletedAt,
    isUploading: false,
  }
}

/** A full `Folder` row as a `FileItem`, for the write paths. */
export function fileItemFromFolder(folder: FolderEntity): FileItem {
  return {
    id: folder.id,
    name: folder.name,
    type: 'folder',
    displaySize: 0,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    path: folder.path ?? ROOT_PATH,
    parentId: folder.parentId,
    depth: folder.depth,
    isArchived: folder.isArchived,
    organizationId: folder.organizationId,
    createdById: folder.createdById,
    deletedAt: folder.deletedAt,
    isUploading: false,
  }
}

// ============= Keyset cursor =============

/**
 * The position of one row in the `(path, name, id)` ordering the file page uses.
 *
 * All three columns are needed: an id-only cursor cannot express "the row after
 * this one" in that ordering, and `id` is what makes the ordering total, so two
 * files sharing a path and a name still page stably.
 */
export interface FileCursor {
  path: string
  name: string
  id: string
}

/** Encode a cursor. base64url JSON, because `path` and `name` are free-form and collide with any delimiter. */
export function encodeFileCursor(cursor: FileCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

/**
 * Decode a cursor, or `null` if it is not one.
 *
 * A malformed cursor means "start from the beginning", not an error: the value
 * comes from a client that may be holding one from a previous deploy, and a 400
 * on a stale infinite-query page param is a worse outcome than a re-read.
 */
export function decodeFileCursor(raw: string): FileCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<FileCursor>
    if (
      typeof parsed.path !== 'string' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      return null
    }
    return { path: parsed.path, name: parsed.name, id: parsed.id }
  } catch {
    return null
  }
}
