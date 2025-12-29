// 🤖 AUTO-GENERATED from professionalNetwork.config.json - DO NOT EDIT

import { z } from 'zod'
import type { ProfessionalNetworkNodeData } from './types'

export const professionalNetworkNodeSchema = z.object({
  action: z.enum(['publishContent', 'scheduleContent']),
  contentType: z.enum(['textPost', 'imagePost', 'articlePost']),
  textContent: z.string().max(3000, 'Content exceeds 3000 character limit'),
  authorType: z.enum(['person', 'organization']),
  postVisibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional(),
  imageData: z.string(),
  imageTitle: z.string().max(200, 'Image title too long').optional(),
  articleUrl: z.string().url('Please enter a valid URL'),
  articleTitle: z.string().max(200, 'Article title too long'),
  articleDescription: z.string().max(500, 'Article description too long').optional(),
  scheduleDate: z.string(),
})

export function validateProfessionalNetworkNode(data: Partial<ProfessionalNetworkNodeData>) {
  return professionalNetworkNodeSchema.safeParse(data)
}
