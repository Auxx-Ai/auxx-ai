// src/server/services/embedding-service.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { OpenAIEmbeddings } from '@langchain/openai'
import { and, asc, eq, sql } from 'drizzle-orm'

const logger = createScopedLogger('embedding-service')

// Configuration
const embeddingModel = 'text-embedding-3-small'
const chunkSize = 1000 // Maximum recommended size for embedding chunks
const chunkOverlap = 200 // Overlap between chunks

/**
 * Process an embedding job by generating embeddings for all documents in the job
 * @param jobId ID of the embedding job to process
 */
export async function processEmbeddingJob(jobId: string): Promise<void> {
  try {
    // Get the job from the database
    const [job] = await db
      .select()
      .from(schema.embedding_jobs)
      .where(eq(schema.embedding_jobs.id, jobId))
      .limit(1)

    if (!job) {
      logger.error('Job not found', { jobId })
      return
    }

    // Mark job as processing
    await db
      .update(schema.embedding_jobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(schema.embedding_jobs.id, jobId))

    // Parse the documents
    const documents = JSON.parse(job.documents as string)

    // Initialize the embedding model
    const embeddings = new OpenAIEmbeddings({ modelName: embeddingModel })

    // Process each document
    for (const doc of documents) {
      try {
        // Split content into chunks
        const chunks = splitIntoChunks(doc.content, chunkSize, chunkOverlap)

        // Generate embeddings for each chunk
        for (const [index, chunk] of chunks.entries()) {
          const embedding = await embeddings.embedQuery(chunk)

          // Store the embedding in the database
          await db.insert(schema.embeddings).values({
            jobId: job.id,
            collection: job.collection,
            documentId: doc.id,
            content: chunk,
            metadata: JSON.stringify({
              title: doc.title || '',
              chunkIndex: index,
              totalChunks: chunks.length,
            }),
            embedding: JSON.stringify(embedding),
            createdAt: new Date(),
          })
        }

        // Update processed count
        await db
          .update(schema.embedding_jobs)
          .set({
            processedCount: sql`${schema.embedding_jobs.processedCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.embedding_jobs.id, jobId))
      } catch (error) {
        logger.error('Error processing document', { error, documentId: doc.id, jobId })

        // Update error count
        await db
          .update(schema.embedding_jobs)
          .set({
            errorCount: sql`${schema.embedding_jobs.errorCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.embedding_jobs.id, jobId))
      }
    }

    // Mark job as completed
    await db
      .update(schema.embedding_jobs)
      .set({ status: 'completed_success', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.embedding_jobs.id, jobId))
  } catch (error) {
    logger.error('Error processing embedding job', { error, jobId })

    // Mark job as failed
    await db
      .update(schema.embedding_jobs)
      .set({ status: 'failed', error: String(error), updatedAt: new Date() })
      .where(eq(schema.embedding_jobs.id, jobId))
  }
}

/**
 * Helper function to split text into chunks with overlap
 */
function splitIntoChunks(text: string, size: number, overlap: number): string[] {
  if (!text) return []

  const chunks: string[] = []
  let currentIndex = 0

  while (currentIndex < text.length) {
    const chunk = text.substring(currentIndex, Math.min(currentIndex + size, text.length))

    chunks.push(chunk)
    currentIndex += size - overlap

    // Prevent infinite loop if overlap is too large
    if (size <= overlap && currentIndex < text.length) {
      currentIndex = Math.min(currentIndex + 1, text.length)
    }
  }

  return chunks
}

/**
 * Delete all embeddings for a specific document
 */
export async function deleteEmbeddingsForDocument(
  collection: string,
  documentId: string
): Promise<void> {
  try {
    // Delete all embeddings for this document
    await db
      .delete(schema.embeddings)
      .where(
        and(
          eq(schema.embeddings.collection, collection),
          eq(schema.embeddings.documentId, documentId)
        )
      )

    logger.info('Deleted embeddings for document', { collection, documentId })
  } catch (error) {
    logger.error('Error deleting embeddings', { error, collection, documentId })
    throw error
  }
}

/**
 * Process the next pending embedding job in the queue
 */
export async function processNextPendingJob(): Promise<void> {
  try {
    // Get the oldest pending job
    const [pendingJob] = await db
      .select()
      .from(schema.embedding_jobs)
      .where(eq(schema.embedding_jobs.status, 'pending'))
      .orderBy(asc(schema.embedding_jobs.createdAt))
      .limit(1)

    if (!pendingJob) {
      // No pending jobs
      return
    }

    // Process the job
    await processEmbeddingJob(pendingJob.id)
  } catch (error) {
    logger.error('Error processing next pending job', { error })
  }
}
