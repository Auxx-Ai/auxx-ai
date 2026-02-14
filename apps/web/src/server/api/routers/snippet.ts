// server/api/routers/snippets.ts

import { database, schema } from '@auxx/database'
import {
  BuiltInEntityType,
  ResourceGranteeType,
  ResourcePermission,
  SnippetSharingType,
} from '@auxx/database/enums'
import {
  getInstanceAccess,
  getUserAccessibleInstances,
  setInstanceAccess,
} from '@auxx/lib/resource-access'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('snippets-router')

/**
 * TRPC router for snippets management operations.
 *
 * This router provides endpoints for:
 * - Retrieving snippets (all, by ID, by folder)
 * - Creating, updating, and deleting snippets
 * - Managing snippet sharing settings
 * - Creating and managing snippet folders
 */
export const snippetsRouter = createTRPCRouter({
  // Get all snippets for the organization
  all: protectedProcedure
    .input(
      z.object({
        folderId: z.string().optional(),
        searchQuery: z.string().optional(),
        includeShared: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { folderId, searchQuery, includeShared } = input
      try {
        // Build where clause using AND to combine filters
        const filters: SQL[] = [
          eq(schema.Snippet.organizationId, organizationId),
          eq(schema.Snippet.isDeleted, false),
        ]

        // Filter by folder if specified
        if (folderId) {
          filters.push(eq(schema.Snippet.folderId, folderId))
        }

        // Add search filter if specified (matches title OR content)
        if (searchQuery) {
          filters.push(
            or(
              ilike(schema.Snippet.title, `%${searchQuery}%`),
              ilike(schema.Snippet.content, `%${searchQuery}%`)
            )!
          )
        }

        // Handle shared snippets visibility
        if (includeShared) {
          // Get snippets user has access to via ResourceAccess
          const accessResult = await getUserAccessibleInstances(
            { db: ctx.db, organizationId, userId },
            userId,
            BuiltInEntityType.snippet
          )

          if (accessResult.hasTypeAccess) {
            // User has access to ALL snippets (org admin), no additional filter needed
            // but still filter to own + org-shared + CUSTOM shared
            filters.push(
              or(
                eq(schema.Snippet.createdById, userId),
                eq(schema.Snippet.sharingType, SnippetSharingType.ORGANIZATION),
                eq(schema.Snippet.sharingType, SnippetSharingType.GROUPS)
              )!
            )
          } else {
            // Get snippet IDs from ResourceAccess instances
            const sharedSnippetIds = accessResult.instances.map(
              (a) => parseRecordId(a.recordId).entityInstanceId
            )

            // Include user's own OR org shared OR specifically shared via ResourceAccess
            filters.push(
              or(
                eq(schema.Snippet.createdById, userId),
                eq(schema.Snippet.sharingType, SnippetSharingType.ORGANIZATION),
                sharedSnippetIds.length > 0
                  ? inArray(schema.Snippet.id, sharedSnippetIds)
                  : sql`false`
              )!
            )
          }
        } else {
          // Only include user's own snippets
          filters.push(eq(schema.Snippet.createdById, userId))
        }

        // Fetch snippets
        const snippets = await ctx.db.query.Snippet.findMany({
          where: and(...filters),
          with: {
            folder: true,
            createdBy: {
              columns: { id: true, name: true, email: true, image: true },
            },
          },
          orderBy: [desc(schema.Snippet.updatedAt)],
        })

        // Get shares count for each snippet from ResourceAccess
        const snippetIds = snippets.map((s) => s.id)
        const sharesCounts =
          snippetIds.length > 0
            ? await ctx.db
                .select({
                  snippetId: schema.ResourceAccess.entityInstanceId,
                  count: count(schema.ResourceAccess.id),
                })
                .from(schema.ResourceAccess)
                .where(
                  and(
                    eq(schema.ResourceAccess.entityDefinitionId, BuiltInEntityType.snippet),
                    inArray(schema.ResourceAccess.entityInstanceId, snippetIds)
                  )
                )
                .groupBy(schema.ResourceAccess.entityInstanceId)
            : []

        // Merge the counts back into snippets
        const snippetsWithCounts = snippets.map((snippet) => ({
          ...snippet,
          _count: {
            shares: sharesCounts.find((c) => c.snippetId === snippet.id)?.count ?? 0,
          },
        }))

        return { snippets: snippetsWithCounts }
      } catch (error) {
        logger.error('Error getting snippets:', { error })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to get snippets' })
      }
    }),

  // Get a snippet by ID
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    const { id } = input
    try {
      // Check if user has access via ResourceAccess
      const accessResult = await getUserAccessibleInstances(
        { db: ctx.db, organizationId, userId },
        userId,
        BuiltInEntityType.snippet
      )
      const sharedSnippetIds = accessResult.instances.map(
        (a) => parseRecordId(a.recordId).entityInstanceId
      )

      const snippet = await ctx.db.query.Snippet.findFirst({
        where: and(
          eq(schema.Snippet.id, id),
          eq(schema.Snippet.organizationId, organizationId),
          eq(schema.Snippet.isDeleted, false),
          or(
            eq(schema.Snippet.createdById, userId), // User's own snippets
            eq(schema.Snippet.sharingType, SnippetSharingType.ORGANIZATION), // Org-wide shared snippets
            accessResult.hasTypeAccess
              ? sql`true`
              : sharedSnippetIds.includes(id)
                ? sql`true`
                : sql`false` // Shared via ResourceAccess
          )!
        ),
        with: {
          folder: true,
          createdBy: {
            columns: { id: true, name: true, email: true, image: true },
          },
        },
      })

      if (!snippet) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Snippet not found' })
      }

      // Get shares from ResourceAccess for display
      const shares = await getInstanceAccess(
        { db: ctx.db, organizationId },
        toRecordId(BuiltInEntityType.snippet, id)
      )

      // Check if user can edit the snippet
      let canEdit = snippet.createdById === userId

      if (!canEdit && shares.length > 0) {
        // Check if user has EDIT permission directly
        const userShare = shares.find(
          (s) => s.granteeType === ResourceGranteeType.user && s.granteeId === userId
        )
        if (userShare && userShare.permission === ResourcePermission.edit) {
          canEdit = true
        }

        // Check if user has EDIT permission via group membership
        if (!canEdit) {
          const groupShares = shares.filter(
            (s) =>
              s.granteeType === ResourceGranteeType.group &&
              s.permission === ResourcePermission.edit
          )
          if (groupShares.length > 0) {
            const userGroupMembership = await ctx.db.query.EntityGroupMember.findFirst({
              where: and(
                eq(schema.EntityGroupMember.memberType, 'user'),
                eq(schema.EntityGroupMember.memberRefId, userId),
                inArray(
                  schema.EntityGroupMember.groupInstanceId,
                  groupShares.map((s) => s.granteeId)
                )
              ),
            })
            if (userGroupMembership) {
              canEdit = true
            }
          }
        }
      }

      return { snippet: { ...snippet, shares }, canEdit }
    } catch (error) {
      logger.error('Error getting snippet:', { error, snippetId: id })
      if (error instanceof TRPCError) {
        throw error
      }
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to get snippet' })
    }
  }),

  // Create a new snippet
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1, 'Title is required'),
        content: z.string().min(1, 'Content is required'),
        contentHtml: z.string().optional(),
        description: z.string().optional(),
        folderId: z.string().optional().nullable(),
        sharingType: z.enum(SnippetSharingType).default(SnippetSharingType.PRIVATE),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { title, content, contentHtml, description, folderId, sharingType } = input
      // try {
      // Verify folder exists and belongs to this organization if provided
      if (folderId) {
        const folder = await ctx.db.query.SnippetFolder.findFirst({
          where: and(
            eq(schema.SnippetFolder.id, folderId),
            eq(schema.SnippetFolder.organizationId, organizationId)
          ),
        })

        if (!folder) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected folder not found' })
        }
      }

      // Create the snippet
      const [snippet] = await ctx.db
        .insert(schema.Snippet)
        .values({
          title,
          content,
          contentHtml,
          description,
          folderId,
          sharingType,
          organizationId,
          createdById: userId,
          updatedAt: new Date(),
        })
        .returning()

      // Fetch with relations
      const snippetWithRelations = await ctx.db.query.Snippet.findFirst({
        where: eq(schema.Snippet.id, snippet.id),
        with: {
          folder: true,
          createdBy: {
            columns: { id: true, name: true, email: true, image: true },
          },
        },
      })

      return { success: true, snippet: snippetWithRelations }
      // } catch (error) {
      //   logger.error('Error creating snippet:', { error, input })
      //   if (error instanceof TRPCError) {
      //     throw error
      //   }
      //   throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create snippet' })
      // }
    }),

  // Update an existing snippet
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1, 'Title is required').optional(),
        content: z.string().min(1, 'Content is required').optional(),
        contentHtml: z.string().optional(),
        description: z.string().optional(),
        folderId: z.string().nullable().optional(),
        sharingType: z.enum(SnippetSharingType).optional(),
        isFavorite: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { id, title, content, contentHtml, description, folderId, sharingType, isFavorite } =
        input

      try {
        // Check if snippet exists
        const existingSnippet = await ctx.db.query.Snippet.findFirst({
          where: and(
            eq(schema.Snippet.id, id),
            eq(schema.Snippet.organizationId, organizationId),
            eq(schema.Snippet.isDeleted, false)
          ),
        })

        if (!existingSnippet) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Snippet not found',
          })
        }

        // Check if user has edit access
        let canEdit = existingSnippet.createdById === userId

        if (!canEdit) {
          // Check ResourceAccess for edit permissions
          const shares = await getInstanceAccess(
            { db: ctx.db, organizationId },
            toRecordId(BuiltInEntityType.snippet, id)
          )

          // Check direct user permission
          const userShare = shares.find(
            (s) => s.granteeType === ResourceGranteeType.user && s.granteeId === userId
          )
          if (userShare && userShare.permission === ResourcePermission.edit) {
            canEdit = true
          }

          // Check group-based permission
          if (!canEdit) {
            const groupShares = shares.filter(
              (s) =>
                s.granteeType === ResourceGranteeType.group &&
                s.permission === ResourcePermission.edit
            )
            if (groupShares.length > 0) {
              const userGroupMembership = await ctx.db.query.EntityGroupMember.findFirst({
                where: and(
                  eq(schema.EntityGroupMember.memberType, 'user'),
                  eq(schema.EntityGroupMember.memberRefId, userId),
                  inArray(
                    schema.EntityGroupMember.groupInstanceId,
                    groupShares.map((s) => s.granteeId)
                  )
                ),
              })
              if (userGroupMembership) {
                canEdit = true
              }
            }
          }
        }

        if (!canEdit) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to edit this snippet',
          })
        }

        // Only the creator can change sharing settings
        if (sharingType && existingSnippet.createdById !== userId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the creator can change sharing settings',
          })
        }

        // Verify folder exists and belongs to this organization if provided
        if (folderId) {
          const folder = await ctx.db.query.SnippetFolder.findFirst({
            where: and(
              eq(schema.SnippetFolder.id, folderId),
              eq(schema.SnippetFolder.organizationId, organizationId)
            ),
          })

          if (!folder) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected folder not found' })
          }
        }

        // Update the snippet
        const updateData: any = {
          updatedAt: new Date(),
        }
        if (title !== undefined) updateData.title = title
        if (content !== undefined) updateData.content = content
        if (contentHtml !== undefined) updateData.contentHtml = contentHtml
        if (description !== undefined) updateData.description = description
        if (folderId !== undefined) updateData.folderId = folderId === null ? null : folderId
        if (sharingType !== undefined) updateData.sharingType = sharingType
        if (isFavorite !== undefined) updateData.isFavorite = isFavorite

        await ctx.db.update(schema.Snippet).set(updateData).where(eq(schema.Snippet.id, id))

        // Fetch updated snippet with relations
        const updatedSnippet = await ctx.db.query.Snippet.findFirst({
          where: eq(schema.Snippet.id, id),
          with: {
            folder: true,
            createdBy: {
              columns: { id: true, name: true, email: true, image: true },
            },
          },
        })

        return { success: true, snippet: updatedSnippet }
      } catch (error) {
        logger.error('Error updating snippet:', { error, snippetId: id })
        if (error instanceof TRPCError) {
          throw error
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update snippet' })
      }
    }),

  // Delete a snippet (soft delete)
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id } = input
      const { organizationId, userId } = ctx.session
      try {
        // Check if snippet exists and user has access
        const existingSnippet = await ctx.db.query.Snippet.findFirst({
          where: and(
            eq(schema.Snippet.id, id),
            eq(schema.Snippet.organizationId, organizationId),
            eq(schema.Snippet.isDeleted, false)
          ),
        })

        if (!existingSnippet) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Snippet not found' })
        }

        // Only the creator or admin can delete
        const membership = await ctx.db.query.OrganizationMember.findFirst({
          where: and(
            eq(schema.OrganizationMember.userId, userId),
            eq(schema.OrganizationMember.organizationId, organizationId)
          ),
        })

        if (
          existingSnippet.createdById !== userId &&
          membership?.role !== 'ADMIN' &&
          membership?.role !== 'OWNER'
        ) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to delete this snippet',
          })
        }

        // Soft delete the snippet
        await ctx.db
          .update(schema.Snippet)
          .set({ isDeleted: true, updatedAt: new Date() })
          .where(eq(schema.Snippet.id, id))

        return { success: true }
      } catch (error) {
        logger.error('Error deleting snippet:', { error, snippetId: id })
        if (error instanceof TRPCError) {
          throw error
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete snippet' })
      }
    }),

  // Share a snippet with groups or members via ResourceAccess
  share: protectedProcedure
    .input(
      z.object({
        snippetId: z.string(),
        sharingType: z.enum(SnippetSharingType),
        // For CUSTOM sharing type - supports both groups and users
        shares: z
          .array(
            z.object({
              granteeType: z.enum(['group', 'user']),
              granteeId: z.string(),
              permission: z.enum(['VIEW', 'EDIT']).default('VIEW'),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { snippetId, sharingType, shares } = input
      try {
        // Check if snippet exists and user is the creator
        const snippet = await ctx.db.query.Snippet.findFirst({
          where: and(
            eq(schema.Snippet.id, snippetId),
            eq(schema.Snippet.organizationId, organizationId),
            eq(schema.Snippet.createdById, userId), // Only creator can change sharing settings
            eq(schema.Snippet.isDeleted, false)
          ),
        })

        if (!snippet) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Snippet not found or you do not have permission to share it',
          })
        }

        // Start a transaction to update sharing settings
        await ctx.db.transaction(async (tx) => {
          // Update the snippet's sharing type
          await tx
            .update(schema.Snippet)
            .set({ sharingType, updatedAt: new Date() })
            .where(eq(schema.Snippet.id, snippetId))

          // If sharing type is CUSTOM, use ResourceAccess to set permissions
          if (sharingType === SnippetSharingType.GROUPS && shares && shares.length > 0) {
            // Separate group and user shares
            const groupShares = shares.filter((s) => s.granteeType === 'group')
            const userShares = shares.filter((s) => s.granteeType === 'user')

            // Set group access
            await setInstanceAccess(
              { db: tx, organizationId },
              toRecordId(BuiltInEntityType.snippet, snippetId),
              ResourceGranteeType.group,
              groupShares.map((s) => ({
                granteeId: s.granteeId,
                permission:
                  s.permission === 'EDIT' ? ResourcePermission.edit : ResourcePermission.view,
              }))
            )

            // Set user access
            await setInstanceAccess(
              { db: tx, organizationId },
              toRecordId(BuiltInEntityType.snippet, snippetId),
              ResourceGranteeType.user,
              userShares.map((s) => ({
                granteeId: s.granteeId,
                permission:
                  s.permission === 'EDIT' ? ResourcePermission.edit : ResourcePermission.view,
              }))
            )
          } else if (sharingType !== SnippetSharingType.GROUPS) {
            // Clear all ResourceAccess for this snippet when not using CUSTOM sharing
            await tx
              .delete(schema.ResourceAccess)
              .where(
                and(
                  eq(schema.ResourceAccess.entityDefinitionId, BuiltInEntityType.snippet),
                  eq(schema.ResourceAccess.entityInstanceId, snippetId)
                )
              )
          }
        })

        return { success: true }
      } catch (error) {
        logger.error('Error sharing snippet:', { error, snippetId })
        if (error instanceof TRPCError) {
          throw error
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update sharing settings',
        })
      }
    }),

  // Increment usage count
  incrementUsage: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { id } = input
      try {
        await ctx.db
          .update(schema.Snippet)
          .set({ usageCount: sql`${schema.Snippet.usageCount} + 1` })
          .where(
            and(
              eq(schema.Snippet.id, id),
              eq(schema.Snippet.organizationId, organizationId),
              eq(schema.Snippet.isDeleted, false)
            )
          )

        return { success: true }
      } catch (error) {
        logger.error('Error incrementing snippet usage:', { error, snippetId: id })
        // Don't throw an error for usage tracking failures
        return { success: false }
      }
    }),

  // Get all snippet folders
  getFolders: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    try {
      // Get folders with subfolders relation
      const folders = await ctx.db.query.SnippetFolder.findMany({
        where: eq(schema.SnippetFolder.organizationId, organizationId),
        with: {
          subfolders: true,
        },
        orderBy: [asc(schema.SnippetFolder.name)],
      })

      // Get snippet counts for each folder
      const folderIds = folders.map((f) => f.id)
      const snippetCounts =
        folderIds.length > 0
          ? await ctx.db
              .select({
                folderId: schema.Snippet.folderId,
                count: count(schema.Snippet.id),
              })
              .from(schema.Snippet)
              .where(
                and(
                  inArray(schema.Snippet.folderId, folderIds),
                  eq(schema.Snippet.isDeleted, false)
                )
              )
              .groupBy(schema.Snippet.folderId)
          : []

      // Merge the counts back into folders
      const foldersWithCounts = folders.map((folder) => ({
        ...folder,
        _count: {
          snippets: snippetCounts.find((c) => c.folderId === folder.id)?.count ?? 0,
        },
      }))

      return { folders: foldersWithCounts }
    } catch (error) {
      logger.error('Error getting snippet folders:', { error })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get snippet folders',
      })
    }
  }),

  // Create a new folder
  createFolder: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Folder name is required'),
        description: z.string().optional(),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { name, description, parentId } = input
      try {
        // Verify parent folder exists if provided
        if (parentId) {
          const parentFolder = await ctx.db.query.SnippetFolder.findFirst({
            where: and(
              eq(schema.SnippetFolder.id, parentId),
              eq(schema.SnippetFolder.organizationId, organizationId)
            ),
          })

          if (!parentFolder) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Parent folder not found' })
          }
        }

        // Check for name uniqueness within the parent folder
        const existingFolder = await ctx.db.query.SnippetFolder.findFirst({
          where: and(
            eq(schema.SnippetFolder.name, name),
            eq(schema.SnippetFolder.organizationId, organizationId),
            parentId
              ? eq(schema.SnippetFolder.parentId, parentId)
              : isNull(schema.SnippetFolder.parentId)
          ),
        })

        if (existingFolder) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A folder with this name already exists at this location',
          })
        }

        // Create the folder
        const [folder] = await ctx.db
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

        return { success: true, folder }
      } catch (error) {
        logger.error('Error creating snippet folder:', { error, input })
        if (error instanceof TRPCError) {
          throw error
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create folder' })
      }
    }),

  // Update a folder
  updateFolder: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1, 'Folder name is required').optional(),
        description: z.string().optional(),
        parentId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { id, name, description, parentId } = input
      try {
        // Check if folder exists
        const existingFolder = await ctx.db.query.SnippetFolder.findFirst({
          where: and(
            eq(schema.SnippetFolder.id, id),
            eq(schema.SnippetFolder.organizationId, organizationId)
          ),
        })

        if (!existingFolder) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' })
        }

        // Prevent circular references (folder can't be its own parent)
        if (parentId === id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'A folder cannot be its own parent' })
        }

        // Check for name uniqueness if changing name or parent
        if (
          (name && name !== existingFolder.name) ||
          (parentId !== undefined && parentId !== existingFolder.parentId)
        ) {
          const duplicateFolder = await ctx.db.query.SnippetFolder.findFirst({
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
              not(eq(schema.SnippetFolder.id, id))
            ),
          })

          if (duplicateFolder) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'A folder with this name already exists at this location',
            })
          }
        }

        // Check for circular references in the folder hierarchy
        if (parentId) {
          let currentParentId = input.parentId
          const visited = new Set([input.id])

          while (currentParentId) {
            if (visited.has(currentParentId)) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Circular reference detected in folder hierarchy',
              })
            }

            visited.add(currentParentId)
            const parentFolder = await ctx.db.query.SnippetFolder.findFirst({
              where: eq(schema.SnippetFolder.id, currentParentId),
              columns: { parentId: true },
            })

            if (!parentFolder) break
            currentParentId = parentFolder.parentId
          }
        }

        // Update the folder
        const updateData: any = {
          updatedAt: new Date(),
        }
        if (name !== undefined) updateData.name = name
        if (description !== undefined) updateData.description = description
        if (parentId !== undefined)
          updateData.parentId = input.parentId === null ? null : input.parentId

        const [updatedFolder] = await ctx.db
          .update(schema.SnippetFolder)
          .set(updateData)
          .where(eq(schema.SnippetFolder.id, id))
          .returning()

        return { success: true, folder: updatedFolder }
      } catch (error) {
        logger.error('Error updating snippet folder:', { error, folderId: id })
        if (error instanceof TRPCError) {
          throw error
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update folder' })
      }
    }),

  // Delete a folder
  deleteFolder: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        moveSnippetsTo: z.string().optional(), // Target folder for snippets if they should be moved
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { id, moveSnippetsTo } = input
      try {
        // Check if folder exists
        const existingFolder = await ctx.db.query.SnippetFolder.findFirst({
          where: and(
            eq(schema.SnippetFolder.id, id),
            eq(schema.SnippetFolder.organizationId, organizationId)
          ),
        })

        if (!existingFolder) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' })
        }

        // Verify target folder if provided
        if (moveSnippetsTo) {
          if (moveSnippetsTo === id) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot move snippets to the folder being deleted',
            })
          }

          const targetFolder = await ctx.db.query.SnippetFolder.findFirst({
            where: and(
              eq(schema.SnippetFolder.id, moveSnippetsTo),
              eq(schema.SnippetFolder.organizationId, organizationId)
            ),
          })

          if (!targetFolder) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Target folder not found' })
          }
        }

        // Start a transaction to handle deletion
        await ctx.db.transaction(async (tx) => {
          // Check for subfolders
          const subfolders = await tx.query.SnippetFolder.findMany({
            where: eq(schema.SnippetFolder.parentId, id),
          })

          if (subfolders.length > 0) {
            // Update subfolders to have the same parent as the deleted folder
            await tx
              .update(schema.SnippetFolder)
              .set({ parentId: existingFolder.parentId })
              .where(eq(schema.SnippetFolder.parentId, id))
          }

          // Handle snippets in the folder
          if (moveSnippetsTo) {
            // Move snippets to target folder
            await tx
              .update(schema.Snippet)
              .set({ folderId: moveSnippetsTo })
              .where(eq(schema.Snippet.folderId, id))
          } else {
            // Remove folder association from snippets
            await tx
              .update(schema.Snippet)
              .set({ folderId: null })
              .where(eq(schema.Snippet.folderId, id))
          }

          // Delete the folder
          await tx.delete(schema.SnippetFolder).where(eq(schema.SnippetFolder.id, id))
        })

        return { success: true }
      } catch (error) {
        logger.error('Error deleting snippet folder:', { error, folderId: id })
        if (error instanceof TRPCError) {
          throw error
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete folder' })
      }
    }),
})
