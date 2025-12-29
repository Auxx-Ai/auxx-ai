// packages/workflow-nodes/src/nodes/linkedin/v1/node-types.ts

import type { INodeProperty } from '../../../types'

/**
 * Configuration schema for Professional Network Poster node
 */
export const contentConfigurationSchema: INodeProperty[] = [
  // Main action selector
  {
    displayName: 'Action',
    name: 'action',
    type: 'options',
    default: 'publishContent',
    options: [
      {
        name: 'Publish Content',
        value: 'publishContent',
        description: 'Publish content immediately',
      },
      {
        name: 'Schedule Content',
        value: 'scheduleContent',
        description: 'Schedule content for later publishing',
      },
    ],
  },

  // Content type selector
  {
    displayName: 'Content Type',
    name: 'contentType',
    type: 'options',
    default: 'textPost',
    options: [
      {
        name: 'Text Post',
        value: 'textPost',
        description: 'Simple text-based post',
      },
      {
        name: 'Image Post',
        value: 'imagePost',
        description: 'Post with image attachment',
      },
      {
        name: 'Article Post',
        value: 'articlePost',
        description: 'Post with article/link preview',
      },
    ],
  },

  // Text content field (required for all post types)
  {
    displayName: 'Text Content',
    name: 'textContent',
    type: 'string',
    default: '',
  },
]

/**
 * TypeScript interfaces for LinkedIn node data
 */
export interface ProfessionalNetworkNodeData {
  action: 'publishContent' | 'scheduleContent'
  contentType: 'textPost' | 'imagePost' | 'articlePost'
  textContent: string
  authorType: 'person' | 'organization'
  organizationId?: string
  postVisibility?: 'PUBLIC' | 'CONNECTIONS'
  imageData?: string
  imageTitle?: string
  articleUrl?: string
  articleTitle?: string
  articleDescription?: string
  scheduleDate?: string
}

export interface PublishResult {
  id: string
  success: boolean
  created: boolean
  timestamp: string
  url?: string
}

export interface PublishError {
  error: string
  timestamp: string
  itemIndex: number
  details?: any
}
