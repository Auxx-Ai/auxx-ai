// 'use client'

// import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
// import {
//   ContextMenu,
//   ContextMenuContent,
//   ContextMenuItem,
//   ContextMenuTrigger,
// } from '~/components/ui/context-menu'
// import {
//   GanttCreateMarkerTrigger,
//   GanttFeatureItem,
//   GanttFeatureList,
//   GanttFeatureListGroup,
//   GanttHeader,
//   GanttMarker,
//   GanttProvider,
//   GanttSidebar,
//   GanttSidebarGroup,
//   GanttSidebarItem,
//   GanttTimeline,
//   GanttToday,
// } from '~/components/ui/gantt'

// import { useState } from 'react'
// import { addMonths, endOfMonth, startOfMonth, subDays, subMonths } from 'date-fns'
// import { Eye, Link, Trash } from 'lucide-react'

// const exampleStatuses = [
//   { id: '1', name: 'Planned', color: '#6B7280' },
//   { id: '2', name: 'In Progress', color: '#F59E0B' },
//   { id: '3', name: 'Done', color: '#10B981' },
// ]

// const MESCHAC_AVATAR = 'https://avatars.githubusercontent.com/u/47919550?v=4'
// const BERNARD_AVATAR = 'https://avatars.githubusercontent.com/u/31113941?v=4'
// const THEO_AVATAR = 'https://avatars.githubusercontent.com/u/68236786?v=4'
// const GLODIE_AVATAR = 'https://avatars.githubusercontent.com/u/99137927?v=4'
// const SHADCN_AVATAR = 'https://avatars.githubusercontent.com/u/124599?v=4'

// export const GanttChart = () => {
//   const today = new Date()

//   const initialFeatures = [
//     {
//       id: '1',
//       name: 'AI Scene Analysis',
//       startAt: startOfMonth(subMonths(today, 6)),
//       endAt: subDays(endOfMonth(today), 5),
//       status: exampleStatuses[0],
//       group: { id: '1', name: 'Core AI Features' },
//       product: { id: '1', name: 'Video Editor Pro' },
//       owner: {
//         id: '1',
//         image: MESCHAC_AVATAR,
//         name: 'Martin Schmidt',
//       },
//       initiative: { id: '1', name: 'AI Integration' },
//       release: { id: '1', name: 'v1.0' },
//     },
//     {
//       id: '2',
//       name: 'Collaborative Editing',
//       startAt: startOfMonth(subMonths(today, 5)),
//       endAt: subDays(endOfMonth(today), 5),
//       status: exampleStatuses[1],
//       group: { id: '2', name: 'Collaboration Tools' },
//       product: { id: '1', name: 'Video Editor Pro' },
//       owner: {
//         id: '2',
//         image: BERNARD_AVATAR,
//         name: 'Ray Cienaga',
//       },
//       initiative: { id: '2', name: 'Real-time Collaboration' },
//       release: { id: '1', name: 'v1.0' },
//     },
//     {
//       id: '3',
//       name: 'AI-Powered Color Grading',
//       startAt: startOfMonth(subMonths(today, 4)),
//       endAt: subDays(endOfMonth(today), 5),
//       status: exampleStatuses[2],
//       group: { id: '1', name: 'Core AI Features' },
//       product: { id: '1', name: 'Video Editor Pro' },
//       owner: {
//         id: '3',
//         image: THEO_AVATAR,
//         name: 'Karo Topchyan',
//       },
//       initiative: { id: '1', name: 'AI Integration' },
//       release: { id: '2', name: 'v1.1' },
//     },
//     {
//       id: '4',
//       name: 'Real-time Video Chat',
//       startAt: startOfMonth(subMonths(today, 3)),
//       endAt: subDays(endOfMonth(today), 12),
//       status: exampleStatuses[0],
//       group: { id: '2', name: 'Collaboration Tools' },
//       product: { id: '1', name: 'Video Editor Pro' },
//       owner: {
//         id: '4',
//         image: GLODIE_AVATAR,
//         name: 'Chris',
//       },
//       initiative: { id: '2', name: 'Real-time Collaboration' },
//       release: { id: '2', name: 'v1.1' },
//     },
//     {
//       id: '5',
//       name: 'AI Voice-to-Text Subtitles',
//       startAt: startOfMonth(subMonths(today, 2)),
//       endAt: subDays(endOfMonth(today), 5),
//       status: exampleStatuses[1],
//       group: { id: '1', name: 'Core AI Features' },
//       product: { id: '1', name: 'Video Editor Pro' },
//       owner: {
//         id: '5',
//         image: SHADCN_AVATAR,
//         name: 'Shadcn',
//       },
//       initiative: { id: '1', name: 'AI Integration' },
//       release: { id: '2', name: 'v1.1' },
//     },
//   ]

//   const exampleMarkers = [
//     {
//       id: '1',
//       date: startOfMonth(subMonths(today, 3)),
//       label: 'Project Kickoff',
//       className: 'bg-blue-100 text-blue-900',
//     },
//     {
//       id: '2',
//       date: subMonths(endOfMonth(today), 2),
//       label: 'Phase 1 Completion',
//       className: 'bg-green-100 text-green-900',
//     },
//     {
//       id: '3',
//       date: startOfMonth(addMonths(today, 3)),
//       label: 'Beta Release',
//       className: 'bg-purple-100 text-purple-900',
//     },
//   ]
//   const [features, setFeatures] = useState(initialFeatures)

//   const groupedFeatures: Record<string, typeof features> = features.reduce<
//     Record<string, typeof features>
//   >((groups, feature) => {
//     const groupName = feature.group.name
//     return {
//       ...groups,
//       [groupName]: [...(groups[groupName] || []), feature],
//     }
//   }, {})

//   const sortedGroupedFeatures = Object.fromEntries(
//     Object.entries(groupedFeatures).sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
//   )

//   const handleViewFeature = (id: string) => console.log(`Feature selected: \${id}`)

//   const handleCopyLink = (id: string) => console.log(`Copy link: \${id}`)

//   const handleRemoveFeature = (id: string) =>
//     setFeatures((prev) => prev.filter((feature) => feature.id !== id))

//   const handleRemoveMarker = (id: string) => console.log(`Remove marker: \${id}`)

//   const handleCreateMarker = (date: Date) => console.log(`Create marker: \${date.toISOString()}`)

//   const handleMoveFeature = (id: string, startAt: Date, endAt: Date | null) => {
//     if (!endAt) {
//       return
//     }

//     setFeatures((prev) =>
//       prev.map((feature) => (feature.id === id ? { ...feature, startAt, endAt } : feature))
//     )

//     console.log(`Move feature: \${id} from \${startAt} to \${endAt}`)
//   }

//   const handleAddFeature = (date: Date) => console.log(`Add feature: \${date.toISOString()}`)

//   return (
//     <GanttProvider
//       onAddItem={handleAddFeature}
//       range="monthly"
//       zoom={50}
//       className="bg-transparent">
//       <GanttSidebar className="border-foreground/10 w-0 border-r">
//         {Object.entries(sortedGroupedFeatures).map(([group, features]) => (
//           <GanttSidebarGroup key={group} name={group}>
//             {features.map((feature) => (
//               <GanttSidebarItem
//                 key={feature.id}
//                 feature={feature}
//                 onSelectItem={handleViewFeature}
//               />
//             ))}
//           </GanttSidebarGroup>
//         ))}
//       </GanttSidebar>
//       <GanttTimeline className="bg-muted/50">
//         <GanttHeader />
//         <GanttFeatureList>
//           {Object.entries(sortedGroupedFeatures).map(([group, features]) => (
//             <GanttFeatureListGroup key={group}>
//               {features.map((feature) => (
//                 <div className="flex" key={feature.id}>
//                   <ContextMenu>
//                     <ContextMenuTrigger asChild>
//                       <button type="button" onClick={() => handleViewFeature(feature.id)}>
//                         <GanttFeatureItem onMove={handleMoveFeature} {...feature}>
//                           <p className="flex-1 truncate text-xs">{feature.name}</p>
//                           {feature.owner && (
//                             <Avatar className="h-4 w-4">
//                               <AvatarImage src={feature.owner.image} />
//                               <AvatarFallback>{feature.owner.name?.slice(0, 2)}</AvatarFallback>
//                             </Avatar>
//                           )}
//                         </GanttFeatureItem>
//                       </button>
//                     </ContextMenuTrigger>
//                     <ContextMenuContent>
//                       <ContextMenuItem
//                         className="flex items-center gap-2"
//                         onClick={() => handleViewFeature(feature.id)}>
//                         <Eye size={16} className="text-muted-foreground" />
//                         View feature
//                       </ContextMenuItem>
//                       <ContextMenuItem
//                         className="flex items-center gap-2"
//                         onClick={() => handleCopyLink(feature.id)}>
//                         <Link size={16} className="text-muted-foreground" />
//                         Copy link
//                       </ContextMenuItem>
//                       <ContextMenuItem
//                         className="text-destructive flex items-center gap-2"
//                         onClick={() => handleRemoveFeature(feature.id)}>
//                         <Trash size={16} />
//                         Remove from roadmap
//                       </ContextMenuItem>
//                     </ContextMenuContent>
//                   </ContextMenu>
//                 </div>
//               ))}
//             </GanttFeatureListGroup>
//           ))}
//         </GanttFeatureList>
//         {exampleMarkers.map((marker) => (
//           <GanttMarker key={marker.id} {...marker} onRemove={handleRemoveMarker} />
//         ))}
//         <GanttToday />
//         <GanttCreateMarkerTrigger onCreateMarker={handleCreateMarker} />
//       </GanttTimeline>
//     </GanttProvider>
//   )
// }
