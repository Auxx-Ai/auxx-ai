// // apps/web/src/components/workflow/ui/model-parameter/status-indicators.tsx

// import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
// import Link from 'next/link'
// import { AlertTriangle } from 'lucide-react'

// type StatusIndicatorsProps = {
//   needsConfiguration: boolean
//   modelProvider: boolean
//   inModelList: boolean
//   disabled: boolean
//   pluginInfo?: any
// }

// const StatusIndicators = ({
//   needsConfiguration,
//   modelProvider,
//   inModelList,
//   disabled,
//   pluginInfo
// }: StatusIndicatorsProps) => {
//   const renderTooltipContent = (title: string, description?: string, linkText?: string, linkHref?: string) => {
//     return (
//       <div className='flex w-[240px] max-w-[240px] flex-col gap-1 px-1 py-1.5' onClick={e => e.stopPropagation()}>
//         <div className='text-sm font-semibold text-foreground'>{title}</div>
//         {description && (
//           <div className='text-xs min-w-[200px] text-muted-foreground'>
//             {description}
//           </div>
//         )}
//         {linkText && linkHref && (
//           <div className='text-xs z-[100] cursor-pointer text-blue-600 hover:text-blue-800'>
//             <Link
//               href={linkHref}
//               onClick={(e) => {
//                 e.stopPropagation()
//               }}
//             >
//               {linkText}
//             </Link>
//           </div>
//         )}
//       </div>
//     )
//   }

//   return (
//     <>
//       {/* plugin installed and model is in model list but disabled */}
//       {/* plugin installed from github/local and model is not in model list */}
//       {!needsConfiguration && modelProvider && disabled && (
//         <>
//           {inModelList ? (
//             <Tooltip>
//               <TooltipTrigger asChild>
//                 <AlertTriangle className='h-4 w-4 text-red-600' />
//               </TooltipTrigger>
//               <TooltipContent>
//                 <p>Model is deprecated or disabled</p>
//               </TooltipContent>
//             </Tooltip>
//           ) : !pluginInfo ? (
//             <Tooltip>
//               <TooltipTrigger asChild>
//                 <AlertTriangle className='h-4 w-4 text-red-600' />
//               </TooltipTrigger>
//               <TooltipContent>
//                 {renderTooltipContent(
//                   'Model Not Supported',
//                   'This model is not supported by the current provider configuration.',
//                   'View Providers',
//                   '/settings/integrations',
//                 )}
//               </TooltipContent>
//             </Tooltip>
//           ) : (
//             <Tooltip>
//               <TooltipTrigger asChild>
//                 <AlertTriangle className='h-4 w-4 text-yellow-600' />
//               </TooltipTrigger>
//               <TooltipContent>
//                 {renderTooltipContent(
//                   'Model Configuration Required',
//                   'This model requires additional configuration to work properly.',
//                 )}
//               </TooltipContent>
//             </Tooltip>
//           )}
//         </>
//       )}
//       {!modelProvider && !pluginInfo && (
//         <Tooltip>
//           <TooltipTrigger asChild>
//             <AlertTriangle className='h-4 w-4 text-red-600' />
//           </TooltipTrigger>
//           <TooltipContent>
//             {renderTooltipContent(
//               'Provider Not Found',
//               'This model provider is not available in the marketplace.',
//               'View Providers',
//               '/settings/integrations',
//             )}
//           </TooltipContent>
//         </Tooltip>
//       )}
//     </>
//   )
// }

// export default StatusIndicators
