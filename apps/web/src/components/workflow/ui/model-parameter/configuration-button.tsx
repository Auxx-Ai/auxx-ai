// // apps/web/src/components/workflow/ui/model-parameter/configuration-button.tsx

// import { Button } from '@auxx/ui/components/button'
// import { AlertTriangle } from 'lucide-react'

// type ConfigurationButtonProps = {
//   modelProvider: any
//   handleOpenModal: () => void
// }

// const ConfigurationButton = ({ modelProvider, handleOpenModal }: ConfigurationButtonProps) => {
//   return (
//     <Button
//       size="sm"
//       variant="outline"
//       className="z-[100] h-6 px-2"
//       onClick={(e) => {
//         e.stopPropagation()
//         handleOpenModal()
//       }}
//     >
//       <div className="flex items-center justify-center gap-1 px-[3px]">
//         <span className="text-xs">Not Authorized</span>
//       </div>
//       <div className="flex h-[14px] w-[14px] items-center justify-center">
//         <AlertTriangle className="h-3 w-3 text-yellow-600" />
//       </div>
//     </Button>
//   )
// }

// export default ConfigurationButton
