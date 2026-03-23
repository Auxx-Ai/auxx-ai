// apps/web/src/components/kbar/use-feature-gated-actions.ts
import { type Action, useRegisterActions } from 'kbar'
import { useRouter } from 'next/navigation'
import React from 'react'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/**
 * Registers kbar actions that are gated behind feature flags.
 * Only shows navigation items when the org has access to the feature.
 */
const useFeatureGatedActions = () => {
  const router = useRouter()
  const { hasAccess } = useFeatureFlags()

  const goTo = (page: string) => {
    router.push(`/app/${page}`)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: actions are static, only feature access changes
  const actions = React.useMemo(() => {
    const result: Action[] = []

    if (hasAccess('workflows')) {
      result.push({
        id: 'goToWorkflows',
        name: 'Workflows',
        subtitle: 'View your workflows',
        icon: 'git-branch',
        shortcut: ['g', 'w'],
        keywords: 'workflows',
        section: 'Navigation',
        perform: () => goTo('/workflows'),
      })
    }

    if (hasAccess('knowledgeBase')) {
      result.push({
        id: 'goToKnowledgeBase',
        name: 'Knowledge Bases',
        subtitle: 'View your knowledge bases',
        icon: 'book-open',
        shortcut: ['g', 'k'],
        keywords: 'knowledge, base',
        section: 'Navigation',
        perform: () => goTo('/kb'),
      })
    }

    if (hasAccess('datasets')) {
      result.push({
        id: 'goToDatasets',
        name: 'Datasets',
        subtitle: 'View your datasets',
        icon: 'database',
        shortcut: ['g', 'd'],
        keywords: 'datasets, data',
        section: 'Navigation',
        perform: () => goTo('/datasets'),
      })
    }

    if (hasAccess('files')) {
      result.push({
        id: 'goToFiles',
        name: 'Files',
        subtitle: 'View your files',
        icon: 'folder',
        shortcut: ['g', 'f'],
        keywords: 'files, documents, storage',
        section: 'Navigation',
        perform: () => goTo('/files'),
      })
    }

    if (hasAccess('shopify')) {
      result.push(
        {
          id: 'goToShopify',
          name: 'Shopify',
          subtitle: 'View your Shopify customers',
          icon: 'shopping-cart',
          shortcut: ['g', 's'],
          keywords: 'shopify, customers',
          section: 'Navigation',
          perform: () => goTo('/shopify/customers'),
        },
        {
          id: 'goToShopifyCustomers',
          name: 'Customers',
          subtitle: 'View your Shopify customers',
          icon: 'users',
          shortcut: ['g', 's', 'c'],
          keywords: 'shopify, customers',
          section: 'Shopify',
          parent: 'goToShopify',
          perform: () => goTo('/shopify/customers'),
        },
        {
          id: 'goToShopifyOrders',
          name: 'Orders',
          subtitle: 'View your Shopify orders',
          icon: 'receipt',
          shortcut: ['g', 's', 'o'],
          keywords: 'shopify, orders',
          section: 'Shopify',
          parent: 'goToShopify',
          perform: () => goTo('/shopify/orders'),
        },
        {
          id: 'goToShopifyProducts',
          name: 'Products',
          subtitle: 'View your Shopify products',
          icon: 'package',
          shortcut: ['g', 's', 'p'],
          keywords: 'shopify, products',
          section: 'Shopify',
          parent: 'goToShopify',
          perform: () => goTo('/shopify/products'),
        }
      )
    }

    return result
  }, [hasAccess])

  useRegisterActions(actions, [actions])
}

export default useFeatureGatedActions
