// apps/web/src/app/(protected)/app/meetings/layout.tsx

import type React from 'react'

/**
 * Layout props for the Meetings route tree.
 */
type Props = { children: React.ReactNode; modal: React.ReactNode }

/**
 * Meetings layout with modal slot support.
 */
function layout({ children, modal }: Props) {
  return (
    <>
      {children} {modal}
    </>
  )
}

export default layout
