// server/api/routers/snippets.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { createScopedLogger } from '@auxx/logger'
import { database, schema } from '@auxx/database'
import { OrganizationMemberStatus, SnippetSharingType } from '@auxx/database/enums'
import {
  and,
  or,
  eq,
  ilike,
  desc,
  asc,
  not,
  isNull,
  sql,
  count,
  inArray,
  exists,
  type SQL,
} from 'drizzle-orm'

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
          // Include user's own OR org shared OR shared to user's groups/membership
          filters.push(
            or(
              eq(schema.Snippet.createdById, userId),
              eq(schema.Snippet.sharingType, SnippetSharingType.ORGANIZATION),
              // Shared to user's groups
              exists(
                ctx.db
                  .select()
                  .from(schema.SnippetShare)
                  .innerJoin(schema.Group, eq(schema.SnippetShare.groupId, schema.Group.id))
                  .innerJoin(schema.GroupMember, eq(schema.Group.id, schema.GroupMember.groupId))
                  .where(
                    and(
                      eq(schema.SnippetShare.snippetId, schema.Snippet.id),
                      eq(schema.GroupMember.userId, userId),
                      eq(schema.GroupMember.isActive, true)
                    )
                  )
              ),
              // Shared directly to user
              exists(
                ctx.db
                  .select()
                  .from(schema.SnippetShare)
                  .innerJoin(
                    schema.OrganizationMember,
                    eq(schema.SnippetShare.memberId, schema.OrganizationMember.id)
                  )
                  .where(
                    and(
                      eq(schema.SnippetShare.snippetId, schema.Snippet.id),
                      eq(schema.OrganizationMember.userId, userId)
                    )
                  )
              )
            )!
          )
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

        // Get shares count for each snippet
        const snippetIds = snippets.map((s) => s.id)
        const sharesCounts =
          snippetIds.length > 0
            ? await ctx.db
                .select({
                  snippetId: schema.SnippetShare.snippetId,
                  count: count(schema.SnippetShare.id),
                })
                .from(schema.SnippetShare)
                .where(inArray(schema.SnippetShare.snippetId, snippetIds))
                .groupBy(schema.SnippetShare.snippetId)
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
      const snippet = await ctx.db.query.Snippet.findFirst({
        where: and(
          eq(schema.Snippet.id, id),
          eq(schema.Snippet.organizationId, organizationId),
          eq(schema.Snippet.isDeleted, false),
          or(
            eq(schema.Snippet.createdById, userId), // User's own snippets
            eq(schema.Snippet.sharingType, SnippetSharingType.ORGANIZATION) // Org-wide shared snippets
            // TODO: Add shared snippets logic - requires complex subqueries
          )!
        ),
        with: {
          folder: true,
          createdBy: {
            columns: { id: true, name: true, email: true, image: true },
          },
          shares: {
            with: {
              group: true,
              member: {
                with: { user: true },
              },
            },
          },
        },
      })

      if (!snippet) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Snippet not found' })
      }

      // Check if user can edit the snippet
      const canEdit =
        snippet.createdById === userId ||
        snippet.shares.some(
          (share: any) =>
            (share.groupId && share.group?.members.some((m: any) => m.userId === userId)) ||
            (share.memberId && share.member?.userId === userId && share.permission === 'EDIT')
        )

      return { snippet, canEdit }
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
        // Check if snippet exists and user has edit access
        const existingSnippet = await ctx.db.query.Snippet.findFirst({
          where: and(
            eq(schema.Snippet.id, id),
            eq(schema.Snippet.organizationId, organizationId),
            eq(schema.Snippet.isDeleted, false),
            or(
              eq(schema.Snippet.createdById, userId) // User's own snippets
              // TODO: Add shared snippets with EDIT permission logic - requires complex subqueries
            )!
          ),
          with: {
            shares: {
              with: {
                group: {
                  with: {
                    members: {
                      where: and(
                        eq(schema.OrganizationMember.userId, userId),
                        eq(schema.OrganizationMember.status, OrganizationMemberStatus.ACTIVE)
                      ),
                    },
                  },
                },
                member: true,
              },
            },
          },
        })

        if (!existingSnippet) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Snippet not found or you do not have permission to edit it',
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

  // Share a snippet with groups or members
  share: protectedProcedure
    .input(
      z.object({
        snippetId: z.string(),
        sharingType: z.enum(SnippetSharingType),
        // For GROUPS or MEMBERS sharing type
        shares: z
          .array(
            z.object({
              groupId: z.string().optional(),
              memberId: z.string().optional(),
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
            .where(eq(schema.Snippet.id, input.snippetId))

          // Remove existing shares
          await tx.delete(schema.SnippetShare).where(eq(schema.SnippetShare.snippetId, snippetId))

          // If sharing with groups or members, create the new shares
          if (
            (sharingType === SnippetSharingType.GROUPS ||
              sharingType === SnippetSharingType.MEMBERS) &&
            shares &&
            shares.length > 0
          ) {
            // Validate shares
            for (const share of shares) {
              if (input.sharingType === SnippetSharingType.GROUPS && !share.groupId) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message: 'Group ID is required when sharing type is GROUPS',
                })
              }
              if (input.sharingType === SnippetSharingType.MEMBERS && !share.memberId) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message: 'Member ID is required when sharing type is MEMBERS',
                })
              }
            }

            // Create the shares
            await tx.insert(schema.SnippetShare).values(
              shares.map((share) => ({
                snippetId,
                groupId: share.groupId,
                memberId: share.memberId,
                permission: share.permission,
                updatedAt: new Date(),
              }))
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
