// apps/web/src/app/(website)/_components/table2.tsx

import { avatars } from '~/app/_components/avatars'
import { cn } from '~/lib/utils'

export const Table2 = ({ className }: { className?: string }) => {
  const customers = [
    {
      id: 1,
      date: '10/31/2023',
      status: 'Paid',
      statusVariant: 'success',
      name: 'Kyle Vasa Bertolucci',
      avatar: avatars.kyle,
      revenue: '$43.99',
    },
    {
      id: 2,
      date: '10/21/2023',
      status: 'Ref',
      statusVariant: 'warning',
      name: 'Calvin Ochoa',
      avatar: avatars.calvin,
      revenue: '$19.99',
    },
    {
      id: 3,
      date: '10/15/2023',
      status: 'Paid',
      statusVariant: 'success',
      name: 'Karo Topchyan',
      avatar: avatars.karo,
      revenue: '$99.99',
    },
    {
      id: 4,
      date: '10/12/2023',
      status: 'Cancelled',
      statusVariant: 'danger',
      name: 'Rey Cienega',
      avatar: avatars.rey,
      revenue: '$19.99',
    },
  ]

  return (
    <div
      aria-hidden
      className={cn(
        'bg-linear-to-b to-background ring-border-illustration relative mx-auto max-w-4xl rounded-2xl border border-transparent from-zinc-50 p-6 shadow-md shadow-black/10 ring-1',
        className
      )}>
      <div className='mb-4'>
        <div className='font-medium'>Customers</div>
        <p className='text-muted-foreground mt-0.5 line-clamp-1 text-sm'>
          New users by First user primary channel group (Default Channel Group)
        </p>
      </div>

      {/* Table Container */}
      <div className='flex flex-col relative'>
        <div className='max-w-full pl-0'>
          <div className='min-w-full'>
            {/* Table Header using dynamic table styling */}
            <div className='sticky top-0 z-10 min-w-full from-white to-white/50 bg-gradient-to-b dark:from-primary-100 dark:to-primary-100/50 backdrop-blur border-b border-primary-200/50'>
              <div className='flex min-w-full items-stretch'>
                {/* Header Cells */}
                <div
                  className='group min-w-min py-2 h-full font-inter font-medium'
                  style={{ width: '80px' }}>
                  <div className='pr-3 h-full relative py-1' style={{ width: '80px' }}>
                    <div className='font-medium text-xs pl-3 flex text-zinc-600 select-none z-10'>
                      <div className='header-title w-full truncate flex items-center'>
                        <span className='font-medium text-xs'>#</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className='group min-w-min py-2 h-full font-inter font-medium'
                  style={{ width: '120px' }}>
                  <div
                    className='border-l border-foreground-200/80 pr-3 h-full relative py-1'
                    style={{ width: '120px' }}>
                    <div className='font-medium text-xs pl-3 flex text-zinc-600 select-none z-10'>
                      <div className='header-title w-full truncate flex items-center'>
                        <span className='font-medium text-xs'>Date</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className='group min-w-min py-2 h-full font-inter font-medium'
                  style={{ width: '100px' }}>
                  <div
                    className='border-l border-foreground-200/80 pr-3 h-full relative py-1'
                    style={{ width: '100px' }}>
                    <div className='font-medium text-xs pl-3 flex text-zinc-600 select-none z-10'>
                      <div className='header-title w-full truncate flex items-center'>
                        <span className='font-medium text-xs'>Status</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className='group min-w-min py-2 h-full font-inter font-medium'
                  style={{ width: '200px' }}>
                  <div
                    className='border-l border-foreground-200/80 pr-3 h-full relative py-1'
                    style={{ width: '200px' }}>
                    <div className='font-medium text-xs pl-3 flex text-zinc-600 select-none z-10'>
                      <div className='header-title w-full truncate flex items-center'>
                        <span className='font-medium text-xs'>Customer</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className='group min-w-min py-2 h-full font-inter font-medium'
                  style={{ width: '120px' }}>
                  <div
                    className='border-l border-foreground-200/80 pr-3 h-full relative py-1'
                    style={{ width: '120px' }}>
                    <div className='font-medium text-xs pl-3 flex text-zinc-600 select-none z-10'>
                      <div className='header-title w-full truncate flex items-center'>
                        <span className='font-medium text-xs'>Revenue</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Table Body using dynamic table styling */}
            <div className='relative block' style={{ height: `${customers.length * 48}px` }}>
              {customers.map((customer, index) => (
                <div
                  key={customer.id}
                  className='absolute w-full'
                  style={{
                    top: `${index * 48}px`,
                    height: '48px',
                    width: '100%',
                    left: 0,
                    right: 0,
                  }}>
                  <div
                    className='flex group/tablerow w-full will-change-transform border-y border-background rounded-md bg-primary-50 dark:bg-background hover:bg-primary-150/80 dark:hover:bg-primary-50/80'
                    style={{
                      width: '100%',
                      contain: 'paint',
                      minHeight: '48px',
                      height: '48px',
                    }}>
                    {/* ID Cell */}
                    <div className='flex' style={{ width: '80px' }}>
                      <div className='flex shrink-0 truncate' style={{ width: '80px' }}>
                        <div
                          className='relative flex-none z-10 h-full min-h-full shrink-0 grow-0'
                          style={{ width: '80px' }}>
                          <div className='min-h-full overflow-hidden py-1.5 align-middle font-inter text-sm relative group/cell z-10 truncate w-full bg-primary-50 dark:bg-background group-hover/tablerow:bg-primary-100/80 group-hover/tablerow:dark:bg-primary-100/80'>
                            <div className='w-full pl-3 truncate'>
                              <div className='pt-0.5 leading-6'>{customer.id}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Date Cell */}
                    <div className='flex' style={{ width: '120px' }}>
                      <div className='flex shrink-0 truncate' style={{ width: '120px' }}>
                        <div
                          className='relative flex-none z-10 h-full min-h-full shrink-0 grow-0'
                          style={{ width: '120px' }}>
                          <div className='min-h-full overflow-hidden py-1.5 align-middle font-inter text-sm relative group/cell z-10 truncate w-full bg-primary-50 dark:bg-background group-hover/tablerow:bg-primary-100/80 group-hover/tablerow:dark:bg-primary-100/80'>
                            <div className='w-full pl-3 truncate'>
                              <div className='pt-0.5 leading-6'>{customer.date}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Status Cell */}
                    <div className='flex' style={{ width: '100px' }}>
                      <div className='flex shrink-0 truncate' style={{ width: '100px' }}>
                        <div
                          className='relative flex-none z-10 h-full min-h-full shrink-0 grow-0'
                          style={{ width: '100px' }}>
                          <div className='min-h-full overflow-hidden py-1.5 align-middle font-inter text-sm relative group/cell z-10 truncate w-full bg-primary-50 dark:bg-background group-hover/tablerow:bg-primary-100/80 group-hover/tablerow:dark:bg-primary-100/80'>
                            <div className='w-full pl-3 truncate'>
                              <div className='pt-0.5 leading-6'>
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-1 text-xs',
                                    customer.statusVariant === 'success' &&
                                      'bg-lime-500/15 text-lime-800',
                                    customer.statusVariant === 'danger' &&
                                      'bg-red-500/15 text-red-800',
                                    customer.statusVariant === 'warning' &&
                                      'bg-yellow-500/15 text-yellow-800'
                                  )}>
                                  {customer.status}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Customer Cell */}
                    <div className='flex' style={{ width: '200px' }}>
                      <div className='flex shrink-0 truncate' style={{ width: '200px' }}>
                        <div
                          className='relative flex-none z-10 h-full min-h-full shrink-0 grow-0'
                          style={{ width: '200px' }}>
                          <div className='min-h-full overflow-hidden py-1.5 align-middle font-inter text-sm relative group/cell z-10 truncate w-full bg-primary-50 dark:bg-background group-hover/tablerow:bg-primary-100/80 group-hover/tablerow:dark:bg-primary-100/80'>
                            <div className='w-full pl-3 truncate'>
                              <div className='pt-0.5 leading-6'>
                                <div className='text-title flex items-center gap-2'>
                                  <div className='size-6 overflow-hidden rounded-full'>
                                    <img
                                      src={customer.avatar}
                                      alt={customer.name}
                                      width='120'
                                      height='120'
                                      loading='lazy'
                                    />
                                  </div>
                                  <span className='text-foreground'>{customer.name}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Revenue Cell */}
                    <div className='flex' style={{ width: '120px' }}>
                      <div className='flex shrink-0 truncate' style={{ width: '120px' }}>
                        <div
                          className='relative flex-none z-10 h-full min-h-full shrink-0 grow-0'
                          style={{ width: '120px' }}>
                          <div className='min-h-full overflow-hidden py-1.5 align-middle font-inter text-sm relative group/cell z-10 truncate w-full bg-primary-50 dark:bg-background group-hover/tablerow:bg-primary-100/80 group-hover/tablerow:dark:bg-primary-100/80'>
                            <div className='w-full pl-3 truncate'>
                              <div className='pt-0.5 leading-6'>{customer.revenue}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
