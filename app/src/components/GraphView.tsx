import ForceGraph from 'force-graph'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'
import type { GraphLink, GraphNode, WikiGraph } from '../lib/graphData'

export interface PhysicsSettings {
  repel: number // 0..300
  linkDistance: number // 10..120
  linkStrength: number // 0..1
  centerStrength: number // 0..0.3
  labelSize: number // 6..18
}

export const DEFAULT_PHYSICS: PhysicsSettings = {
  repel: 60,
  linkDistance: 40,
  linkStrength: 0.4,
  centerStrength: 0.05,
  labelSize: 10,
}

// Muted accent palette on near-black; tag -> stable color.
const PALETTE = [
  '#7dd3a8', '#8ab4f8', '#f2b8c6', '#ffd28f', '#b39ddb',
  '#80cbc4', '#e6ee9c', '#f48fb1', '#90caf9', '#ffab91',
]
const GHOST_COLOR = 'rgba(160,170,180,0.35)'
const DEFAULT_COLOR = '#cfd8dc'

function tagColor(tag: string | null): string {
  if (!tag) return DEFAULT_COLOR
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

// --- Neuron animation helpers -----------------------------------------------

/** Stable per-node phase so nodes breathe out of sync, like a living field. */
function phaseOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0
  return ((h % 1000) / 1000) * Math.PI * 2
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Soft radial glow sprites, one per color — drawImage per frame is cheap,
// per-frame shadowBlur is not.
const glowSprites = new Map<string, HTMLCanvasElement>()
const GLOW_SIZE = 64

function glowSprite(color: string): HTMLCanvasElement {
  let sprite = glowSprites.get(color)
  if (sprite) return sprite
  sprite = document.createElement('canvas')
  sprite.width = sprite.height = GLOW_SIZE
  const g = sprite.getContext('2d')!
  const [r, gr, b] = color.startsWith('#') ? hexToRgb(color) : [207, 216, 220]
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `rgba(${r},${gr},${b},0.85)`)
  grad.addColorStop(0.4, `rgba(${r},${gr},${b},0.28)`)
  grad.addColorStop(1, `rgba(${r},${gr},${b},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE)
  glowSprites.set(color, sprite)
  return sprite
}

interface Firing {
  start: number
  intensity: number // 1 = full action potential, <1 = arrival echo
}

interface Pulse {
  from: string
  to: string
  start: number
  dur: number
}

const FIRE_MS = 650

export interface GraphViewHandle {
  focusNode: (id: string) => void
  zoomToFit: () => void
}

interface Props {
  graph: WikiGraph
  visible: Set<string> | null // null = show all
  physics: PhysicsSettings
  selectedId: string | null
  onNodeClick: (id: string, ghost: boolean) => void
  onBackgroundClick: () => void
}

const GraphView = forwardRef<GraphViewHandle, Props>(function GraphView(
  { graph, visible, physics, selectedId, onNodeClick, onBackgroundClick },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  // force-graph instance type is unwieldy; keep it loose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const hoverRef = useRef<{ id: string | null; neighbors: Set<string> }>({
    id: null,
    neighbors: new Set(),
  })
  // Neuron animation state
  const firingRef = useRef<Map<string, Firing>>(new Map())
  const pulsesRef = useRef<Pulse[]>([])
  const nodesByIdRef = useRef<Map<string, GraphNode>>(new Map())
  const reducedMotionRef = useRef(
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selectedId
  const graphRef = useRef(graph)
  graphRef.current = graph
  const physicsRef = useRef(physics)
  physicsRef.current = physics
  const onNodeClickRef = useRef(onNodeClick)
  onNodeClickRef.current = onNodeClick
  const onBackgroundClickRef = useRef(onBackgroundClick)
  onBackgroundClickRef.current = onBackgroundClick

  const data = useMemo(() => {
    if (!visible) return { nodes: graph.nodes, links: graph.links }
    const nodes = graph.nodes.filter((n) => visible.has(n.id))
    const links = graph.links.filter((l) => {
      const s = typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string)
      const t = typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string)
      return visible.has(s) && visible.has(t)
    })
    return { nodes, links }
  }, [graph, visible])

  // Create the instance once.
  useEffect(() => {
    const el = containerRef.current!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fg = new ForceGraph(el) as any
    fgRef.current = fg

    fg.backgroundColor('#0b0d10')
      .autoPauseRedraw(false)
      .nodeId('id')
      .nodeLabel(() => '')
      .linkColor((l: GraphLink) => {
        const hover = hoverRef.current
        const active = hover.id ?? selectedRef.current
        if (!active) return 'rgba(210,220,230,0.13)'
        const s = typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string)
        const t = typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string)
        return s === active || t === active
          ? 'rgba(230,240,250,0.55)'
          : 'rgba(210,220,230,0.05)'
      })
      .linkWidth((l: GraphLink) => {
        const active = hoverRef.current.id ?? selectedRef.current
        if (!active) return 1
        const s = typeof l.source === 'object' ? (l.source as GraphNode).id : (l.source as string)
        const t = typeof l.target === 'object' ? (l.target as GraphNode).id : (l.target as string)
        return s === active || t === active ? 1.8 : 1
      })
      .nodeCanvasObject((node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
        const hover = hoverRef.current
        const active = hover.id ?? selectedRef.current
        const isActive = active === node.id
        const isNeighbor =
          active !== null &&
          (hover.id
            ? hover.neighbors.has(node.id)
            : graphRef.current.neighbors.get(active)?.has(node.id) ?? false)
        const dimmed = active !== null && !isActive && !isNeighbor

        const now = performance.now()
        const calm = reducedMotionRef.current
        const crowded = nodesByIdRef.current.size > 400

        // Idle breathing: slow, per-node phase (silent when reduced motion).
        const breathe = calm ? 0 : Math.sin(now / 1600 + phaseOf(node.id))

        // Firing flash: quick decay after an action potential or pulse arrival.
        let fireT = 0
        const fire = firingRef.current.get(node.id)
        if (fire) {
          const dt = (now - fire.start) / FIRE_MS
          if (dt >= 1) firingRef.current.delete(node.id)
          else fireT = Math.pow(1 - dt, 1.6) * fire.intensity
        }

        const rBase = Math.max(2, 2 + Math.sqrt(node.degree) * 1.4) * (isActive ? 1.35 : 1)
        const r = rBase * (1 + 0.06 * breathe + 0.3 * fireT)
        const baseColor = node.ghost ? GHOST_COLOR : tagColor(node.tag)

        // Soft neuron glow beneath the body. On very large graphs only firing
        // nodes glow, so the 1,000-note case stays cheap.
        if (!dimmed && !node.ghost && (fireT > 0 || !crowded)) {
          const glowAlpha = (calm ? 0.10 : 0.13 + 0.07 * (breathe + 1) * 0.5) + 0.6 * fireT
          const gr = r * (2.6 + 2.2 * fireT)
          ctx.globalAlpha = Math.min(1, glowAlpha)
          ctx.drawImage(glowSprite(baseColor), node.x! - gr, node.y! - gr, gr * 2, gr * 2)
        }

        ctx.globalAlpha = dimmed ? 0.15 : node.ghost ? 0.55 : 1
        ctx.beginPath()
        ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI)
        ctx.fillStyle = baseColor
        ctx.fill()
        if (fireT > 0.02 && !dimmed) {
          // bright core while firing
          ctx.globalAlpha = Math.min(1, fireT)
          ctx.beginPath()
          ctx.arc(node.x!, node.y!, r * 0.45, 0, 2 * Math.PI)
          ctx.fillStyle = '#f2fbff'
          ctx.fill()
        }
        if (isActive) {
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.5 / scale
          ctx.stroke()
        }

        // Labels fade in with zoom; always show for active/neighbor nodes.
        const zoomAlpha = Math.max(0, Math.min(1, (scale - 1.4) / 1.6))
        const labelAlpha = isActive || isNeighbor ? Math.max(zoomAlpha, 0.95) : zoomAlpha
        if (labelAlpha > 0.02 && !dimmed) {
          const fontSize = physicsRef.current.labelSize / scale
          ctx.font = `${fontSize}px Inter, system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.globalAlpha = labelAlpha
          ctx.fillStyle = '#e8ecef'
          ctx.fillText(node.id, node.x!, node.y! + r + 2 / scale)
        }
        ctx.globalAlpha = 1
      })
      .nodePointerAreaPaint((node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
        const r = Math.max(6, 2 + Math.sqrt(node.degree) * 1.4 + 4)
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI)
        ctx.fill()
      })
      .onNodeHover((node: GraphNode | null) => {
        hoverRef.current = {
          id: node ? node.id : null,
          neighbors: node ? graphRef.current.neighbors.get(node.id) ?? new Set() : new Set(),
        }
        el.style.cursor = node ? 'pointer' : 'grab'
      })
      .onNodeClick((node: GraphNode) => {
        onNodeClickRef.current(node.id, node.ghost)
      })
      .onBackgroundClick(() => onBackgroundClickRef.current())

    // Traveling synaptic pulses, drawn above links/nodes each frame.
    fg.onRenderFramePost((ctx: CanvasRenderingContext2D) => {
      const pulses = pulsesRef.current
      if (pulses.length === 0) return
      const now = performance.now()
      const keep: Pulse[] = []
      for (const p of pulses) {
        const t = (now - p.start) / p.dur
        if (t < 0) {
          keep.push(p)
          continue
        }
        const a = nodesByIdRef.current.get(p.from)
        const b = nodesByIdRef.current.get(p.to)
        if (!a || !b || a.x === undefined || b.x === undefined) continue
        if (t >= 1) {
          // Arrival: the receiving neuron echoes with a dimmer flash.
          if (!firingRef.current.has(p.to)) {
            firingRef.current.set(p.to, { start: now, intensity: 0.45 })
          }
          continue
        }
        const e = t * t * (3 - 2 * t) // smoothstep
        const x = a.x! + (b.x! - a.x!) * e
        const y = a.y! + (b.y! - a.y!) * e
        const fade = Math.sin(Math.PI * t)
        const color = a.ghost ? DEFAULT_COLOR : tagColor(a.tag)
        ctx.globalAlpha = 0.8 * fade
        ctx.drawImage(glowSprite(color), x - 7, y - 7, 14, 14)
        ctx.globalAlpha = Math.min(1, 1.1 * fade)
        ctx.beginPath()
        ctx.arc(x, y, 1.5, 0, 2 * Math.PI)
        ctx.fillStyle = '#eef8ff'
        ctx.fill()
        ctx.globalAlpha = 1
        keep.push(p)
      }
      pulsesRef.current = keep
    })

    // Firing scheduler: a random neuron fires every couple of seconds and
    // sends pulses to a few neighbors. Quieter on very large graphs; silent
    // under prefers-reduced-motion.
    const fireTimer = window.setInterval(() => {
      if (reducedMotionRef.current || document.hidden) return
      const nodes = (fg.graphData().nodes as GraphNode[]).filter((n) => !n.ghost)
      if (nodes.length === 0) return
      if (nodes.length > 400 && Math.random() < 0.5) return
      const node = nodes[Math.floor(Math.random() * nodes.length)]
      const now = performance.now()
      firingRef.current.set(node.id, { start: now, intensity: 1 })
      const nbs = [...(graphRef.current.neighbors.get(node.id) ?? [])]
      const count = Math.min(3, nbs.length)
      for (let i = 0; i < count; i++) {
        const [to] = nbs.splice(Math.floor(Math.random() * nbs.length), 1)
        pulsesRef.current.push({
          from: node.id,
          to,
          start: now + 130,
          dur: 420 + Math.random() * 280,
        })
      }
    }, 1700)

    const resize = () => fg.width(el.clientWidth).height(el.clientHeight)
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    return () => {
      window.clearInterval(fireTimer)
      ro.disconnect()
      fg._destructor?.()
    }
  }, [])

  // Data updates.
  useEffect(() => {
    nodesByIdRef.current = new Map(data.nodes.map((n) => [n.id, n]))
    fgRef.current?.graphData(data)
  }, [data])

  // Physics updates.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('charge')?.strength(-physics.repel)
    fg.d3Force('link')?.distance(physics.linkDistance).strength(physics.linkStrength)
    try {
      fg.d3Force('center')?.strength?.(physics.centerStrength)
    } catch {
      /* older d3 center force without strength */
    }
    fg.d3ReheatSimulation()
  }, [physics])

  useImperativeHandle(ref, () => ({
    focusNode(id: string) {
      const fg = fgRef.current
      if (!fg) return
      const node = (fg.graphData().nodes as GraphNode[]).find((n) => n.id === id)
      if (node && node.x !== undefined) {
        fg.centerAt(node.x, node.y, 700)
        fg.zoom(Math.max(fg.zoom(), 3.5), 700)
      }
    },
    zoomToFit() {
      fgRef.current?.zoomToFit(600, 60)
    },
  }))

  return <div ref={containerRef} className="graph-container" />
})

export default GraphView
export { tagColor }
