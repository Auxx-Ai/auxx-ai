// src/server/api/routers/embedding.ts
// Deprecated

import { schema } from '@auxx/database'
import { processNextPendingJob } from '@auxx/lib/embeddings'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api/embedding')

export const embeddingRouter = createTRPCRouter({
  // Get embedding status for an article
  getStatus: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      if (!organizationId) {
        throw new Error('Organization ID is required')
      }

      // First check if the article exists and belongs to the organization
      const [article] = await ctx.db
        .select({
          id: schema.Article.id,
          content: schema.Article.content,
          title: schema.Article.title,
        })
        .from(schema.Article)
        .where(
          and(
            eq(schema.Article.id, input.articleId),
            eq(schema.Article.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!article) {
        throw new Error('Article not found')
      }

      // Get all article content embedding jobs
      const embeddingJobs = await ctx.db
        .select()
        .from(schema.embedding_jobs)
        .where(eq(schema.embedding_jobs.collection, 'article_content'))
        .orderBy(desc(schema.embedding_jobs.createdAt))

      // Manually find jobs that contain our article ID in the documents JSON
      const embeddingJob = embeddingJobs.find((job) => {
        try {
          // Parse the documents field (stored as a string in the database)
          const documents = Array.isArray(job.documents)
            ? job.documents
            : typeof job.documents === 'string'
              ? JSON.parse(job.documents as string)
              : []
          return documents.some((doc: any) => doc.id === input.articleId)
        } catch (err) {
          logger.error('Error parsing job documents:', { error: err, jobId: job.id })
          return false
        }
      })

      if (!embeddingJob) {
        return { status: 'not_started', message: 'No embedding job found for this article' }
      }

      return {
        status: embeddingJob.status,
        processedCount: embeddingJob.processedCount,
        totalCount: embeddingJob.documentCount,
        createdAt: embeddingJob.createdAt,
        completedAt: embeddingJob.completedAt,
        error: embeddingJob.error,
      }
    }),

  // Create a new embedding job for an article
  regenerate: protectedProcedure
    .input(
      z.object({
        articleId: z.string().optional(),
        fileId: z.string().optional(),
        collection: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      if (!organizationId) {
        throw new Error('Organization ID is required')
      }

      // Handle article content embedding
      if (input.articleId) {
        // First check if the article exists and belongs to the organization
        const [article] = await ctx.db
          .select({
            id: schema.Article.id,
            content: schema.Article.content,
            title: schema.Article.title,
          })
          .from(schema.Article)
          .where(
            and(
              eq(schema.Article.id, input.articleId),
              eq(schema.Article.organizationId, organizationId)
            )
          )
          .limit(1)

        if (!article) {
          throw new Error('Article not found')
        }

        // Create a new embedding job and queue it for processing
        const [job] = await ctx.db
          .insert(schema.embedding_jobs)
          .values({
            organizationId,
            status: 'pending',
            collection: 'article_content',
            documents: [{ id: article.id, content: article.content, title: article.title }] as any,
            documentCount: 1,
            processedCount: 0,
            errorCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning()

        // Queue the job for processing using BullMQ
        // await queueEmbeddingJob(job.id, organizationId)

        return { jobId: job.id, status: job.status, message: 'Embedding job created successfully' }
      }

      // Handle file embedding
      else if (input.fileId) {
        const collection = input.collection || 'article_files'

        // Check if the file exists and belongs to the organization
        const [file] = await ctx.db
          .select({ id: schema.File.id, name: schema.File.name })
          .from(schema.File)
          .where(
            and(eq(schema.File.id, input.fileId), eq(schema.File.organizationId, organizationId))
          )
          .limit(1)

        if (!file) {
          throw new Error('File not found')
        }

        // Create a new embedding job
        const [job] = await ctx.db
          .insert(schema.embedding_jobs)
          .values({
            organizationId,
            status: 'pending',
            collection,
            documents: [{ id: file.id, content: file.name }] as any,
            documentCount: 1,
            processedCount: 0,
            errorCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning()

        // Queue the job for processing using BullMQ
        // await queueEmbeddingJob(job.id, organizationId)

        return {
          jobId: job.id,
          status: job.status,
          message: 'File embedding job created successfully',
        }
      } else {
        throw new Error('Either articleId or fileId is required')
      }
    }),

  // Get embedding jobs for a user
  getJobs: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(10),
        cursor: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      let cursorCreatedAt: string | null = null
      if (input.cursor) {
        const [row] = await ctx.db
          .select({ createdAt: schema.embedding_jobs.createdAt })
          .from(schema.embedding_jobs)
          .where(eq(schema.embedding_jobs.id, input.cursor))
          .limit(1)
        cursorCreatedAt = row?.createdAt ?? null
      }

      const jobs = await ctx.db
        .select()
        .from(schema.embedding_jobs)
        .where(
          and(
            eq(schema.embedding_jobs.organizationId, organizationId),
            ...(input.status ? [eq(schema.embedding_jobs.status, input.status as any)] : []),
            ...(cursorCreatedAt
              ? [lt(schema.embedding_jobs.createdAt, cursorCreatedAt as any)]
              : [])
          )
        )
        .orderBy(desc(schema.embedding_jobs.createdAt))
        .limit(input.limit + 1)

      let nextCursor: typeof input.cursor | undefined
      if (jobs.length > input.limit) {
        const nextItem = jobs.pop()!
        nextCursor = nextItem.id
      }

      return { jobs, nextCursor }
    }),

  // Process the next pending embedding job
  processNextJob: protectedProcedure.mutation(async ({ ctx }) => {
    // const userId = ctx.session.user.id
    const { userId } = ctx.session

    // Only allow admins or system users to process jobs
    const [user] = await ctx.db
      .select({ isSuperAdmin: schema.User.isSuperAdmin })
      .from(schema.User)
      .where(eq(schema.User.id, userId))
      .limit(1)

    if (!user?.isSuperAdmin) {
      throw new Error('Unauthorized to process embedding jobs')
    }

    // Use the BullMQ helper to process the next job
    const jobId = await processNextPendingJob()

    if (!jobId) {
      return { message: 'No pending jobs found' }
    }

    return { message: 'Job processing started', jobId }
  }),

  // Delete embeddings for a document
  deleteEmbeddings: protectedProcedure
    .input(z.object({ collection: z.string(), documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Only allow admins or system users to delete embeddings
      const [user] = await ctx.db
        .select({ isSuperAdmin: schema.User.isSuperAdmin })
        .from(schema.User)
        .where(eq(schema.User.id, userId))
        .limit(1)

      if (!user?.isSuperAdmin) {
        throw new Error('Unauthorized to delete embeddings')
      }

      // Queue the deletion job
      // await queueDeleteEmbeddings(input.collection, input.documentId, organizationId)

      return { message: 'Embeddings deletion job queued successfully' }
    }),

  // Directly regenerate article embeddings
  regenerateArticleEmbeddings: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      if (!organizationId) {
        throw new Error('Organization ID is required')
      }

      // First check if the article exists and belongs to the organization
      const [article] = await ctx.db
        .select({ id: schema.Article.id })
        .from(schema.Article)
        .where(
          and(
            eq(schema.Article.id, input.articleId),
            eq(schema.Article.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!article) {
        throw new Error('Article not found')
      }

      // Queue the regeneration job
      // await queueRegenerateArticleEmbeddings(input.articleId, organizationId)

      return {
        message: 'Article embedding regeneration job queued successfully',
        articleId: input.articleId,
      }
    }),
})
