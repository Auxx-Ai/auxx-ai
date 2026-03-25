// apps/web/src/components/ui/input-search.tsx
'use client'
import { cn } from '@auxx/ui/lib/utils'
import { Search, X } from 'lucide-react'
import type * as React from 'react'

export interface InputSearchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  className?: string
  placeholder?: string
  onClear?: () => void
  ref?: React.Ref<HTMLInputElement>
}

/**
 * InputSearch component with search icon and optional clear button
 */
function InputSearch({
  value,
  onChange,
  className,
  placeholder = 'Search...',
  onClear,
  ref,
  ...props
}: InputSearchProps) {
  const handleClear = () => {
    if (onClear) {
      onClear()
    } else {
      const event = { target: { value: '' } } as React.ChangeEvent<HTMLInputElement>
      onChange(event)
    }
  }

  return (
    <div className='group/search relative flex flex-1 gap-2'>
      <Search className='pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground' />
      <input
        ref={ref}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={cn(
          'flex w-full rounded-md py-1 shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden  focus-visible:ring-primary-200 disabled:cursor-not-allowed disabled:opacity-50',
          'h-7 flex-1 border-none pl-7 text-xs',
          'bg-muted/50 hover:bg-muted focus-visible:bg-muted',
          'focus-visible:ring-1',
          className
        )}
        {...props}
      />
      {value && (
        <button
          type='button'
          onClick={handleClear}
          className='absolute flex items-center transition-colors justify-center h-6 w-6 my-0.5 group-hover/search:bg-primary-150 right-0.5 rounded-md hover:text-bad-500 hover:bg-bad-100'>
          <X className='size-3' />
        </button>
      )}
    </div>
  )
}

InputSearch.displayName = 'InputSearch'

export { InputSearch }

// packages/ui/src/components/input-search.tsx
// 'use client'

// import * as React from 'react'
// import { Search, X } from 'lucide-react'
// import { cn } from '@auxx/ui/lib/utils'
// import {
//   InputGroup,
//   InputGroupAddon,
//   InputGroupButton,
//   InputGroupInput,
// } from '@auxx/ui/components/input-group'

// export interface InputSearchProps extends React.InputHTMLAttributes<HTMLInputElement> {
//   value: string
//   onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
//   className?: string
//   placeholder?: string
//   onClear?: () => void
// }

// /**
//  * InputSearch component with search icon and optional clear button
//  * Built using InputGroup components
//  */
// function InputSearch({
//   value,
//   onChange,
//   className,
//   placeholder = 'Search...',
//   onClear,
//   ...props
// }: InputSearchProps) {
//   const handleClear = () => {
//     if (onClear) {
//       onClear()
//     } else {
//       const event = { target: { value: '' } } as React.ChangeEvent<HTMLInputElement>
//       onChange(event)
//     }
//   }

//   return (
//     <InputGroup
//       className={cn(
//         // 'h-7 bg-muted/50 hover:bg-muted has-[[data-slot=input-group-control]:focus-visible]:bg-muted',
//         // 'has-[[data-slot=input-group-control]:focus-visible]:ring-primary-200',
//         className
//       )}>
//       <InputGroupAddon align="inline-start">
//         <Search className="size-3" />
//       </InputGroupAddon>

//       <InputGroupInput
//         placeholder={placeholder}
//         value={value}
//         onChange={onChange}
//         className="text-xs py-1"
//         {...props}
//       />

//       {value && (
//         <InputGroupAddon align="inline-end">
//           <InputGroupButton
//             size="icon-xs"
//             onClick={handleClear}
//             className="hover:text-bad-500 hover:bg-bad-100">
//             <X className="size-3" />
//           </InputGroupButton>
//         </InputGroupAddon>
//       )}
//     </InputGroup>
//   )
// }

// InputSearch.displayName = 'InputSearch'

// export { InputSearch }
