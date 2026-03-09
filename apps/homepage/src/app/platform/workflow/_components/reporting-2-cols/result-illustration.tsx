import { cn } from '~/lib/utils'
import { TableIllustration } from './table-illustration'
// import { DocumentIllustation } from '~/components/document-illustration'

export const ResultIllustration = ({ className }: { className?: string }) => {
  return (
    <div aria-hidden className='relative'>
      <div
        className={cn(
          'mask-b-from-65% dark:mask-b-from-80% before:bg-background before:border-border after:border-border after:bg-background/50 before:z-1 group relative -mx-4 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-2xl before:border after:absolute after:inset-x-9 after:bottom-0 after:top-2 after:rounded-2xl after:border',
          className
        )}>
        <div className='bg-illustration ring-border-illustration relative z-10 overflow-hidden rounded-2xl border border-transparent text-sm shadow-xl shadow-black/10 ring-1'>
          <div className='mb-6'>
            <TableIllustration />
            {/* <DocumentIllustation /> */}
          </div>
        </div>
      </div>
    </div>
  )
}
