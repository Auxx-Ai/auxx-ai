// 🤖 AUTO-GENERATED from linkedin.config.json - DO NOT EDIT

import type { BaseNodeData, NodeType } from '~/components/workflow/types'

export interface LinkedinNodeData extends BaseNodeData {
  type: NodeType.LINKEDIN
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

export interface LinkedinPanelProps {
  nodeId: string
  data: LinkedinNodeData
}
