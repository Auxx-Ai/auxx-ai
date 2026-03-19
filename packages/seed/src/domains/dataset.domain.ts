// packages/seed/src/domains/dataset.domain.ts
// Dataset domain seeder for demo organizations

import { createId } from '@paralleldrive/cuid2'

/** DatasetDomain creates knowledge base datasets for demo organizations. */
export class DatasetDomain {
  private readonly organizationId: string
  private readonly userId: string

  constructor(organizationId: string, userId: string) {
    this.organizationId = organizationId
    this.userId = userId
  }

  async insertDirectly(db: any): Promise<{ datasetId: string }> {
    const { schema } = await import('@auxx/database')

    const datasetId = createId()
    const now = new Date()

    console.log('📚 Creating demo dataset...')
    await db
      .insert(schema.Dataset)
      .values({
        id: datasetId,
        name: 'Support Knowledge Base',
        description:
          'Knowledge base containing support documentation, FAQs, and product guides for AI-assisted customer support.',
        status: 'ACTIVE',
        isPublic: false,
        documentCount: 0,
        totalSize: 0,
        vectorDbType: 'POSTGRESQL',
        vectorDbConfig: {},
        chunkSettings: {
          strategy: 'FIXED_SIZE',
          size: 1024,
          overlap: 50,
          delimiter: '\n\n',
          preprocessing: {
            normalizeWhitespace: true,
            removeUrlsAndEmails: false,
          },
        },
        organizationId: this.organizationId,
        createdById: this.userId,
        updatedAt: now,
        createdAt: now,
      })
      .onConflictDoNothing()
    console.log('✅ Demo dataset created')

    return { datasetId }
  }
}
