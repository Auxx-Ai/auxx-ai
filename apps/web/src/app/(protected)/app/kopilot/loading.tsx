// apps/web/src/app/(protected)/app/kopilot/loading.tsx

import Loader from '@auxx/ui/components/loader'

export default function KopilotLoading() {
  return (
    <div className='absolute inset-0 grid place-items-center'>
      <Loader size='sm' title='Loading chat...' subtitle='Please wait' />
    </div>
  )
}
