import { createScopedLogger } from '@auxx/logger'
import { LabelRepo } from './label-repo'
import { LabelProviderFactory } from './label-provider-factory'
import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ReauthenticationRequiredError } from '../errors-handlers'
import { LabelType } from '@auxx/database/enums'
const logger = createScopedLogger('label-service')
export class LabelService {
  private repository: LabelRepo
  constructor() {
    this.repository = new LabelRepo()
  }
  async getAllLabels(organizationId: string) {
    try {
      // Get provider
      // Get all labels from the provider
      // const providerLabels = await provider.getLabels()
      // Get all labels from the database
      return await this.repository.findAll(organizationId)
      // return { dbLabels }
    } catch (error) {
      logger.error('Error getting all labels', { error })
      throw error
    }
  }
  async getLabels(organizationId: string, integrationType: string, integrationId: string) {
    try {
      // Get provider
      const provider = await LabelProviderFactory.createProvider(
        integrationType,
        organizationId,
        integrationId
      )
      // Get all labels from the database
      const dbLabels = await this.repository.findAll(organizationId, integrationType, integrationId)
      return dbLabels
    } catch (error) {
      if (error instanceof ReauthenticationRequiredError) {
        // Pass this error up to the controller
        throw error
      }
      logger.error('Error getting labels', { error })
      throw error
    }
  }
  async syncAllLabels(organizationId: string, userId: string) {
    try {
      // Get all labels from the database
      const integrations = await db
        .select({ id: schema.Integration.id, provider: schema.Integration.provider })
        .from(schema.Integration)
        .where(eq(schema.Integration.organizationId, organizationId))
      if (!integrations.length) {
        return []
      }
      return await Promise.all(
        integrations.map(async (integration) => {
          const { id: integrationId, provider } = integration
          return await this.syncLabels(organizationId, provider, integrationId, userId)
        })
      )
    } catch (error) {
      logger.error('Error syncing all labels', { error })
      throw error
    }
  }
  async syncLabels(
    organizationId: string,
    integrationType: string,
    integrationId: string,
    userId: string
  ) {
    try {
      // Get provider
      const provider = await LabelProviderFactory.createProvider(
        integrationType,
        organizationId,
        integrationId
      )
      // Get all labels from the provider
      const providerLabels = await provider.getLabels()
      // Get all labels from the database
      const dbLabels = await this.repository.findAll(organizationId, integrationType, integrationId)
      // Map provider labels by their ID for quick lookup
      const providerLabelsMap = new Map(providerLabels.map((label) => [label.id, label]))
      // Map db labels by provider label ID for quick lookup
      const dbLabelsMap = new Map(dbLabels.map((label) => [label.labelId, label]))
      // Arrays to track operations
      const labelsToCreate: any[] = []
      const labelsToUpdate: any[] = []
      const labelsToDelete: string[] = []
      // Find labels to create or update
      for (const providerLabel of providerLabels) {
        const dbLabel = dbLabelsMap.get(providerLabel.id)
        if (!dbLabel) {
          // Label exists in provider but not in DB - create it
          labelsToCreate.push({
            labelId: providerLabel.id,
            name: providerLabel.name,
            type: providerLabel.type === 'system' ? LabelType.system : LabelType.user,
            backgroundColor: providerLabel.backgroundColor || null,
            textColor: providerLabel.textColor || null,
            isVisible: providerLabel.visible ?? true,
          })
        } else {
          // Label exists in both - check if update needed
          if (
            dbLabel.name !== providerLabel.name ||
            dbLabel.backgroundColor !== (providerLabel.backgroundColor || null) ||
            dbLabel.textColor !== (providerLabel.textColor || null) ||
            dbLabel.isVisible !== (providerLabel.visible ?? true)
          ) {
            labelsToUpdate.push({
              id: dbLabel.id,
              name: providerLabel.name,
              backgroundColor: providerLabel.backgroundColor || null,
              textColor: providerLabel.textColor || null,
              isVisible: providerLabel.visible ?? true,
            })
          }
        }
      }
      // Find labels to delete (in DB but not in provider)
      for (const dbLabel of dbLabels) {
        if (!providerLabelsMap.has(dbLabel.labelId)) {
          labelsToDelete.push(dbLabel.id)
        }
      }
      // Perform the operations
      const createdLabels = await Promise.all(
        labelsToCreate.map((label) =>
          this.repository.create(organizationId, integrationType, integrationId, userId, label)
        )
      )
      const updatedLabels = await Promise.all(
        labelsToUpdate.map((label) =>
          this.repository.update(label.id, {
            name: label.name,
            backgroundColor: label.backgroundColor,
            textColor: label.textColor,
            isVisible: label.isVisible,
          })
        )
      )
      await Promise.all(labelsToDelete.map((id) => this.repository.delete(id)))
      // Get the final list of labels
      return await this.repository.findAll(organizationId, integrationType, integrationId)
    } catch (error) {
      logger.error('Error syncing labels', { error })
      throw error
    }
  }
  async createLabel(
    organizationId: string,
    integrationType: string,
    integrationId: string,
    userId: string,
    labelData: {
      name: string
      backgroundColor?: string
      textColor?: string
      description?: string
    }
  ) {
    try {
      // Get provider
      const provider = await LabelProviderFactory.createProvider(
        integrationType,
        organizationId,
        integrationId
      )
      // Create label in provider
      const providerLabel = await provider.createLabel({
        name: labelData.name,
        color: labelData.backgroundColor,
        visible: true,
      })
      // Create label in database
      return await this.repository.create(organizationId, integrationType, integrationId, userId, {
        labelId: providerLabel.id,
        name: providerLabel.name,
        type: LabelType.user,
        backgroundColor: labelData.backgroundColor,
        textColor: labelData.textColor,
        description: labelData.description,
        isVisible: true,
      })
    } catch (error) {
      logger.error('Error creating label', { error })
      throw error
    }
  }
  async updateLabel(
    labelId: string,
    organizationId: string,
    integrationType: string,
    integrationId: string,
    changes: {
      name?: string
      backgroundColor?: string
      textColor?: string
      description?: string
      isVisible?: boolean
    }
  ) {
    try {
      // Get the label
      const [label] = await db
        .select()
        .from(schema.Label)
        .where(eq(schema.Label.id, labelId))
        .limit(1)
      if (!label) {
        throw new Error('Label not found')
      }
      // Get provider
      const provider = await LabelProviderFactory.createProvider(
        integrationType,
        organizationId,
        integrationId
      )
      // Update label in provider
      await provider.updateLabel(label.labelId, {
        name: changes.name,
        color: changes.backgroundColor,
        visible: changes.isVisible,
      })
      // Update label in database
      return await this.repository.update(labelId, changes)
    } catch (error) {
      logger.error('Error updating label', { error })
      throw error
    }
  }
  async deleteLabel(
    labelId: string,
    organizationId: string,
    integrationType: string,
    integrationId: string
  ) {
    try {
      // Get the label
      const [label] = await db
        .select()
        .from(schema.Label)
        .where(eq(schema.Label.id, labelId))
        .limit(1)
      if (!label) {
        throw new Error('Label not found')
      }
      // Get provider
      const provider = await LabelProviderFactory.createProvider(
        integrationType,
        organizationId,
        integrationId
      )
      // Delete label in provider
      await provider.deleteLabel(label.labelId)
      // Delete label in database
      return await this.repository.delete(labelId)
    } catch (error) {
      logger.error('Error deleting label', { error })
      throw error
    }
  }
  // Thread label operations
  async addLabelToThread(
    labelId: string,
    threadId: string,
    organizationId: string,
    integrationType: string,
    integrationId: string
  ) {
    try {
      // Get the label
      const [label] = await db
        .select()
        .from(schema.Label)
        .where(eq(schema.Label.id, labelId))
        .limit(1)
      if (!label) {
        throw new Error('Label not found')
      }
      // Get the thread
      const [thread] = await db
        .select()
        .from(schema.Thread)
        .where(eq(schema.Thread.id, threadId))
        .limit(1)
      if (!thread) {
        throw new Error('Thread not found')
      }
      // Get provider
      const provider = await LabelProviderFactory.createProvider(
        integrationType,
        organizationId,
        integrationId
      )
      // Add label to thread in provider
      await provider.addLabelToThread(label.labelId, threadId)
      // Add label to thread in database
      return await this.repository.addLabelToThread(labelId, threadId)
    } catch (error) {
      logger.error('Error adding label to thread', { error })
      throw error
    }
  }
  async removeLabelFromThread(
    labelId: string,
    threadId: string,
    organizationId: string,
    integrationType: string,
    integrationId: string
  ) {
    try {
      // Get the label
      const [label] = await db
        .select()
        .from(schema.Label)
        .where(eq(schema.Label.id, labelId))
        .limit(1)
      if (!label) {
        throw new Error('Label not found')
      }
      // Get the thread
      const [thread] = await db
        .select()
        .from(schema.Thread)
        .where(eq(schema.Thread.id, threadId))
        .limit(1)
      if (!thread) {
        throw new Error('Thread not found')
      }
      // Get provider
      const provider = await LabelProviderFactory.createProvider(
        integrationType,
        organizationId,
        integrationId
      )
      // Remove label from thread in provider
      await provider.removeLabelFromThread(label.labelId, threadId)
      // Remove label from thread in database
      return await this.repository.removeLabelFromThread(labelId, threadId)
    } catch (error) {
      logger.error('Error removing label from thread', { error })
      throw error
    }
  }
  async getThreadLabels(threadId: string) {
    try {
      return await this.repository.getThreadLabels(threadId)
    } catch (error) {
      logger.error('Error getting thread labels', { error })
      throw error
    }
  }
  async toggleLabelVisibility(labelId: string, visible: boolean) {
    try {
      // This only updates the database record, not the provider
      return await this.repository.update(labelId, { isVisible: visible })
    } catch (error) {
      logger.error('Error toggling label visibility', { error })
      throw error
    }
  }
}
