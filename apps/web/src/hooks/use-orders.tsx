import { keepPreviousData } from '@tanstack/react-query'
// import { getQueryKey } from '@trpc/react-query'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

const useOrders = () => {
  // const queryKey = getQueryKey(api.product.getProducts, {}, 'query')

  const { isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch, data } =
    api.order.getAll.useInfiniteQuery(
      {},
      {
        placeholderData: keepPreviousData,
        getNextPageParam: (lastPage) => lastPage?.nextCursor || null, // Fetch nextCursor for pagination
      }
    )

  const orders = useMemo(() => data?.pages?.flatMap((page) => page.orders) ?? [], [data])
  // console.log('products', products)
  // const products = result.data ?? []
  // const products = { data: [] }

  return { isFetching, orders, isFetchingNextPage, fetchNextPage, hasNextPage, refetch }
}

export default useOrders
