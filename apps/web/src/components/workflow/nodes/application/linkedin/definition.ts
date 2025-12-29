// 🤖 AUTO-GENERATED from linkedin.config.json - DO NOT EDIT

import { NodeDefinition, NodeCategory } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { LinkedinPanel } from './components'
import { validateLinkedinNode, linkedinNodeSchema } from './schema'
import type { LinkedinNodeData } from './types'

export const linkedinDefinition: NodeDefinition<LinkedinNodeData> = {
  id: NodeType.LINKEDIN,
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
  schema: linkedinNodeSchema,
  panel: LinkedinPanel,
  validator: (data: LinkedinNodeData) => {
    const result = validateLinkedinNode(data)
    return {
      isValid: result.success,
      errors: result.success
        ? []
        : result.error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
            type: 'error' as const,
          })),
    }
  },
  canRunSingle: true,
}
