import { AiModelsList } from '~/components/ai/ui/ai-model-list'
import { CapabilityPageGuard } from '~/components/global/capability-page-guard'
import { api } from '~/trpc/server'

type Props = {}

async function APIPage({}: Props) {
  const unifiedData = await api.aiIntegration.getUnifiedModelData({ includeDefaults: true })
  return (
    <>
      <CapabilityPageGuard permissionKey='aiConfig.manage' />
      <AiModelsList initialUnifiedData={unifiedData} />
    </>
  )
}

export default APIPage
