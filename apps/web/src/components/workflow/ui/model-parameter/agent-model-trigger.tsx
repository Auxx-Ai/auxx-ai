// // apps/web/src/components/workflow/ui/model-parameter/agent-model-trigger.tsx

// import type { FC } from 'react'
// import { useMemo, useState } from 'react'
// import { AgentModelTriggerProps } from './types'
// import { api } from '~/trpc/react'
// import ConfigurationButton from './configuration-button'
// import ModelIcon from './model-icon'
// import ModelDisplay from './model-display'
// import StatusIndicators from './status-indicators'
// import { cn } from '@auxx/ui/lib/utils'
// import { SlidersHorizontal } from 'lucide-react'

// const AgentModelTrigger: FC<AgentModelTriggerProps> = ({
//   disabled,
//   currentProvider,
//   currentModel,
//   providerName,
//   modelId,
//   hasDeprecated,
//   scope,
// }) => {
//   const [installed, setInstalled] = useState(false)

//   // Get provider configuration
//   const { data: providerConfig } = api.aiIntegration.getProviderConfiguration.useQuery(
//     { provider: providerName || '' },
//     { enabled: !!providerName }
//   )

//   const { needsConfiguration } = useMemo(() => {
//     const needsConfiguration = providerConfig?.status === 'not_configured'
//     return { needsConfiguration }
//   }, [providerConfig])

//   const handleOpenModal = () => {
//     // Navigate to provider configuration page
//     window.location.href = '/settings/integrations'
//   }

//   // Mock data for model in list check
//   const inModelList = true
//   const pluginInfo = null

//   if (modelId && !providerConfig) {
//     return <div className="text-sm text-muted-foreground">Loading...</div>
//   }

//   return (
//     <div
//       className={cn(
//         'group relative flex grow cursor-pointer items-center gap-[2px] rounded-lg bg-muted p-1 hover:bg-muted/80'
//       )}>
//       {modelId ? (
//         <>
//           <ModelIcon
//             className="p-0.5"
//             provider={
//               currentProvider || { provider: providerName || '', label: providerName || '' }
//             }
//             modelName={currentModel?.model || modelId}
//             isDeprecated={hasDeprecated}
//           />
//           <ModelDisplay currentModel={currentModel} modelId={modelId} />
//           {needsConfiguration && (
//             <ConfigurationButton
//               modelProvider={{ provider: providerName }}
//               handleOpenModal={handleOpenModal}
//             />
//           )}
//           <StatusIndicators
//             needsConfiguration={needsConfiguration}
//             modelProvider={!!currentProvider}
//             inModelList={inModelList}
//             disabled={!!disabled}
//             pluginInfo={pluginInfo}
//           />
//           {currentProvider && !disabled && !needsConfiguration && (
//             <div className="flex items-center pr-1">
//               <SlidersHorizontal className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
//             </div>
//           )}
//         </>
//       ) : (
//         <>
//           <div className="flex grow items-center gap-1 p-1 pl-2">
//             <span className="text-sm overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground">
//               Configure Model
//             </span>
//           </div>
//           <div className="flex items-center pr-1">
//             <SlidersHorizontal className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
//           </div>
//         </>
//       )}
//     </div>
//   )
// }

// export default AgentModelTrigger
