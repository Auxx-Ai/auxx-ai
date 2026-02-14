import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@auxx/ui/components/breadcrumb'
import React from 'react'

interface IBradcrumbItem {
  title: string
  href?: string
}

type Props = {
  // children?: React.ReactNode
  breadcrumbs: IBradcrumbItem[]
  button?: React.ReactNode
  // backLink?: string
}

export default function BreadcrumbHeader({
  // children,
  breadcrumbs,
  button,
  // backLink,
}: Props) {
  breadcrumbs = breadcrumbs || []

  return (
    <>
      <header className='flex h-16 shrink-0 items-center gap-2 border-b'>
        <div className='flex w-full items-center justify-between gap-2 px-3'>
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs?.map((breadcrumb, i) => (
                <React.Fragment key={i}>
                  <BreadcrumbItem className='hidden md:block'>
                    {breadcrumb.href ? (
                      <BreadcrumbLink href={breadcrumb.href}>{breadcrumb.title}</BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{breadcrumb.title}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {i + 1 < breadcrumbs.length && (
                    <BreadcrumbSeparator className='hidden md:block' key={i + 0.5} />
                  )}
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          {button}
        </div>
      </header>
    </>
  )
}
