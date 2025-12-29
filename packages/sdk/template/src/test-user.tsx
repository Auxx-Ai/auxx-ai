import { TextBlock, useAsyncCache } from '@auxx/sdk/client'

import getUser from './get-user.server'

export function TestUser({ recordId }: { recordId: string }) {
  // By passing in the recordId, the result will be cached for each recordId
  const {
    values: { user },
    //       ^^^^^– this key matches
    //             vvvvv– this key
  } = useAsyncCache({ user: [getUser, recordId] })
  //                         ^^^^^^^^^^^^^  ^^^^^^^^
  //                         async fn       parameter(s)

  return (
    <>
      <TextBlock align="center">{user.id}</TextBlock>
      <TextBlock align="right">– {user.name}</TextBlock>
    </>
  )
}
