'use client'
import { waitUntil } from '@vercel/functions'
import axios from 'axios'
import React, { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { WEBAPP_URL } from '@auxx/config/client'
type Props = { accountId: string | undefined }
/** not used */
export default function StartSyncButton({ accountId }: Props) {
  const [isPending, setPending] = useState(false)

  function handleClick() {
    setPending(true)

    waitUntil(
      axios
        .post(`${WEBAPP_URL}/api/initial-sync`, { accountId })
        .then((res) => {
          console.log(res.data)
        })
        .catch((err) => {
          console.log(err.response.data)
        })
        .finally(() => {
          setPending(false)
        })
    )
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
      Sync Emails
    </Button>
  )
}
