// apps/web/src/components/kopilot/ui/blocks/register-blocks.ts

import { ActionResultBlock } from './action-result-block'
import { registerBlockRenderer } from './block-registry'
import { ContactCardBlock } from './contact-card-block'
import { DraftPreviewBlock } from './draft-preview-block'
import { KBArticleBlock } from './kb-article-block'
import { PlanStepsBlock } from './plan-steps-block'
import { ThreadListBlock } from './thread-list-block'

registerBlockRenderer('thread-list', ThreadListBlock)
registerBlockRenderer('contact-card', ContactCardBlock)
registerBlockRenderer('draft-preview', DraftPreviewBlock)
registerBlockRenderer('kb-article', KBArticleBlock)
registerBlockRenderer('plan-steps', PlanStepsBlock)
registerBlockRenderer('action-result', ActionResultBlock)
