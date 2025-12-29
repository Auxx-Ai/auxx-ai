// 🤖 AUTO-GENERATED from professionalNetwork.config.json - DO NOT EDIT

import type { BaseNodeData, NodeType } from '~/components/workflow/types'

export interface ProfessionalNetworkNodeData extends BaseNodeData {
  type: NodeType.PROFESSIONAL_NETWORK
  action: 'publishContent' | 'scheduleContent'
  contentType: 'textPost' | 'imagePost' | 'articlePost'
  textContent: string
  authorType: 'person' | 'organization'
  postVisibility?: 'PUBLIC' | 'CONNECTIONS'
  imageData: string
  imageTitle?: string
  articleUrl: string
  articleTitle: string
  articleDescription?: string
  scheduleDate: string
}

export interface ProfessionalNetworkPanelProps {
  nodeId: string
  data: ProfessionalNetworkNodeData
}

export interface ProfessionalNetworkNodeProps {
  id: string
  data: ProfessionalNetworkNodeData
  selected: boolean
}
