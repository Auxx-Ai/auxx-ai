// apps/web/src/app/(protected)/app/dispatch/settings/page.tsx

import { redirect } from 'next/navigation'

/** No dedicated overview yet — Products & Services is the only settings page in MQ1. */
function DispatchSettings() {
  redirect('/app/dispatch/settings/products')
}

export default DispatchSettings
