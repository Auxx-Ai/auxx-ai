import { keepPreviousData } from '@tanstack/react-query'
// import { getQueryKey } from '@trpc/react-query'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

const useProducts = () => {
  // const queryKey = getQueryKey(api.product.getProducts, {}, 'query')

  const { isFetching, isFetchingNextPage, fetchNextPage, hasNextPage, refetch, data } =
    api.product.getProducts.useInfiniteQuery(
      {},
      {
        placeholderData: keepPreviousData,
        getNextPageParam: (lastPage) => lastPage?.nextCursor || null, // Fetch nextCursor for pagination
      }
    )

  const products = useMemo(() => data?.pages?.flatMap((page) => page.products) ?? [], [data])
  // console.log('products', products)
  // const products = result.data ?? []
  // const products = { data: [] }

  return { isFetching, products, isFetchingNextPage, fetchNextPage, hasNextPage, refetch }
}

export default useProducts
