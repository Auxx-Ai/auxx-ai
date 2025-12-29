import { keepPreviousData } from '@tanstack/react-query'
// import { getQueryKey } from '@trpc/react-query'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

const useCustomers = () => {
  // const queryKey = getQueryKey(api.product.getProducts, {}, 'query')

  const {
    isFetching,
    data,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    // data: threads,
    refetch,
  } = api.customer.all.useInfiniteQuery(
    {},
    {
      placeholderData: keepPreviousData,
      getNextPageParam: (lastPage) => lastPage?.nextCursor || null, // Fetch nextCursor for pagination
    }
  )

  // const products = result.data ?? []
  // const products = { data: [] }
  // const customers = data?.pages.flatMap((page) => page.customers) ?? []

  const flatData = useMemo(() => data?.pages?.flatMap((page) => page.customers) ?? [], [data])

  return {
    isFetching,
    customers: flatData,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch,
  }
}

export default useCustomers
