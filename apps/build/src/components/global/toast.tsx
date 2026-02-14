// import { Check, ChevronDown, X } from 'lucide-react'
// import { useCallback, useState } from 'react'
// import { Toaster as SonnerToaster, type ToasterProps } from 'sonner'

// import { toast as sonnerToast } from 'sonner'

// /** I recommend abstracting the toast function
//  *  so that you can call it without having to use toast.custom everytime. */
// function toast(toast: Omit<ToasterProps, 'id'>) {
//   return sonnerToast.custom(
//     (id) => (
//       <Toast
//         id={id}
//         title={toast.title}
//         description={toast.description}
//         button={toast.button}
//         icon={toast.icon}
//       />
//     ),
//     { ...toast, style: { '--width': '300px' } }
//   )
// }
// /** A fully custom toast that still maintains the animations and interactions. */
// function Toast(props: ToasterProps) {
//   const { title, description, button, id, icon } = props
//   const [isShow, setIsShow] = useState(false)
//   const showMore = useCallback(() => {
//     setIsShow((bool) => !bool)
//   }, [])
//   return (
//     <div className="flex rounded-2xl bg-white dark:bg-primary-400 shadow-lg shadow-black/10 ring-1 ring-black/5 w-full md:max-w-[350px] min-w-[300px] items-start ps-2 p-1.5 gap-2">
//       <div className="mt-[2px]">{icon}</div>
//       <div className="flex flex-1 items-start flex-col">
//         <div className="w-full flex items-center justify-start gap-2 mt-[2px]">
//           <p className="text-[14px]  mb-0 font-medium text-primary-600 dark:text-primary-800">
//             {title}
//           </p>
//           {description && (
//             <button
//               onClick={showMore}
//               className="size-4.5 bg-black/5 rounded-md flex items-center justify-center shrink-0">
//               <ChevronDown className="size-4 text-muted-foreground" />
//             </button>
//           )}
//         </div>
//         {isShow && <div className=" text-sm text-primary-600">{description}</div>}
//       </div>
//       <div>
//         <button
//           onClick={() => {
//             button && button.onClick()
//             sonnerToast.dismiss(id)
//           }}
//           className="shrink-0 flex items-center justify-center size-6 rounded-full hover:bg-black/5 dark:hover:bg-black/10">
//           <X className="size-4" />
//         </button>
//       </div>
//     </div>
//   )
// }

// export function toastSuccess(options: { title?: string; description?: string }) {
//   return toast({
//     title: options.title ?? 'Success',
//     icon: <Check className="size-5 text-good-500" />,
//     description: options.description,
//     position: 'top-right',
//   })
//   // return toast.success(options.title || 'Success', {
//   //   description: options.description,
//   //   position: 'top-right',
//   //   className: 'bg-white',
//   // })
// }

// export function toastError(options: {
//   title?: string
//   description?: string
//   action?: React.ReactNode
//   onDismiss?: () => void
// }) {
//   return toast({
//     title: options.title || 'Error',
//     icon: <X className="size-5 text-red-500" />,
//     description: options.description,
//     position: 'top-right',
//     duration: 10_000,
//     action: options.action,
//     onDismiss: options.onDismiss,
//   })
// }

// export function toastInfo(options: { title: string; description: string; duration?: number }) {
//   return toast(options.title, { description: options.description, duration: options.duration })
// }

// export const Toaster = SonnerToaster

import { Check, ChevronDown, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { type ExternalToast, Toaster as SonnerToaster, toast as sonnerToast } from 'sonner'

/**
 * Props for the custom Toast component
 */
interface ToastProps {
  id: string | number
  title?: string
  description?: string
  icon?: React.ReactNode
  button?: {
    label: string
    onClick: () => void
  }
}

/**
 * Custom toast options = content props + Sonner's ExternalToast options
 */
type CustomToastOptions = Omit<ToastProps, 'id'> & ExternalToast

/** Helper to create custom toast with proper type separation */
function toast(options: CustomToastOptions) {
  const { title, description, icon, button, ...toastOptions } = options

  return sonnerToast.custom(
    (id) => <Toast id={id} title={title} description={description} button={button} icon={icon} />,
    toastOptions
  )
}

/** A fully custom toast that still maintains the animations and interactions. */
function Toast(props: ToastProps) {
  const { title, description, button, id, icon } = props
  const [isShow, setIsShow] = useState(false)
  const showMore = useCallback(() => {
    setIsShow((bool) => !bool)
  }, [])
  return (
    <div className='flex rounded-2xl bg-white dark:bg-primary-400 shadow-lg shadow-black/10 ring-1 ring-black/5 w-full md:max-w-[350px] min-w-[300px] items-start ps-2 p-1.5 gap-2'>
      <div className='mt-[2px]'>{icon}</div>
      <div className='flex flex-1 items-start flex-col'>
        <div className='w-full flex items-center justify-start gap-2 mt-[2px]'>
          <p className='text-[14px]  mb-0 font-medium text-primary-600 dark:text-primary-800'>
            {title}
          </p>
          {description && (
            <button
              onClick={showMore}
              className='size-4.5 bg-black/5 rounded-md flex items-center justify-center shrink-0'>
              <ChevronDown className='size-4 text-muted-foreground' />
            </button>
          )}
        </div>
        {isShow && <div className=' text-sm text-primary-600'>{description}</div>}
      </div>
      <div>
        <button
          onClick={() => {
            button?.onClick()
            sonnerToast.dismiss(id)
          }}
          className='shrink-0 flex items-center justify-center size-6 rounded-full hover:bg-black/5 dark:hover:bg-black/10'>
          <X className='size-4' />
        </button>
      </div>
    </div>
  )
}

export function toastSuccess(options: { title?: string; description?: string }) {
  return toast({
    title: options.title ?? 'Success',
    icon: <Check className='size-5 text-good-500' />,
    description: options.description,
    position: 'top-right',
  })
  // return toast.success(options.title || 'Success', {
  //   description: options.description,
  //   position: 'top-right',
  //   className: 'bg-white',
  // })
}

export function toastError(options: {
  title?: string
  description?: string
  action?: React.ReactNode
  onDismiss?: () => void
}) {
  return toast({
    title: options.title || 'Error',
    icon: <X className='size-5 text-red-500' />,
    description: options.description,
    position: 'top-right',
    duration: 10_000,
    action: options.action,
    onDismiss: options.onDismiss,
  })
}

export function toastInfo(options: { title: string; description?: string; duration?: number }) {
  return toast({
    title: options.title,
    description: options.description,
    position: 'top-right',
    duration: options.duration,
  })
}

export const Toaster = SonnerToaster
