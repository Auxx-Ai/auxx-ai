// ~/server/api/routers/signature.ts

import { SignatureSharingType } from '@auxx/database/enums'
import { SignatureService } from '@auxx/lib/signatures'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
export const signatureRouter = createTRPCRouter({
  // Get all signatures accessible to the current user
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const { userId, organizationId } = ctx.session
    const signatureService = new SignatureService(ctx.db, organizationId, userId)
    return await signatureService.getAllSignatures()
  }),
  // Get a signature by ID
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { userId, organizationId } = ctx.session
    const { id } = input
    const signatureService = new SignatureService(ctx.db, organizationId, userId)
    return await signatureService.getSignatureById(id)
  }),
  // Get default signature
  getDefault: protectedProcedure.query(async ({ ctx }) => {
    const { userId, organizationId } = ctx.session
    const signatureService = new SignatureService(ctx.db, organizationId, userId)
    return await signatureService.getDefaultSignature()
  }),
  /**
   * Get the default signature based on user/org context.
   * Priority: User's general default > Organization-wide default.
   */
  getDefaultForContext: protectedProcedure
    .input(
      z.object({
        // Keep inboxId input for future potential use (e.g., inbox-specific defaults)
        // Making optional as it's currently unused in the service logic.
        // inboxId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const signatureService = new SignatureService(ctx.db, organizationId, userId)
      // Pass inboxId to the service method
      return await signatureService.getDefaultSignatureForContext()
    }),
  // Get signatures for a specific integration
  getForIntegration: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const { integrationId } = input
      const signatureService = new SignatureService(ctx.db, organizationId, userId)
      return await signatureService.getSignaturesForIntegration(integrationId)
    }),
  // Create a new signature
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
        body: z.string().min(1, 'Signature content is required'),
        isDefault: z.boolean().optional(),
        sharingType: z.enum(SignatureSharingType).default(SignatureSharingType.PRIVATE),
        sharedIntegrationIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const signatureService = new SignatureService(ctx.db, organizationId, userId)
      return await signatureService.createSignature(input)
    }),
  // Update a signature
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1, 'Name is required'),
        body: z.string().min(1, 'Signature content is required'),
        isDefault: z.boolean().optional(),
        sharingType: z.enum(SignatureSharingType).optional(),
        sharedIntegrationIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const { id, name, body, isDefault, sharingType, sharedIntegrationIds } = input
      const signatureService = new SignatureService(ctx.db, organizationId, userId)
      return await signatureService.updateSignature(id, {
        name,
        body,
        isDefault,
        sharingType,
        sharedIntegrationIds,
      })
    }),
  // Delete a signature
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const { id } = input
      const signatureService = new SignatureService(ctx.db, organizationId, userId)
      return await signatureService.deleteSignature(id)
    }),
  // Set a signature as default
  setDefault: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const { id } = input
      const signatureService = new SignatureService(ctx.db, organizationId, userId)
      return await signatureService.setDefaultSignature(id)
    }),
  // Share a signature with integrations
  shareWithIntegrations: protectedProcedure
    .input(z.object({ id: z.string(), integrationIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const { userId, organizationId } = ctx.session
      const { id, integrationIds } = input
      const signatureService = new SignatureService(ctx.db, organizationId, userId)
      await signatureService.shareWithIntegrations(id, integrationIds)
      return { success: true }
    }),
})
