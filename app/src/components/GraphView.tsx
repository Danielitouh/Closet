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

        const r = Math.max(2, 2 + Math.sqrt(node.degree) * 1.4) * (isActive ? 1.35 : 1)
        const baseColor = node.ghost ? GHOST_COLOR : tagColor(node.tag)

        ctx.globalAlpha = dimmed ? 0.15 : node.ghost ? 0.55 : 1
        ctx.beginPath()
        ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI)
        ctx.fillStyle = baseColor
        ctx.fill()
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

    const resize = () => fg.width(el.clientWidth).height(el.clientHeight)
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    return () => {
      ro.disconnect()
      fg._destructor?.()
    }
  }, [])

  // Data updates.
  useEffect(() => {
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
