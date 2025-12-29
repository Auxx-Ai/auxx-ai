// 'use client'
import React from 'react'
import { api } from '~/trpc/server'
import { AiModelsList } from '~/components/ai/ui/ai-model-list'

type Props = {}

async function APIPage({}: Props) {
  // const aiModels = []
  // const [isOpen, setIsOpen] = React.useState(false)

  const unifiedData = await api.aiIntegration.getUnifiedModelData({ includeDefaults: true })
  return <AiModelsList initialUnifiedData={unifiedData} />
}

export default APIPage
