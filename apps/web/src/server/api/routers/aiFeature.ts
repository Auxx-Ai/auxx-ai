// apps/web/src/server/api/routers/aiFeature.ts

import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { createScopedLogger } from '@auxx/logger'
import { getAIComposeService } from '@auxx/lib/ai-features/compose'
import { getAIGeneratorService } from '@auxx/lib/ai-features/generator'
import {
  AI_OPERATION,
  AI_TONE_TYPE,
  OUTPUT_FORMAT,
  COMPOSE_ENTITY_TYPE,
  type AIComposeRequest,
  type AIComposeResponse,
} from '@auxx/lib/types'

const logger = createScopedLogger('ai-feature-router')

// Zod schemas for validation
const AIComposeInputSchema = z.object({
  operation: z.enum(AI_OPERATION),
  messageHtml: z.string(),
  entityType: z.literal(COMPOSE_ENTITY_TYPE.THREAD),
  entityId: z.string().optional(),
  senderId: z.string().optional(), // Will be filled from session
  tone: z.enum(AI_TONE_TYPE).optional(),
  language: z.string().optional(), // Allow any string for flexibility
  output: z.enum(OUTPUT_FORMAT),
})

export const aiFeatureRouter = createTRPCRouter({
  /**
   * Protected procedure for AI compose operations
   */
  compose: protectedProcedure
    .input(AIComposeInputSchema)
    .mutation(async ({ ctx, input }): Promise<AIComposeResponse> => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Organization ID is required for AI operations',
        })
      }

      logger.info('AI compose request', {
        operation: input.operation,
        organizationId,
        userId,
        hasEntityId: !!input.entityId,
      })

      try {
        // Pre-validation based on operation
        validateOperationInput(input)

        // Get AI compose service
        const aiService = getAIComposeService(ctx.db)

        // Process the request
        const request: AIComposeRequest = {
          ...input,
          senderId: userId, // Override with authenticated user ID
        }

        const response = await aiService.processRequest(request, organizationId, userId)

        logger.info('AI compose completed', {
          operation: input.operation,
          tokensUsed: response.metadata?.tokensUsed,
        })

        return response
      } catch (error) {
        logger.error('AI compose failed', {
          operation: input.operation,
          error: error instanceof Error ? error.message : String(error),
        })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'AI operation failed',
        })
      }
    }),

  /**
   * Generate content (prompt or code) using AI
   */
  generateContent: protectedProcedure
    .input(
      z.object({
        instruction: z.string().min(1, 'Instructions are required'),
        generationType: z.enum(['prompt', 'code']),
        language: z.enum(['javascript', 'json']).optional(),
        currentContent: z.string().optional(),
        idealOutput: z.string().optional(),
        modelId: z.string().optional(),
        nodeId: z.string(),
        workflowId: z.string(),
        // Code generation specific fields
        codeInputs: z
          .array(
            z.object({
              name: z.string(),
              description: z.string().optional(),
            })
          )
          .optional(),
        codeOutputs: z
          .array(
            z.object({
              name: z.string(),
              type: z.string(),
              description: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Organization ID is required',
        })
      }

      // Validate language is provided for code generation
      if (input.generationType === 'code' && !input.language) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Language is required for code generation',
        })
      }

      logger.info('AI generate content request', {
        generationType: input.generationType,
        language: input.language,
        organizationId,
        userId,
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        inputCount: input.codeInputs?.length ?? 0,
        outputCount: input.codeOutputs?.length ?? 0,
      })

      try {
        const generatorService = getAIGeneratorService(ctx.db)

        return await generatorService.generateContent(
          {
            instruction: input.instruction,
            generationType: input.generationType,
            language: input.language,
            currentContent: input.currentContent,
            idealOutput: input.idealOutput,
            modelId: input.modelId,
            codeInputs: input.codeInputs,
            codeOutputs: input.codeOutputs,
          },
          organizationId,
          userId
        )
      } catch (error) {
        logger.error('AI generate content failed', {
          generationType: input.generationType,
          error: error instanceof Error ? error.message : String(error),
        })

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Content generation failed',
        })
      }
    }),
})

/**
 * Validate operation-specific input requirements
 */
function validateOperationInput(input: z.infer<typeof AIComposeInputSchema>) {
  switch (input.operation) {
    case AI_OPERATION.COMPOSE:
      if (!input.messageHtml && !input.entityId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Either message content or entity ID is required for compose',
        })
      }
      break

    case AI_OPERATION.TONE:
      if (!input.tone) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tone is required for tone adjustment',
        })
      }
      if (!input.messageHtml) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Message content is required for tone adjustment',
        })
      }
      break

    case AI_OPERATION.TRANSLATE:
      if (!input.language) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Target language is required for translation',
        })
      }
      if (!input.messageHtml) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Message content is required for translation',
        })
      }
      break

    case AI_OPERATION.FIX_GRAMMAR:
    case AI_OPERATION.EXPAND:
    case AI_OPERATION.SHORTEN:
      if (!input.messageHtml) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Message content is required for ${input.operation}`,
        })
      }
      break
  }
}
