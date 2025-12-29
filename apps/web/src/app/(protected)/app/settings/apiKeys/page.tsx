import React from 'react'
import { api } from '~/trpc/server'
import ApiKeyTable from './_components/apiKey-table'

type Props = {}

async function APIPage({}: Props) {
  const apiKeys = await api.apiKey.getAll({})
  return <ApiKeyTable initialData={apiKeys} />
}

export default APIPage
