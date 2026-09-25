// apps/web/src/components/accounting/ui/banking/matches/matches-page.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { ToolbarTitle } from '~/components/global/module-toolbar'
import { useRegisterModuleToolbar } from '~/components/global/module-toolbar-outlet'
import { useAccess, useRequireCapability } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { MATCH_VIEWS, type MatchView, PROVIDER_MATCH_STATE_LABEL } from './provider-match-copy'
import { ProviderMatchList } from './provider-match-list'

/** Accounting > Banking > Matches: the connected books' own transactions against ours (brief 102 M5). */
export function MatchesPage() {
  useRequireCapability(PermissionKey.ledgerView)
  const { can } = useAccess()
  const [view, setView] = useQueryState(
    'state',
    parseAsStringLiteral(MATCH_VIEWS).withDefault('suggested')
  )
  const counts = api.providerMatch.counts.useQuery()

  useRegisterModuleToolbar(useMemo(() => ({ left: <ToolbarTitle>Matches</ToolbarTitle> }), []))

  const countOf = (state: MatchView) => (state === 'matched' ? 0 : (counts.data?.[state] ?? 0))

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <ListToolbar sticky={false} className='shrink-0'>
        <ListToolbarGroup className='shrink-0'>
          <RadioTab
            value={view}
            onValueChange={(value) => void setView(value as MatchView)}
            size='sm'>
            {MATCH_VIEWS.map((state) => (
              <RadioTabItem key={state} value={state}>
                {PROVIDER_MATCH_STATE_LABEL[state]}
                {countOf(state) > 0 && (
                  <Badge variant={state === 'suggested' ? 'amber' : 'outline'} size='xs'>
                    {countOf(state)}
                  </Badge>
                )}
              </RadioTabItem>
            ))}
          </RadioTab>
        </ListToolbarGroup>
      </ListToolbar>
      <ScrollArea className='min-h-0 flex-1'>
        <div className='flex flex-1 flex-col gap-1 p-4'>
          <ProviderMatchList state={view} canPost={can(PermissionKey.ledgerPost)} />
        </div>
      </ScrollArea>
    </div>
  )
}
