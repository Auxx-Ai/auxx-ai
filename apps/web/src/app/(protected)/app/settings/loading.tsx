import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@auxx/ui/components/breadcrumb'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { LoadingSpinner } from '~/components/global/loading-content'

export default function Loading() {
  return (
    <div className='relative h-full w-full overflow-auto flex flex-col'>
      <header className='flex h-10 shrink-0 items-center gap-2 border-b'>
        <div className='flex items-center gap-2 px-3'>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className='hidden md:block'>
                <BreadcrumbPage>
                  <Skeleton className='h-5 w-[69px]' />
                </BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbSeparator className='hidden md:block' />
              <BreadcrumbItem className='hidden md:block'>
                <BreadcrumbPage>
                  <Skeleton className='h-5 w-[100px]' />
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className='sticky top-0 z-10 bg-background'>
        <div className='flex items-start flex-col justify-start bg-muted/50 px-5 py-3 ps-2 h-[68px] space-y-1'>
          {/* <div className="flex items-center gap-2 flex-col "> */}
          <Skeleton className='h-6 w-[200px] pb-[3px]' />
          <Skeleton className='h-5 w-[90%]' />
          {/* </div> */}
        </div>
        <Separator />
      </div>
      <LoadingSpinner />
    </div>
  )
}
