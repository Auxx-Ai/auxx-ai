// apps/web/src/components/dispatch/ui/route-planner/planner-map.tsx

'use client'

import 'maplibre-gl/dist/maplibre-gl.css'

import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { format } from 'date-fns'
import maplibregl from 'maplibre-gl'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_WORKER_COLOR } from '../board/utils'
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

/** OpenFreeMap basemaps — same tile source, one light + one dark variant, no extra provider/key.
 * Picked per the app theme (`next-themes` `resolvedTheme`); a toggle rebuilds the map (see the
 * construction effect) so the light-tuned pin colors below swap with it. */
const MAP_STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty'
const MAP_STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark'

/** Teardrop pin path (§2.2): 28×38, head circle radius 14 centered at (14,14), tip at (14,38). */
const TEARDROP_PATH_D =
  'M14 0C6.268 0 0 6.268 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.268 21.732 0 14 0z'
/** Distinctly neutral for unassigned/backlog map pins — the board's chip `UNASSIGNED_COLOR`
 * (slate-400) doesn't read well on either basemap, so we darken it on the light Liberty tiles
 * (slate-600) and lighten it on the dark tiles (slate-400) instead. */
const MAP_UNASSIGNED_PIN_COLOR_LIGHT = '#475569'
const MAP_UNASSIGNED_PIN_COLOR_DARK = '#94a3b8'
/** Home-base marker fill — deliberately never a worker color (decision record #5/#9); a dark
 * slate badge on light tiles, a light slate badge (with a dark icon/border) on dark tiles. */
const HOME_MARKER_COLOR_LIGHT = '#1e293b'
const HOME_MARKER_COLOR_DARK = '#e2e8f0'
const PIN_OUTLINE_COLOR = 'rgba(0,0,0,0.45)'
const SELECTED_RING_COLOR = '#2563eb'

/** Worker colors are stored as `SelectOptionColor` IDS (e.g. `'amber'`, `'forest'`) — not valid
 * CSS colors; MapLibre *validates* paint values and rejects them outright (`line-color: color
 * expected, "amber" found`), and an SVG `fill` silently falls back to black. Resolve ids to
 * full-saturation hex here; real CSS colors pass through so this stays compatible with the
 * app-wide color-resolution fix (11-calendar-event-colors.md) once that lands. */
const WORKER_COLOR_HEX: Record<string, string> = {
  gray: '#71717a',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  green: '#22c55e',
  forest: '#15803d',
  teal: '#14b8a6',
  blue: '#3b82f6',
  indigo: '#6366f1',
  purple: '#a855f7',
  pink: '#ec4899',
}

function resolveWorkerColor(color: string | null): string | null {
  if (!color) return null
  return WORKER_COLOR_HEX[color] ?? color
}

interface PlannerMapProps {
  board: PlannerBoard
  filters: PlannerFilters
  geometryByWorker: Record<string, RouteGeometry | undefined>
  window: PlannerDayWindow
  /** True only until the board's first-ever load resolves (`use-route-planner-data.ts`'s
   * `boardQuery.isLoading`) — gates the map's construction so it never paints a world view that
   * then jumps to the depot once resolved (§2.1). */
  isLoading: boolean
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
 * The full route line for one worker (§2.3): concatenates every `legs[].geometry` plus
 * `returnLeg?.geometry ?? []`, deduping shared endpoints between consecutive segments. This is
 * source-agnostic by construction — mapbox mode stows the *entire* polyline (return leg
 * included) on `legs[0]` with every other segment `[]` (including `returnLeg` in the common
 * case), so the concat is just that one segment; the one edge case where `routeStartAtHome` is
 * off with exactly one stop lands the full polyline on `returnLeg.geometry` with `legs` empty —
 * the concat picks it up there instead. Fallback mode's legs/returnLeg are each independent
 * 2-point segments that genuinely need concatenating into one polyline.
 */
function routeLineCoordinates(geometry: RouteGeometry): [number, number][] {
  const segments = [...geometry.legs.map((leg) => leg.geometry), geometry.returnLeg?.geometry ?? []]
  const coords: [number, number][] = []
  for (const segment of segments) {
    for (const point of segment) {
      const last = coords[coords.length - 1]
      if (!last || last[0] !== point[0] || last[1] !== point[1]) coords.push(point)
    }
  }
  return coords
}

function removeWorkerRoute(map: maplibregl.Map, workerId: string) {
  const layerId = `planner-route-${workerId}`
  if (map.getLayer(layerId)) map.removeLayer(layerId)
  if (map.getSource(layerId)) map.removeSource(layerId)
}

/**
 * One teardrop pin marker (§2.2). The OUTER element is what MapLibre positions — `Marker._update`
 * writes its own `style.transform` on that exact element for every map move/anchor, so nothing
 * here may touch it. The visual (scale on hover/select) instead lives on an INNER wrapper with
 * `transform-origin: bottom center`, keeping the tip pinned to the coordinate while it scales.
 */
function createPinElement(fill: string, order: number | null): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'cursor-pointer select-none'

  const inner = document.createElement('div')
  inner.className = 'planner-pin-inner'
  inner.style.position = 'relative'
  inner.style.width = '28px'
  inner.style.height = '38px'
  inner.style.transformOrigin = 'bottom center'
  inner.style.transition = 'transform 120ms ease'
  inner.innerHTML = `
    <svg width="28" height="38" viewBox="0 0 28 38" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.35));">
      <circle class="pin-ring" cx="14" cy="14" r="16" fill="none" stroke="${SELECTED_RING_COLOR}" stroke-width="3" opacity="0"></circle>
      <path d="${TEARDROP_PATH_D}" fill="${fill}" stroke="${PIN_OUTLINE_COLOR}" stroke-width="1.5"></path>
    </svg>
    <div style="position:absolute;top:0;left:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;pointer-events:none;">${
      order != null ? order : ''
    }</div>
  `
  el.appendChild(inner)
  return el
}

/** Scale/ring state for one pin marker's inner wrapper (never the outer, MapLibre-owned element). */
function applyPinVisualState(el: HTMLElement, opts: { selected: boolean; hovered: boolean }) {
  const inner = el.querySelector<HTMLElement>('.planner-pin-inner')
  if (!inner) return
  const ring = inner.querySelector<SVGCircleElement>('.pin-ring')
  ring?.setAttribute('opacity', opts.selected ? '1' : '0')
  inner.style.transform = opts.selected ? 'scale(1.18)' : opts.hovered ? 'scale(1.08)' : 'scale(1)'
  el.style.zIndex = opts.selected ? '2' : opts.hovered ? '1' : '0'
}

/** Home-base marker (§2.2): distinct house-icon badge at `board.depot`, neutral (never a worker
 * color), anchored `center` since the badge (unlike a teardrop) has no natural tip. The badge
 * inverts with the theme so it stays legible on either basemap: dark fill + white icon/ring on
 * light tiles, light fill + dark icon/ring on dark tiles. */
function createHomeMarkerElement(isDark: boolean): HTMLDivElement {
  const contrast = isDark ? '#1e293b' : 'white'
  const el = document.createElement('div')
  el.title = 'Home base'
  Object.assign(el.style, {
    width: '32px',
    height: '32px',
    borderRadius: '9999px',
    background: isDark ? HOME_MARKER_COLOR_DARK : HOME_MARKER_COLOR_LIGHT,
    border: `2px solid ${contrast}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  })
  el.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${contrast}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path>
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
    </svg>
  `
  return el
}

/**
 * The route planner's MapLibre surface (09-route-planner.md §C, polished per plans/dispatch/v4/
 * 01-planner-polish.md §2): numbered teardrop pins per worker route (unassigned/backlog pins
 * unnumbered, neutral-colored), one polyline per visible worker (dashed when the directions
 * source fell back to haversine), a home-base marker at the org depot, and a read-only "arrives
 * ~" ETA on each pin's tooltip. A thin custom wrapper — no react-map-gl — per the build contract.
 * Clicking a pin opens 2B's `PinPopoverContent` anchored at the pin's projected point (the tip).
 */
export function PlannerMap({
  board,
  filters,
  geometryByWorker,
  window,
  isLoading,
}: PlannerMapProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const depotMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)
  const selectedVisitIdRef = useRef(selectedVisitId)
  selectedVisitIdRef.current = selectedVisitId
  const [anchorPoint, setAnchorPoint] = useState<{ x: number; y: number } | null>(null)

  // §2.1: never construct on the world view then jump — wait for the board's first-ever load
  // (`isLoading` false) so `board.depot` already reflects its real resolved value (a real point,
  // or `null` only when the org truly has no business address) before the map exists at all.
  const boardRef = useRef(board)
  boardRef.current = board
  const constructedWithDepotRef = useRef(false)

  // Depends on `isDark` too: the basemap style is fixed at construction, so a theme toggle tears
  // the map down and rebuilds it with the other style. Cheap here (rare toggle) and it lets every
  // downstream effect re-add its markers/routes/home for the new style without a `setStyle` re-add
  // dance — mapReady flips false→true, re-arming them all.
  useEffect(() => {
    if (mapRef.current || !containerRef.current || isLoading) return
    const depot = boardRef.current.depot
    constructedWithDepotRef.current = Boolean(depot)
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
      center: depot ? [depot.lng, depot.lat] : [0, 0],
      zoom: depot ? 11 : 2,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => setMapReady(true))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      // `map.remove()` drops every marker; clear the refs so the rebuilt map re-adds fresh ones
      // (the pins effect already self-clears `markersRef`, but the depot marker is created once).
      depotMarkerRef.current = null
      setMapReady(false)
    }
  }, [isLoading, isDark])

  // Defensive fallback for the rare race where the map had to construct before the depot was
  // known (e.g. `isLoading` flipped false on a render where `board` itself hadn't updated yet):
  // an instant `jumpTo` (never an animated `flyTo`) the first time a real depot shows up.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !board.depot || constructedWithDepotRef.current) return
    map.jumpTo({ center: [board.depot.lng, board.depot.lat], zoom: 11 })
    constructedWithDepotRef.current = true
  }, [board.depot])

  const workOrderById = useMemo(
    () => new Map(board.workOrders.map((wo) => [wo.id, wo])),
    [board.workOrders]
  )

  const visibleWorkerIds = useMemo(
    () => filters.workerIds ?? new Set(board.workers.map((w) => w.id)),
    [filters.workerIds, board.workers]
  )

  // Keyed by `DispatchWorker.id` (the column identity, not `userId` — teams have no `userId`).
  const colorByWorkerId = useMemo(() => {
    const map = new Map<string, string>()
    for (const w of board.workers) {
      const color = resolveWorkerColor(w.color)
      if (color) map.set(w.id, color)
    }
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
      if (visit.assigneeWorkerId && !visibleWorkerIds.has(visit.assigneeWorkerId)) continue

      const unassignedColor = isDark
        ? MAP_UNASSIGNED_PIN_COLOR_DARK
        : MAP_UNASSIGNED_PIN_COLOR_LIGHT
      const color = visit.assigneeWorkerId
        ? (colorByWorkerId.get(visit.assigneeWorkerId) ?? unassignedColor)
        : unassignedColor
      const order = visit.assigneeWorkerId && visit.routeOrder != null ? visit.routeOrder + 1 : null
      result.push({ visit, color, order })
    }
    return result
  }, [
    board.visits,
    board.backlog,
    workOrderById,
    filters.tags,
    visibleWorkerIds,
    colorByWorkerId,
    isDark,
  ])

  // Cumulative travel-only arrival per visit, reusing the same (robust, `toVisitId`-matched)
  // math the stop-list/apply-times preview uses (`estimateArrivalForVisit`/`dayStartAnchor`,
  // `use-route-planner-mutations.ts`) so the pin tooltip and the side panel never disagree.
  const etaByVisitId = useMemo(() => {
    const map = new Map<string, Date>()
    const workerById = new Map(board.workers.map((w) => [w.id, w]))
    for (const visit of [...board.visits, ...board.backlog]) {
      if (!visit.assigneeWorkerId) continue
      const geometry = geometryByWorker[visit.assigneeWorkerId]
      if (!geometry) continue
      const start = dayStartAnchor(window, workerById.get(visit.assigneeWorkerId), '08:00')
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
      const el = createPinElement(pin.color, pin.order)
      // Rebuilds happen while a popover can be open (ETAs/geometry arriving re-key the effect)
      // — re-apply the current selection so the selected pin's ring/scale survives the rebuild.
      const selected = pin.visit.id === selectedVisitIdRef.current
      el.dataset.selected = String(selected)
      if (selected) applyPinVisualState(el, { selected: true, hovered: false })

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
      el.addEventListener('pointerenter', () => {
        if (el.dataset.selected === 'true') return
        applyPinVisualState(el, { selected: false, hovered: true })
      })
      el.addEventListener('pointerleave', () => {
        if (el.dataset.selected === 'true') return
        applyPinVisualState(el, { selected: false, hovered: false })
      })

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([pin.visit.longitude!, pin.visit.latitude!])
        .addTo(map)
      markersRef.current.set(pin.visit.id, marker)
    }
  }, [pins, mapReady, etaByVisitId, workOrderById])

  // Selected-pin visual state: kept as its own effect (not folded into the rebuild above) since
  // selection changes far more often than the marker set itself.
  useEffect(() => {
    markersRef.current.forEach((marker, visitId) => {
      const el = marker.getElement()
      const selected = visitId === selectedVisitId
      el.dataset.selected = String(selected)
      applyPinVisualState(el, { selected, hovered: false })
    })
  }, [selectedVisitId])

  // Home-base marker: always shown when the org has a resolved depot, independent of per-worker
  // route-home switches (decision record #9 / plan §2.2).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (!board.depot) {
      depotMarkerRef.current?.remove()
      depotMarkerRef.current = null
      return
    }
    if (!depotMarkerRef.current) {
      depotMarkerRef.current = new maplibregl.Marker({
        element: createHomeMarkerElement(isDark),
        anchor: 'center',
      })
        .setLngLat([board.depot.lng, board.depot.lat])
        .addTo(map)
    } else {
      depotMarkerRef.current.setLngLat([board.depot.lng, board.depot.lat])
    }
  }, [board.depot, mapReady, isDark])

  // Polylines: one GeoJSON source + line layer per visible worker with a route.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    for (const worker of board.workers) {
      if (!visibleWorkerIds.has(worker.id)) {
        removeWorkerRoute(map, worker.id)
        continue
      }
      const geometry = geometryByWorker[worker.id]
      const coordinates = geometry ? routeLineCoordinates(geometry) : []
      if (coordinates.length < 2) {
        removeWorkerRoute(map, worker.id)
        continue
      }

      const layerId = `planner-route-${worker.id}`
      const geojson = {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates },
      }
      const existingSource = map.getSource(layerId) as maplibregl.GeoJSONSource | undefined
      if (existingSource) {
        existingSource.setData(geojson)
      } else {
        map.addSource(layerId, { type: 'geojson', data: geojson })
        map.addLayer({
          id: layerId,
          type: 'line',
          source: layerId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': resolveWorkerColor(worker.color) ?? DEFAULT_WORKER_COLOR,
            'line-width': 3,
            ...(geometry?.source === 'fallback' ? { 'line-dasharray': [2, 2] } : {}),
          },
        })
      }
    }
  }, [board.workers, geometryByWorker, visibleWorkerIds, mapReady])

  // §2.4 fit-bounds: refit on day change or a pin-set change (sorted visit-id signature, backlog
  // included), including the depot marker in bounds; never mid-interaction (guarded by
  // `map.isMoving()` + a pointerdown-tracked flag below), re-armed on the next signature change.
  const fitSignature = useMemo(
    () =>
      `${window.dateKey}|${pins
        .map((p) => p.visit.id)
        .sort()
        .join(',')}`,
    [window.dateKey, pins]
  )
  const fitSignatureRef = useRef(fitSignature)
  fitSignatureRef.current = fitSignature
  const pinsRef = useRef(pins)
  pinsRef.current = pins
  const depotRef = useRef(board.depot)
  depotRef.current = board.depot
  const lastFitSignatureRef = useRef<string | null>(null)
  const pendingFitRef = useRef(false)
  const userInteractingRef = useRef(false)

  const attemptFit = useCallback((signature: string) => {
    const map = mapRef.current
    if (!map) return
    if (map.isMoving() || userInteractingRef.current) {
      pendingFitRef.current = true
      return
    }
    const currentPins = pinsRef.current
    if (currentPins.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    for (const pin of currentPins) bounds.extend([pin.visit.longitude!, pin.visit.latitude!])
    const depot = depotRef.current
    if (depot) bounds.extend([depot.lng, depot.lat])
    const isFirstFit = lastFitSignatureRef.current === null
    map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: isFirstFit ? 0 : 500 })
    lastFitSignatureRef.current = signature
    pendingFitRef.current = false
  }, [])

  useEffect(() => {
    if (!mapReady) return
    attemptFit(fitSignature)
  }, [fitSignature, mapReady, attemptFit])

  // Interaction tracking + re-arm: a pointerdown on the map marks "interacting" (blocking any
  // fit attempted while it's true); once the pointer lifts and the camera settles, retry a fit
  // that was deferred while the signature had already changed underneath the user. NB: the
  // pointerup listener goes on `document` — `window` in this component is the day-window PROP,
  // shadowing the global.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const container = map.getContainer()
    const onPointerDown = () => {
      userInteractingRef.current = true
    }
    const onPointerUp = () => {
      userInteractingRef.current = false
      if (pendingFitRef.current) attemptFit(fitSignatureRef.current)
    }
    const onMoveEnd = () => {
      if (pendingFitRef.current && !map.isMoving() && !userInteractingRef.current) {
        attemptFit(fitSignatureRef.current)
      }
    }
    container.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerup', onPointerUp)
    map.on('moveend', onMoveEnd)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerup', onPointerUp)
      map.off('moveend', onMoveEnd)
    }
  }, [mapReady, attemptFit])

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
