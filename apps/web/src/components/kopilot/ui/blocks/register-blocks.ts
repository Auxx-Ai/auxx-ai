// apps/web/src/components/kopilot/ui/blocks/register-blocks.ts

import { registerApprovalCard } from './approval-card-registry'
import { registerBlockRenderer } from './block-registry'
import { BulkUpdateApprovalCard } from './bulk-update-approval-card'
import { DraftApprovalCard } from './draft-approval-card'
import { EntityCardBlock } from './entity-card-block'
import { EntityCreateApprovalCard } from './entity-create-approval-card'
import { EntityDefinitionBlock } from './entity-definition-block'
import { EntityListBlock } from './entity-list-block'
import { EntityUpdateApprovalCard } from './entity-update-approval-card'
import { PlanStepsBlock } from './plan-steps-block'
import { TableBlock } from './table-block'
import { TaskCreateApprovalCard } from './task-create-approval-card'
import { TaskListBlock } from './task-list-block'
import { ThreadListBlock } from './thread-list-block'

registerBlockRenderer('thread-list', ThreadListBlock)
registerBlockRenderer('entity-card', EntityCardBlock)
registerBlockRenderer('entity-list', EntityListBlock)
registerBlockRenderer('entity-definition', EntityDefinitionBlock)
registerBlockRenderer('plan-steps', PlanStepsBlock)
registerBlockRenderer('table', TableBlock)
registerBlockRenderer('task-list', TaskListBlock)

registerApprovalCard('reply_to_thread', DraftApprovalCard)
registerApprovalCard('start_new_conversation', DraftApprovalCard)
registerApprovalCard('update_entity', EntityUpdateApprovalCard)
registerApprovalCard('bulk_update_entity', BulkUpdateApprovalCard)
registerApprovalCard('create_entity', EntityCreateApprovalCard)
registerApprovalCard('create_task', TaskCreateApprovalCard)
