import { memo } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { HelpLineHorizontalPosition, HelpLineVerticalPosition } from './types'
import { useWorkflowStore } from '../../store/workflow-store'

const HelpLineHorizontal = memo(({ top, left, width }: HelpLineHorizontalPosition) => {
  const reactFlow = useReactFlow()
  const viewport = reactFlow.getViewport()

  return (
    <div
      className="absolute z-[999] h-[1px] bg-blue-500 pointer-events-none"
      style={{
        top: top * viewport.zoom + viewport.y,
        left: left * viewport.zoom + viewport.x,
        width: width * viewport.zoom,
        boxShadow: '0 0 4px rgba(59, 130, 246, 0.5)',
      }}
    />
  )
})
HelpLineHorizontal.displayName = 'HelpLineHorizontal'

const HelpLineVertical = memo(({ top, left, height }: HelpLineVerticalPosition) => {
  const reactFlow = useReactFlow()
  const viewport = reactFlow.getViewport()

  return (
    <div
      className="absolute z-[999] w-[1px] bg-blue-500 pointer-events-none"
      style={{
        top: top * viewport.zoom + viewport.y,
        left: left * viewport.zoom + viewport.x,
        height: height * viewport.zoom,
        boxShadow: '0 0 4px rgba(59, 130, 246, 0.5)',
      }}
    />
  )
})
HelpLineVertical.displayName = 'HelpLineVertical'

const HelpLine = () => {
  const helpLineHorizontal = useWorkflowStore((state) => state.helpLineHorizontal)
  const helpLineVertical = useWorkflowStore((state) => state.helpLineVertical)
  // const setHelpLineHorizontal = useWorkflowStore(state => state.setHelpLineHorizontal)
  // const setHelpLineVertical = useWorkflowStore(state => state.setHelpLineVertical)

  return (
    <>
      {helpLineHorizontal && <HelpLineHorizontal {...helpLineHorizontal} />}
      {helpLineVertical && <HelpLineVertical {...helpLineVertical} />}
    </>
  )
}

export default memo(HelpLine)
