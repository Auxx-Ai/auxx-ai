import { AiModelsList } from '~/components/ai/ui/ai-model-list'
import { api } from '~/trpc/server'

type Props = {}

async function APIPage({}: Props) {
  // const aiModels = []
  // const [isOpen, setIsOpen] = React.useState(false)

  const unifiedData = await api.aiIntegration.getUnifiedModelData({ includeDefaults: true })
  return <AiModelsList initialUnifiedData={unifiedData} />
}

export default APIPage
