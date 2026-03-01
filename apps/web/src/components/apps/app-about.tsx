// apps/web/src/components/apps/app-about.tsx

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Item, ItemContent, ItemGroup, ItemHeader } from '@auxx/ui/components/item'
import { format } from 'date-fns'
import { Code, Globe, LucideGitGraph, Mail } from 'lucide-react'
import type { RouterOutputs } from '~/trpc/react'

/**
 * Props for AppAbout component
 */
// type Props = {
//   app: AppWithStatusOutput
// }

type Props = {
  app: RouterOutputs['apps']['getBySlug']
}

/**
 * AppAbout component displays detailed information about an app
 */
function AppAbout({ app }: Props) {
  // Get the actual latest deployment (already sorted by backend, first = latest)
  const latestDeployment = app.availableDeployments[0]

  // Get installed deployment if app is installed
  const installedDeployment = app.installation.isInstalled
    ? app.availableDeployments.find((d) => d.id === app.installation.currentDeploymentId)
    : null

  return (
    <div className='flex-1 flex-col space-y-6 px-6 py-6'>
      <div className='flex w-full  flex-row'>
        <div className='w-full grid grid-cols-3 gap-3'>
          <div className='h-[200px] w-full bg-muted border rounded-2xl'></div>
          <div className='h-[200px] w-full bg-muted border rounded-2xl'></div>
          <div className='h-[200px] w-full bg-muted border rounded-2xl'></div>
        </div>
      </div>
      <div className='grid grid-cols-3 gap-3'>
        <ItemGroup className='gap-4'>
          {app.app.category && (
            <Item className='p-0 gap-1'>
              <ItemHeader className='text-xs text-primary-400'>Category</ItemHeader>
              <ItemContent className='flex items-center flex-row'>
                <LucideGitGraph className='size-3' />
                {app.app.category}
              </ItemContent>
            </Item>
          )}
          <Item className='p-0 gap-1'>
            <ItemHeader className='text-xs text-primary-400'>Built by</ItemHeader>
            <ItemContent className='flex items-center flex-row'>
              <Mail className='size-3' />
              {app.developerAccount.title}
            </ItemContent>
          </Item>
          {(app.app.websiteUrl || app.app.documentationUrl || app.app.supportSiteUrl) && (
            <Item className='p-0 gap-1'>
              <ItemHeader className='text-xs text-primary-400'>Resources</ItemHeader>
              <ItemContent className='flex flex-col gap-0 items-start'>
                {app.app.websiteUrl && (
                  <Button variant='link' size='sm' className='pl-0' asChild>
                    <a href={app.app.websiteUrl} target='_blank' rel='noopener noreferrer'>
                      <Globe /> Website
                    </a>
                  </Button>
                )}
                {app.app.documentationUrl && (
                  <Button variant='link' size='sm' className='pl-0' asChild>
                    <a href={app.app.documentationUrl} target='_blank' rel='noopener noreferrer'>
                      <Globe /> Documentation
                    </a>
                  </Button>
                )}
                {app.app.supportSiteUrl && (
                  <Button variant='link' size='sm' className='pl-0' asChild>
                    <a href={app.app.supportSiteUrl} target='_blank' rel='noopener noreferrer'>
                      <Globe /> Contact
                    </a>
                  </Button>
                )}
              </ItemContent>
            </Item>
          )}
          {/* {latestVersion && (
            <Item className="p-0 gap-1">
              <ItemHeader className="text-xs text-primary-400">Current version</ItemHeader>
              <ItemContent className="">
                {latestVersion.versionString}
                {latestVersion.releasedAt &&
                  ` (${format(latestVersion.releasedAt, 'MMM d, yyyy')})`}
              </ItemContent>
            </Item>
          )} */}
          {latestDeployment && (
            <Item className='p-0 gap-1'>
              <ItemHeader className='text-xs text-primary-400'>Latest version</ItemHeader>
              <ItemContent className='flex-row items-center'>
                {latestDeployment.version || 'Development'}
                {latestDeployment.deploymentType === 'development' && (
                  <Badge variant='secondary' className='text-xs'>
                    Dev
                  </Badge>
                )}
              </ItemContent>
            </Item>
          )}
          {installedDeployment && (
            <Item className='p-0 gap-1'>
              <ItemHeader className='text-xs text-primary-400'>Installed version</ItemHeader>
              <ItemContent className='flex flex-row items-center '>
                {installedDeployment.version || 'Development'}
                {installedDeployment.deploymentType === 'development' && (
                  <Badge variant='secondary' className='text-xs'>
                    <Code className='size-3' />
                    Dev
                  </Badge>
                )}
              </ItemContent>
            </Item>
          )}
        </ItemGroup>
        <div className='flex flex-col w-full col-span-2'>
          <div className='flex flex-col space-y-6'>
            {app.app.contentOverview && (
              <section className='space-y-2'>
                <h1 className='text-xl'>Overview</h1>
                <div className='text-sm prose prose-sm max-w-none'>{app.app.contentOverview}</div>
              </section>
            )}
            {app.app.contentHowItWorks && (
              <section className='space-y-2'>
                <h1 className='text-xl'>How it works</h1>
                <div className='text-sm prose prose-sm max-w-none'>{app.app.contentHowItWorks}</div>
              </section>
            )}
          </div>
        </div>
        {/* <div className="flex flex-col gap-1 items-start max-w-[200px]">
        <div className=""></div>
      </div> */}
      </div>
    </div>
  )
}

export default AppAbout
