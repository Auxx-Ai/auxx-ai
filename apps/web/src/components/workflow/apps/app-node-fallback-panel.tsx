// apps/web/src/components/workflow/apps/app-node-fallback-panel.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Item, ItemContent, ItemGroup, ItemHeader } from '@auxx/ui/components/item'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Blocks, Globe, Link2, Plug, Wrench, Zap } from 'lucide-react'
import { useMemo } from 'react'
import { useOptionalAppsContext } from '~/components/apps/providers/apps-context'
import { CapabilityBadge } from '~/components/apps/ui/app-about'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { AppInstallCard } from '~/components/apps/ui/app-install-card'
// Direct module, not the `hooks` barrel: that barrel reaches
// `use-workflow-blocks` → `workflow-block-registry` → `app-workflow-panel`,
// which imports this file — a cycle whose bindings resolve late.
import { useRegistryVersion } from '~/components/workflow/hooks/use-registry'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import { api } from '~/trpc/react'
import { resolveAppNodeMeta } from './app-node-meta'

interface AppNodeFallbackPanelProps {
  nodeId: string
  data: any
}

/**
 * Panel for an app node whose block has no registered definition — the app was
 * never installed in this org (a workflow template carries the node, or the app
 * was uninstalled), its blocks are still loading, or the block no longer exists
 * in the installed deployment.
 *
 * Without this the drawer could not open at all: `NodePanelBody` resolves the
 * panel from the registry, and an unregistered type used to fall through to
 * `closeDrawer()` — so clicking the node did nothing, and the "not installed"
 * branch inside `AppWorkflowPanel` was unreachable. `StandardNode` has carried
 * the mirror-image fallback for the node itself since app blocks shipped; this
 * is the panel half of it.
 */
export function AppNodeFallbackPanel({ nodeId, data }: AppNodeFallbackPanelProps) {
  const { appId, appSlug } = resolveAppNodeMeta(data)
  const appsContext = useOptionalAppsContext()
  // Re-read the registry when app blocks register: an installed app's blocks
  // arrive asynchronously, and this panel is what stands in until they do.
  const registryVersion = useRegistryVersion()

  const title = data?.title || 'App step'
  const installation = appsContext?.appInstallations.find((inst) => inst.app.id === appId)

  // Whether ANY block of this app has registered yet — the difference between
  // "still loading" and "this block is gone from the installed deployment".
  // biome-ignore lint/correctness/useExhaustiveDependencies: registryVersion is the registry's change signal
  const appHasRegisteredBlocks = useMemo(
    () => unifiedNodeRegistry.getAllEntries().some(([type]) => type.startsWith(`${appId}:`)),
    [appId, registryVersion]
  )

  // Installations still in flight — say nothing yet rather than accusing an
  // installed app of being missing.
  if (!appsContext || appsContext.isLoading) {
    return (
      <BasePanel title={title} nodeId={nodeId} data={data}>
        <PanelSkeleton />
      </BasePanel>
    )
  }

  if (installation) {
    // The app is installed but this block has no definition. If NONE of its
    // blocks have registered yet, registration is simply still running (the
    // loader boots each app's bundle in turn). If others did register, this
    // block is genuinely absent from the installed deployment — renamed or
    // removed by a newer version, leaving the node stranded.
    return (
      <BasePanel title={title} nodeId={nodeId} data={data}>
        {appHasRegisteredBlocks ? (
          <div className='space-y-3 p-4'>
            <div className='flex items-center gap-2'>
              <AppIcon iconId={installation.app.avatarUrl ?? 'package'} size='default' />
              <div className='min-w-0'>
                <div className='truncate text-sm font-medium'>{installation.app.title}</div>
                <div className='text-xs text-muted-foreground'>Step no longer available</div>
              </div>
            </div>
            <p className='text-sm text-muted-foreground'>
              <strong>{title}</strong> isn’t part of the installed version of{' '}
              {installation.app.title} anymore — it was renamed or removed. Replace this step, or
              install a version of the app that still provides it.
            </p>
            <Button variant='outline' size='sm' asChild>
              <a
                href={`/app/settings/apps/installed/${installation.app.slug}`}
                target='_blank'
                rel='noopener noreferrer'>
                Open app settings
              </a>
            </Button>
          </div>
        ) : (
          <PanelSkeleton />
        )}
      </BasePanel>
    )
  }

  return (
    <BasePanel title={title} nodeId={nodeId} data={data}>
      <NotInstalledBody title={title} appSlug={appSlug} />
    </BasePanel>
  )
}

/** Placeholder while installations or app blocks are still loading. */
function PanelSkeleton() {
  return (
    <div className='space-y-3 p-4'>
      <Skeleton className='h-12 w-full rounded-2xl' />
      <Skeleton className='h-4 w-2/3' />
      <Skeleton className='h-4 w-1/2' />
    </div>
  )
}

/**
 * The app isn't installed. Everything shown here comes from `apps.getBySlug`,
 * which answers for uninstalled apps too — so the whole decision (what the app
 * is, who built it, what it brings, what it will ask for) can be made here
 * instead of on the settings page.
 */
function NotInstalledBody({ title, appSlug }: { title: string; appSlug?: string }) {
  // Without a slug there is nothing to install BY — `apps.install` and
  // `apps.getBySlug` both key on it. Older nodes predate `appSlug` in
  // `defaultData`.
  if (!appSlug) {
    return (
      <div className='space-y-3 p-4'>
        <p className='text-sm text-muted-foreground'>
          <strong>{title}</strong> comes from an app that isn’t installed in this workspace, and the
          step doesn’t record which one. Replace it with a step from an installed app.
        </p>
        <Button variant='outline' size='sm' asChild>
          <a href='/app/settings/apps' target='_blank' rel='noopener noreferrer'>
            Browse apps
          </a>
        </Button>
      </div>
    )
  }

  return <AppDetails title={title} appSlug={appSlug} />
}

function AppDetails({ title, appSlug }: { title: string; appSlug: string }) {
  const { data, isLoading } = api.apps.getBySlug.useQuery({ appSlug }, { retry: false })

  const capabilityGroups = data
    ? [
        { group: data.capabilities.tools, icon: Wrench, singular: 'Tool', plural: 'Tools' },
        {
          group: data.capabilities.quickActions,
          icon: Zap,
          singular: 'Quick action',
          plural: 'Quick actions',
        },
        {
          group: data.capabilities.workflowBlocks,
          icon: Blocks,
          singular: 'Workflow block',
          plural: 'Workflow blocks',
        },
        {
          group: data.capabilities.dataConnectors,
          icon: Plug,
          singular: 'Data connector',
          plural: 'Data connectors',
        },
      ].filter((g) => g.group.count > 0)
    : []

  const links = data
    ? [
        { url: data.app.websiteUrl, label: 'Website' },
        { url: data.app.documentationUrl, label: 'Documentation' },
        { url: data.app.supportSiteUrl, label: 'Support' },
      ].filter((l): l is { url: string; label: string } => !!l.url)
    : []

  const latestDeployment = data?.availableDeployments[0]

  return (
    <div className='space-y-4 p-4'>
      <p className='text-sm text-muted-foreground'>
        This step runs <strong className='text-foreground'>{title}</strong>
        {data ? ` from ${data.app.title}` : ''}. Install the app to configure and run it.
      </p>

      <AppInstallCard appSlug={appSlug} />

      {isLoading && <PanelSkeleton />}

      {data && (
        <>
          {data.app.description && <p className='text-sm'>{data.app.description}</p>}

          {data.app.screenshots?.[0] && (
            <div className='h-40 w-full overflow-hidden rounded-2xl border bg-muted'>
              <img
                src={data.app.screenshots[0]}
                alt={`${data.app.title} screenshot`}
                className='size-full object-cover'
              />
            </div>
          )}

          <ItemGroup className='gap-4'>
            {(capabilityGroups.length > 0 || data.capabilities.connection) && (
              <Item className='p-0 gap-1'>
                <ItemHeader className='text-xs text-primary-400'>Includes</ItemHeader>
                <ItemContent className='flex flex-row flex-wrap items-start gap-1'>
                  {capabilityGroups.map((g) => (
                    <CapabilityBadge
                      key={g.plural}
                      group={g.group}
                      icon={g.icon}
                      singular={g.singular}
                      plural={g.plural}
                    />
                  ))}
                  {data.capabilities.connection && (
                    <Badge variant='secondary' className='gap-1'>
                      <Link2 className='size-3' />
                      {data.capabilities.connection.label}
                    </Badge>
                  )}
                </ItemContent>
              </Item>
            )}

            <Item className='p-0 gap-1'>
              <ItemHeader className='text-xs text-primary-400'>Built by</ItemHeader>
              <ItemContent className='flex flex-row items-center text-sm'>
                {data.developerAccount.title}
                {data.app.verified && (
                  <Badge variant='secondary' className='text-xs'>
                    Verified
                  </Badge>
                )}
              </ItemContent>
            </Item>

            {latestDeployment && (
              <Item className='p-0 gap-1'>
                <ItemHeader className='text-xs text-primary-400'>Latest version</ItemHeader>
                <ItemContent className='flex-row items-center text-sm'>
                  {latestDeployment.version || 'Development'}
                  {latestDeployment.deploymentType === 'development' && (
                    <Badge variant='secondary' className='text-xs'>
                      Dev
                    </Badge>
                  )}
                </ItemContent>
              </Item>
            )}

            {data.app.scopes.length > 0 && (
              <Item className='p-0 gap-1'>
                <ItemHeader className='text-xs text-primary-400'>Access it asks for</ItemHeader>
                <ItemContent className='flex flex-row flex-wrap items-start gap-1'>
                  {data.app.scopes.map((scope) => (
                    <Badge key={scope} variant='outline' className='font-mono text-[10px]'>
                      {scope}
                    </Badge>
                  ))}
                </ItemContent>
              </Item>
            )}

            {links.length > 0 && (
              <Item className='p-0 gap-1'>
                <ItemHeader className='text-xs text-primary-400'>Resources</ItemHeader>
                <ItemContent className='flex flex-col items-start gap-0'>
                  {links.map((link) => (
                    <Button key={link.label} variant='link' size='sm' className='pl-0' asChild>
                      <a href={link.url} target='_blank' rel='noopener noreferrer'>
                        <Globe /> {link.label}
                      </a>
                    </Button>
                  ))}
                </ItemContent>
              </Item>
            )}
          </ItemGroup>
        </>
      )}
    </div>
  )
}
