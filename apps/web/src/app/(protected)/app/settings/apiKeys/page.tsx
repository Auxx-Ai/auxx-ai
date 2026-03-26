import { api } from '~/trpc/server'
import ApiKeyTable from './_components/apiKey-table'

async function APIPage() {
  // await new Promise((resolve) => setTimeout(resolve, 5000)) // TODO: remove temporary delay
  const apiKeys = await api.apiKey.getAll({})
  return <ApiKeyTable initialData={apiKeys} />
}

export default APIPage
