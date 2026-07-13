// apps/web/src/components/dispatch/ui/route-planner/planner-map.tsx

'use client'

import 'maplibre-gl/dist/maplibre-gl.css'

import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { format } from 'date-fns'
import maplibregl from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_WORKER_COLOR, UNASSIGNED_COLOR } from '../board/utils'
import { dayStartAnchor, estimateArrivalForVisit } from './hooks/use-route-planner-mutations'
import { PinPopoverContent } from './pin-popover'
import type {
  PlannerBoard,
  PlannerDayWindow,
  PlannerFilters,
  PlannerVisit,
  RouteGeometry,
} from './types'

// Not a named seam export (types.ts only exports the shapes listed in the build contract) —
// derived via indexed access, same precedent `backlog-pane.tsx` uses.
type PlannerWorkOrder = PlannerBoard['workOrders'][number]

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

interface PlannerMapProps {
  board: PlannerBoard
  filters: PlannerFilters
  geometryByWorker: Record<string, RouteGeometry | undefined>
  window: PlannerDayWindow
}

interface VisiblePin {
  visit: PlannerVisit
  color: string
  /** `routeOrder + 1` within the worker's route, or `null` for an unordered/backlog pin. */
  order: number | null
}

/** A visit's work order shares at least one of the selected tags (`null` selection = all). */
function matchesTagFilter(
  workOrder: PlannerWorkOrder | undefined,
  tags: Set<string> | null
): boolean {
  if (tags === null) return true
  if (!workOrder) return false
  return workOrder.tags.some((t) => tags.has(t))
}

/**
 * The full route line for one worker: `legs[0].geometry` already covers the whole route when
 * `source === 'mapbox'` (Phase 1 addendum). The `'fallback'` source's legs are each an
 * independent 2-point segment — concatenate them into one polyline (first leg's both points,
 * then every subsequent leg's endpoint).
 */
function routeLineCoordinates(geometry: RouteGeometry): [number, number][] {
  if (geometry.legs.length === 0) return []
  if (geometry.source === 'mapbox') return geometry.legs[0]!.geometry
  const coords: [number, number][] = [...geometry.legs[0]!.geometry]
  for (let i = 1; i < geometry.legs.length; i++) {
    const leg = geometry.legs[i]!
    if (leg.geometry.length > 0) coords.push(leg.geometry[leg.geometry.length - 1]!)
  }
  return coords
}

function removeWorkerRoute(map: maplibregl.Map, userId: string) {
  const layerId = `planner-route-${userId}`
  if (map.getLayer(layerId)) map.removeLayer(layerId)
  if (map.getSource(layerId)) map.removeSource(layerId)
}

/**
 * The route planner's MapLibre surface (09-route-planner.md §C): numbered pins per worker
 * route (unassigned/backlog pins are unnumbered, neutral-colored), one polyline per visible
 * worker (dashed when the directions source fell back to haversine), and a read-only "arrives
 * ~" ETA on each pin's tooltip. A thin custom wrapper — no react-map-gl — per the build
 * contract. Clicking a pin opens 2B's `PinPopoverContent` anchored at the pin's projected point.
 */
export function PlannerMap({ board, filters, geometryByWorker, window }: PlannerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const hasFitRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)
  const [anchorPoint, setAnchorPoint] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [0, 0],
      zoom: 2,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => setMapReady(true))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // A day-nav to a new date is a fresh "first load" for fit-bounds purposes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dateKey is the reset trigger, not read in the body.
  useEffect(() => {
    hasFitRef.current = false
  }, [window.dateKey])

  const workOrderById = useMemo(
    () => new Map(board.workOrders.map((wo) => [wo.id, wo])),
    [board.workOrders]
  )

  const visibleWorkerIds = useMemo(
    () => filters.workerIds ?? new Set(board.workers.map((w) => w.userId)),
    [filters.workerIds, board.workers]
  )

  const colorByUserId = useMemo(() => {
    const map = new Map<string, string>()
    for (const w of board.workers) if (w.color) map.set(w.userId, w.color)
    return map
  }, [board.workers])

  // Pins come from both `visits` (the day's assigned + unassigned rows) and `backlog`
  // (unscheduled) — both render on the map when geocoded (design doc §E: a backlog row's
  // "map-preview affordance" implies it has a pin to preview).
  const pins = useMemo<VisiblePin[]>(() => {
    const result: VisiblePin[] = []
    const source: PlannerVisit[] = [...board.visits, ...board.backlog]
    for (const visit of source) {
      if (visit.status === 'canceled') continue
      if (visit.latitude == null || visit.longitude == null) continue
      if (!matchesTagFilter(workOrderById.get(visit.workOrderId), filters.tags)) continue
      if (visit.assigneeUserId && !visibleWorkerIds.has(visit.assigneeUserId)) continue

      const color = visit.assigneeUserId
        ? (colorByUserId.get(visit.assigneeUserId) ?? UNASSIGNED_COLOR)
        : UNASSIGNED_COLOR
      const order = visit.assigneeUserId && visit.routeOrder != null ? visit.routeOrder + 1 : null
      result.push({ visit, color, order })
    }
    return result
  }, [board.visits, board.backlog, workOrderById, filters.tags, visibleWorkerIds, colorByUserId])

  // Cumulative travel-only arrival per visit, reusing the same (robust, `toVisitId`-matched)
  // math the stop-list/apply-times preview uses (`estimateArrivalForVisit`/`dayStartAnchor`,
  // `use-route-planner-mutations.ts`) so the pin tooltip and the side panel never disagree.
  const etaByVisitId = useMemo(() => {
    const map = new Map<string, Date>()
    const workerByUserId = new Map(board.workers.map((w) => [w.userId, w]))
    for (const visit of [...board.visits, ...board.backlog]) {
      if (!visit.assigneeUserId) continue
      const geometry = geometryByWorker[visit.assigneeUserId]
      if (!geometry) continue
      const start = dayStartAnchor(window, workerByUserId.get(visit.assigneeUserId), '08:00')
      const arrival = estimateArrivalForVisit(start, geometry, visit.id)
      if (arrival) map.set(visit.id, arrival)
    }
    return map
  }, [board.visits, board.backlog, board.workers, geometryByWorker, window])

  // Pins: rebuild markers whenever the visible set changes (day's worker count is small enough
  // — ~15-20 stops/worker — that a full rebuild is simpler than a diff).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current.clear()

    for (const pin of pins) {
      const el = document.createElement('div')
      el.className =
        'flex items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white shadow-md cursor-pointer select-none'
      el.style.width = '22px'
      el.style.height = '22px'
      el.style.backgroundColor = pin.color
      el.textContent = pin.order != null ? String(pin.order) : ''

      const workOrder = workOrderById.get(pin.visit.workOrderId)
      const eta = etaByVisitId.get(pin.visit.id)
      el.title = `${workOrder?.number ? `${workOrder.number} · ` : ''}${workOrder?.displayName ?? 'Visit'}${
        eta ? ` — arrives ~${format(eta, 'h:mma')}` : ''
      }`

      el.addEventListener('click', (event) => {
        event.stopPropagation()
        setSelectedVisitId(pin.visit.id)
        const point = map.project([pin.visit.longitude!, pin.visit.latitude!])
        setAnchorPoint({ x: point.x, y: point.y })
      })

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pin.visit.longitude!, pin.visit.latitude!])
        .addTo(map)
      markersRef.current.set(pin.visit.id, marker)
    }
  }, [pins, mapReady, etaByVisitId, workOrderById])

  // Polylines: one GeoJSON source + line layer per visible worker with a route.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    for (const worker of board.workers) {
      if (!visibleWorkerIds.has(worker.userId)) {
        removeWorkerRoute(map, worker.userId)
        continue
      }
      const geometry = geometryByWorker[worker.userId]
      const coordinates = geometry ? routeLineCoordinates(geometry) : []
      if (coordinates.length < 2) {
        removeWorkerRoute(map, worker.userId)
        continue
      }

      const layerId = `planner-route-${worker.userId}`
      const geojson = {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates },
      }
      const existingSource = map.getSource(layerId) as maplibregl.GeoJSONSource | undefined
      if (existingSource) {
        existingSource.setData(geojson as unknown as GeoJSON.Feature)
      } else {
        map.addSource(layerId, { type: 'geojson', data: geojson as unknown as GeoJSON.Feature })
        map.addLayer({
          id: layerId,
          type: 'line',
          source: layerId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': worker.color ?? DEFAULT_WORKER_COLOR,
            'line-width': 3,
            ...(geometry?.source === 'fallback' ? { 'line-dasharray': [2, 2] } : {}),
          },
        })
      }
    }
  }, [board.workers, geometryByWorker, visibleWorkerIds, mapReady])

  // Fit bounds once per day-load, not on every background refetch.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || hasFitRef.current || pins.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    for (const pin of pins) bounds.extend([pin.visit.longitude!, pin.visit.latitude!])
    map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 })
    hasFitRef.current = true
  }, [pins, mapReady])

  const selectedVisit = useMemo(
    () =>
      selectedVisitId
        ? ([...board.visits, ...board.backlog].find((v) => v.id === selectedVisitId) ?? null)
        : null,
    [selectedVisitId, board.visits, board.backlog]
  )

  // Keep the popover anchored to the pin while the map pans/zooms.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedVisit || selectedVisit.longitude == null || selectedVisit.latitude == null)
      return
    const lngLat: [number, number] = [selectedVisit.longitude, selectedVisit.latitude]
    const updateAnchor = () => {
      const point = map.project(lngLat)
      setAnchorPoint({ x: point.x, y: point.y })
    }
    map.on('move', updateAnchor)
    return () => {
      map.off('move', updateAnchor)
    }
  }, [selectedVisit])

  const closePopover = () => {
    setSelectedVisitId(null)
    setAnchorPoint(null)
  }

  return (
    <div className='relative h-full w-full'>
      <div ref={containerRef} className='h-full w-full' />
      {selectedVisit && anchorPoint && (
        <Popover open onOpenChange={(open) => !open && closePopover()}>
          <PopoverAnchor asChild>
            <div
              className='pointer-events-none absolute size-px'
              style={{ left: anchorPoint.x, top: anchorPoint.y }}
            />
          </PopoverAnchor>
          <PopoverContent side='top' align='center' className='w-72 p-0'>
            <PinPopoverContent visit={selectedVisit} board={board} onClose={closePopover} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
