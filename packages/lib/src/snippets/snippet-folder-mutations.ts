// packages/lib/src/snippets/snippet-folder-mutations.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, isNull, not } from 'drizzle-orm'
import { BadRequestError, NotFoundError } from '../errors'
import { guard } from './guard'

export interface CreateSnippetFolderInput {
  name: string
  description?: string
  parentId?: string
}

/** Create a snippet folder, verifying the parent and name uniqueness in-location. */
export async function createSnippetFolder(
  db: Database,
  organizationId: string,
  userId: string,
  input: CreateSnippetFolderInput
) {
  return guard(async () => {
    const { name, description, parentId } = input

    if (parentId) {
      const parentFolder = await db.query.SnippetFolder.findFirst({
        where: and(
          eq(schema.SnippetFolder.id, parentId),
          eq(schema.SnippetFolder.organizationId, organizationId)
        ),
      })
      if (!parentFolder) {
        throw new BadRequestError('Parent folder not found')
      }
    }

    const existingFolder = await db.query.SnippetFolder.findFirst({
      where: and(
        eq(schema.SnippetFolder.name, name),
        eq(schema.SnippetFolder.organizationId, organizationId),
        parentId
          ? eq(schema.SnippetFolder.parentId, parentId)
          : isNull(schema.SnippetFolder.parentId)
      ),
    })
    if (existingFolder) {
      throw new BadRequestError('A folder with this name already exists at this location')
    }

    const [folder] = await db
      .insert(schema.SnippetFolder)
      .values({
        name,
        description,
        parentId,
        organizationId,
        createdById: userId,
        updatedAt: new Date(),
      })
      .returning()

    return folder
  }, 'Error creating snippet folder')
}

export interface UpdateSnippetFolderInput {
  name?: string
  description?: string
  parentId?: string | null
}

/**
 * Update a snippet folder, guarding against name collisions and circular
 * parent references in the hierarchy.
 */
export async function updateSnippetFolder(
  db: Database,
  organizationId: string,
  folderId: string,
  input: UpdateSnippetFolderInput
) {
  return guard(
    async () => {
      const { name, description, parentId } = input

      const existingFolder = await db.query.SnippetFolder.findFirst({
        where: and(
          eq(schema.SnippetFolder.id, folderId),
          eq(schema.SnippetFolder.organizationId, organizationId)
        ),
      })
      if (!existingFolder) {
        throw new NotFoundError('Folder not found')
      }

      // A folder can't be its own parent
      if (parentId === folderId) {
        throw new BadRequestError('A folder cannot be its own parent')
      }

      // Name uniqueness when changing name or parent
      if (
        (name && name !== existingFolder.name) ||
        (parentId !== undefined && parentId !== existingFolder.parentId)
      ) {
        const duplicateFolder = await db.query.SnippetFolder.findFirst({
          where: and(
            eq(schema.SnippetFolder.name, name || existingFolder.name),
            eq(schema.SnippetFolder.organizationId, organizationId),
            parentId !== undefined
              ? parentId
                ? eq(schema.SnippetFolder.parentId, parentId)
                : isNull(schema.SnippetFolder.parentId)
              : existingFolder.parentId
                ? eq(schema.SnippetFolder.parentId, existingFolder.parentId)
                : isNull(schema.SnippetFolder.parentId),
            not(eq(schema.SnippetFolder.id, folderId))
          ),
        })
        if (duplicateFolder) {
          throw new BadRequestError('A folder with this name already exists at this location')
        }
      }

      // Walk the parent chain to detect circular references
      if (parentId) {
        let currentParentId: string | null = parentId
        const visited = new Set([folderId])

        while (currentParentId) {
          if (visited.has(currentParentId)) {
            throw new BadRequestError('Circular reference detected in folder hierarchy')
          }
          visited.add(currentParentId)
          const parentFolder = await db.query.SnippetFolder.findFirst({
            where: eq(schema.SnippetFolder.id, currentParentId),
            columns: { parentId: true },
          })
          if (!parentFolder) break
          currentParentId = parentFolder.parentId
        }
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (name !== undefined) updateData.name = name
      if (description !== undefined) updateData.description = description
      if (parentId !== undefined) updateData.parentId = parentId === null ? null : parentId

      const [updatedFolder] = await db
        .update(schema.SnippetFolder)
        .set(updateData)
        .where(eq(schema.SnippetFolder.id, folderId))
        .returning()

      return updatedFolder
    },
    'Error updating snippet folder',
    { folderId }
  )
}

/**
 * Delete a snippet folder. Re-parents any subfolders to the deleted folder's
 * parent and either moves contained snippets to `moveSnippetsTo` or detaches
 * them. Wrapped in a transaction.
 */
export async function deleteSnippetFolderWithCascade(
  db: Database,
  organizationId: string,
  folderId: string,
  moveSnippetsTo: string | undefined
) {
  return guard(
    async () => {
      const existingFolder = await db.query.SnippetFolder.findFirst({
        where: and(
          eq(schema.SnippetFolder.id, folderId),
          eq(schema.SnippetFolder.organizationId, organizationId)
        ),
      })
      if (!existingFolder) {
        throw new NotFoundError('Folder not found')
      }

      if (moveSnippetsTo) {
        if (moveSnippetsTo === folderId) {
          throw new BadRequestError('Cannot move snippets to the folder being deleted')
        }
        const targetFolder = await db.query.SnippetFolder.findFirst({
          where: and(
            eq(schema.SnippetFolder.id, moveSnippetsTo),
            eq(schema.SnippetFolder.organizationId, organizationId)
          ),
        })
        if (!targetFolder) {
          throw new BadRequestError('Target folder not found')
        }
      }

      await db.transaction(async (tx) => {
        const subfolders = await tx.query.SnippetFolder.findMany({
          where: eq(schema.SnippetFolder.parentId, folderId),
        })

        if (subfolders.length > 0) {
          await tx
            .update(schema.SnippetFolder)
            .set({ parentId: existingFolder.parentId })
            .where(eq(schema.SnippetFolder.parentId, folderId))
        }

        if (moveSnippetsTo) {
          await tx
            .update(schema.Snippet)
            .set({ folderId: moveSnippetsTo })
            .where(eq(schema.Snippet.folderId, folderId))
        } else {
          await tx
            .update(schema.Snippet)
            .set({ folderId: null })
            .where(eq(schema.Snippet.folderId, folderId))
        }

        await tx.delete(schema.SnippetFolder).where(eq(schema.SnippetFolder.id, folderId))
      })
    },
    'Error deleting snippet folder',
    { folderId }
  )
}
