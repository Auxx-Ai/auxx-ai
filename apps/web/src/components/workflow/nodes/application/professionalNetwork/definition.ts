// 🤖 AUTO-GENERATED from professionalNetwork.config.json - DO NOT EDIT

import { NodeCategory, type NodeDefinition } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { ProfessionalNetworkPanel } from './components'
import { professionalNetworkNodeSchema, validateProfessionalNetworkNode } from './schema'
import type { ProfessionalNetworkNodeData } from './types'

export const professionalNetworkDefinition: NodeDefinition<ProfessionalNetworkNodeData> = {
  id: NodeType.PROFESSIONAL_NETWORK,
  category: NodeCategory.INTEGRATION,
  displayName: 'LinkedIn',
  description: 'Post content to LinkedIn professional networks',
  icon: 'linkedin',
  color: '#0077B5',
  defaultData: {
    action: 'publishContent',
    contentType: 'textPost',
    textContent: '',
    authorType: 'person',
    postVisibility: 'PUBLIC',
    imageData: 'data',
    imageTitle: '',
    articleUrl: '',
    articleTitle: '',
    articleDescription: '',
    scheduleDate: '',
  },
  schema: professionalNetworkNodeSchema,
  panel: ProfessionalNetworkPanel,
  validator: (data: ProfessionalNetworkNodeData) => {
    const result = validateProfessionalNetworkNode(data)
    return {
      isValid: result.success,
      errors: result.success
        ? []
        : result.error.issues.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
            type: 'error' as const,
          })),
    }
  },
  canRunSingle: true,
}
