import { AiModelsList } from '~/components/ai/ui/ai-model-list'
import { AdminPageGuard } from '~/components/global/admin-page-guard'
import { api } from '~/trpc/server'

type Props = {}

async function APIPage({}: Props) {
  const unifiedData = await api.aiIntegration.getUnifiedModelData({ includeDefaults: true })
  return (
    <>
      <AdminPageGuard />
      <AiModelsList initialUnifiedData={unifiedData} />
    </>
  )
}

export default APIPage
