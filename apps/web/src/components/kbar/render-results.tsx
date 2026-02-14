import { KBarResults, useMatches } from 'kbar'
import ResultItem from './result-item'

export default function RenderResults() {
  const { results, rootActionId } = useMatches()

  return (
    <KBarResults
      items={results}
      onRender={({ item, active }) =>
        typeof item === 'string' ? (
          <div
            key={item}
            className='px-4 py-2 text-sm uppercase text-gray-600 opacity-50 dark:text-gray-400'>
            {item}
          </div>
        ) : (
          <ResultItem
            key={item.id}
            action={item}
            active={active}
            currentRootActionId={rootActionId ?? ''}
          />
        )
      }
    />
  )
}
