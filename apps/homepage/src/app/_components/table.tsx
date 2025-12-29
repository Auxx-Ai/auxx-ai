import { cn } from '~/lib/utils'
import { avatars } from '~/app/_components/avatars'

export const Table = ({ className }: { className?: string }) => {
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
      name: 'Reinaldo Alverado',
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
      <div className="mb-4">
        <div className="font-medium">Customers</div>
        <p className="text-muted-foreground mt-0.5 line-clamp-1 text-sm">
          New users by First user primary channel group (Default Channel Group)
        </p>
      </div>
      <table className="w-max table-auto border-collapse lg:w-full" data-rounded="medium">
        <thead className="dark:bg-background bg-gray-950/5">
          <tr className="*:border *:p-3 *:text-left *:text-sm *:font-medium">
            <th className="rounded-l-[--card-radius]">#</th>
            <th>Date</th>
            <th>Status</th>
            <th>Customer</th>
            <th className="rounded-r-[--card-radius]">Revenue</th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {customers.map((customer, index) => (
            <tr key={customer.id} className="*:border *:p-2">
              <td>{customer.id}</td>
              <td>{customer.date}</td>
              <td>
                <span
                  className={cn(
                    'rounded-full px-2 py-1 text-xs',
                    customer.statusVariant == 'success' && 'bg-lime-500/15 text-lime-800',
                    customer.statusVariant == 'danger' && 'bg-red-500/15 text-red-800',
                    customer.statusVariant == 'warning' && 'bg-yellow-500/15 text-yellow-800'
                  )}>
                  {customer.status}
                </span>
              </td>
              <td>
                <div className="text-title flex items-center gap-2">
                  <div className="size-6 overflow-hidden rounded-full">
                    <img
                      src={customer.avatar}
                      alt={customer.name}
                      width="120"
                      height="120"
                      loading="lazy"
                    />
                  </div>
                  <span className="text-foreground">{customer.name}</span>
                </div>
              </td>
              <td>{customer.revenue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
