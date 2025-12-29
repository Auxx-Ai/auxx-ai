import { keepPreviousData } from '@tanstack/react-query'
// import { getQueryKey } from '@trpc/react-query'
import { api } from '~/trpc/react'

const useSubscriptionEvents = () => {
  // const queryKey = getQueryKey(api.product.getProducts, {}, 'query')

  const { isFetching, data: products } = api.webhook.getEvents.useQuery(
    {},
    {
      placeholderData: keepPreviousData,
      // getNextPageParam: (lastPage) => lastPage?.nextCursor || null, // Fetch nextCursor for pagination
    }
  )

  // const products = result.data ?? []
  // const products = { data: [] }

  return { isFetching, products }
}

export default useSubscriptionEvents
