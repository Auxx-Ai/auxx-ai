// apps/web/src/app/(protected)/app/dispatch/page.tsx

import { redirect } from 'next/navigation'

/** Module home is the M2 dispatch board — until it lands, land on settings. */
function DispatchHome() {
  redirect('/app/dispatch/settings')
}

export default DispatchHome
