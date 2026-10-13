'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Save,
  Smartphone,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { NodeType, WorkflowEdge, WorkflowNode } from '@/lib/flows/flow-types'
import { getWorkflowIssues } from '@/lib/flows/flow-graph'
import {
  BODY_PADDING,
  HEADER_HEIGHT,
  INPUT_ANCHOR,
  NODE_WIDTH,
  PALETTE,
  PREVIEW_GAP,
  PREVIEW_HEIGHT,
  ROW_GAP,
  ROW_HEIGHT,
  TONE_CLASSES,
  estimateNodeHeight,
  getNodeDefinition,
  getNodeOutputs,
  getNodeSummary,
  getOutputAnchor,
  uid,
} from '@/components/flows/node-catalog'
import { NodeInspector } from '@/components/flows/node-inspector'
import { FlowSimulator, type SimulatorMessage } from '@/components/flows/flow-simulator'

type Panel = 'inspector' | 'simulator' | 'issues' | null

const PORT_SIZE = 14
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2

/** A smooth left-to-right curve between two points, readable even when the target is behind the source. */
function edgePath(sx: number, sy: number, ex: number, ey: number) {
  const bend = Math.max(50, Math.abs(ex - sx) * 0.5)
  return `M ${sx} ${sy} C ${sx + bend} ${sy}, ${ex - bend} ${ey}, ${ex} ${ey}`
}

/** The input fields of a form (captions and other display-only elements are skipped). */
function getFormFields(form: any): any[] {
  return (Array.isArray(form?.screens) ? form.screens : [])
    .flatMap((screen: any) => screen?.layout?.children || [])
    .filter((field: any) => field?.name && !['TextCaption', 'TextSubheading', 'TextBody', 'Footer'].includes(field.type))
}

/** Sample answers for a form, so the test panel can continue past a form step. */
function buildSampleAnswers(form: any): Record<string, any> {
  const answers: Record<string, any> = {}
  {
    for (const field of getFormFields(form)) {
      const firstOption = field.options?.[0]?.id
      if (field.type === 'OptIn') answers[field.name] = true
      else if (field.type === 'CheckboxGroup') answers[field.name] = firstOption ? [firstOption] : []
      else if (field.type === 'Dropdown' || field.type === 'RadioGroup') answers[field.name] = firstOption || 'option'
      else if (field.type === 'DatePicker') answers[field.name] = new Date().toISOString().slice(0, 10)
      else if (field.type === 'TimePicker') answers[field.name] = '10:00'
      else answers[field.name] = field.input_type === 'email' ? 'test@example.com' : field.input_type === 'number' ? '10' : 'Sample answer'
    }
  }
  return Object.keys(answers).length ? answers : { full_name: 'Test Customer' }
}

export default function FlowCanvasBuilderPage() {
  const params = useParams()
  const workflowId = params?.id as string

  // ── Flow data ──────────────────────────────────────────────────────────────
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [nodes, setNodes] = useState<WorkflowNode[]>([])
  const [edges, setEdges] = useState<WorkflowEdge[]>([])
  const [flowName, setFlowName] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [environmentIssues, setEnvironmentIssues] = useState<string[]>([])
  const [saveError, setSaveError] = useState('')
  const [recentSessions, setRecentSessions] = useState<any[]>([])
  const [pipelineStages, setPipelineStages] = useState<Array<{ id: string; name: string }>>([])
  const [nativeForms, setNativeForms] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // ── Selection and panels ───────────────────────────────────────────────────
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; handleId?: string } | null>(null)
  const [panel, setPanel] = useState<Panel>(null)

  // ── Viewport (pan and zoom). Refs mirror state for the window-level listeners. ──
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  const nodesRef = useRef(nodes)
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null)
  const panStartRef = useRef<{ x: number; y: number } | null>(null)
  const connectingRef = useRef(connectingFrom)

  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { connectingRef.current = connectingFrom }, [connectingFrom])

  const applyView = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    const roundedZoom = Math.round(nextZoom * 100) / 100
    const roundedPan = { x: Math.round(nextPan.x), y: Math.round(nextPan.y) }
    zoomRef.current = roundedZoom
    panRef.current = roundedPan
    setZoom(roundedZoom)
    setPan(roundedPan)
  }, [])

  // ── Simulator ──────────────────────────────────────────────────────────────
  const [simulatorMessages, setSimulatorMessages] = useState<SimulatorMessage[]>([])
  const [simulatedNodeId, setSimulatedNodeId] = useState<string | null>(null)
  const [simulatedState, setSimulatedState] = useState<Record<string, any>>({})
  const [simulatorInput, setSimulatorInput] = useState('')
  const [simulatorBusy, setSimulatorBusy] = useState(false)
  const [simulationCompleted, setSimulationCompleted] = useState(false)

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function loadFlow() {
      if (!workflowId) return
      setLoadState('loading')
      try {
        const res = await fetch(`/api/flows/workflows/${workflowId}`)
        if (!res.ok) throw new Error('not found')
        const data = await res.json()
        if (cancelled) return
        const workflow = data.workflow

        setFlowName(workflow.name || '')
        setIsActive(Boolean(workflow.is_active))
        setNodes(Array.isArray(workflow.canvas_nodes) ? workflow.canvas_nodes : [])
        setEdges(Array.isArray(workflow.canvas_edges) ? workflow.canvas_edges : [])
        setEnvironmentIssues(data.environmentErrors || [])
        setRecentSessions(data.recentSessions || [])
        setPipelineStages(data.pipelineStages || [])
        setLoadState('ready')

        if (workflow.organization_id) {
          const formsRes = await fetch(`/api/flows/native?organizationId=${workflow.organization_id}`)
          if (formsRes.ok && !cancelled) setNativeForms((await formsRes.json()).flows || [])
        }
      } catch {
        if (!cancelled) setLoadState('missing')
      }
    }
    loadFlow()
    return () => {
      cancelled = true
    }
  }, [workflowId])

  // ── Validation: computed live from the canvas, so problems show as they are made ──
  const graphIssues = useMemo(() => getWorkflowIssues(nodes, edges), [nodes, edges])
  const issuesByNode = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const issue of graphIssues) {
      if (!issue.nodeId) continue
      map.set(issue.nodeId, [...(map.get(issue.nodeId) || []), issue.message])
    }
    return map
  }, [graphIssues])
  const issueCount = graphIssues.length + environmentIssues.length
  const hasTrigger = nodes.some((node) => node.type === 'trigger')

  // Variables the inspector can offer: built-ins, variables set in this flow and form answers
  const variables = useMemo(() => {
    const list = ['contact.name', 'contact.phone', 'org.name', 'last_choice_title', 'last_input']
    for (const node of nodes) {
      const data: Record<string, any> = node.data || {}
      if (node.type === 'set_variable' && (data.variableName || data.variable_name)) list.push(String(data.variableName || data.variable_name))
      if (node.type === 'native_flow_trigger') {
        const form = nativeForms.find((item) => item.id === (data.flowId || data.native_flow_id || data.flow_id))
        for (const field of getFormFields(form)) list.push(`form.${field.name}`)
      }
    }
    return [...new Set(list)]
  }, [nodes, nativeForms])

  const markDirty = () => setDirty(true)

  // ── Save ───────────────────────────────────────────────────────────────────
  const saveWorkflow = async (overrides: { is_active?: boolean } = {}): Promise<boolean> => {
    if (!workflowId || saving) return false
    setSaving(true)
    setSaveError('')
    const nextActive = overrides.is_active ?? isActive
    try {
      const res = await fetch(`/api/flows/workflows/${workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: flowName.trim() || 'Untitled flow',
          is_active: nextActive,
          canvas_nodes: nodes,
          canvas_edges: edges,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (Array.isArray(data.environmentErrors)) setEnvironmentIssues(data.environmentErrors)
        throw new Error(
          res.status === 422
            ? nextActive && isActive
              ? 'This flow is live, so it can only be saved when it has no problems. Fix them, or pause the flow first.'
              : 'This flow has problems that must be fixed before it can go live.'
            : data.error || 'Unable to save the flow'
        )
      }
      setEnvironmentIssues(data.environmentErrors || [])
      setIsActive(Boolean(data.workflow?.is_active))
      if (!flowName.trim()) setFlowName('Untitled flow')
      setDirty(false)
      setLastSaved(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      return true
    } catch (err: any) {
      setSaveError(err.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async () => {
    if (isActive) {
      await saveWorkflow({ is_active: false })
      return
    }
    const wentLive = await saveWorkflow({ is_active: true })
    if (!wentLive) {
      // The server refuses to activate a flow with problems and saves nothing in that case.
      // Keep the work: store it as a paused draft, then show what has to be fixed.
      await saveWorkflow({ is_active: false })
      setSaveError('This flow has problems that must be fixed before it can go live.')
      setPanel('issues')
    }
  }

  // Latest save function for the keyboard shortcut (the listener is registered once)
  const saveRef = useRef(saveWorkflow)
  saveRef.current = saveWorkflow

  // Warn before leaving with unsaved work
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // ── Viewport helpers ───────────────────────────────────────────────────────
  const fitToView = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const all = nodesRef.current
    if (!rect || all.length === 0) {
      applyView(1, { x: 0, y: 0 })
      return
    }
    const minX = Math.min(...all.map((node) => node.position.x))
    const maxX = Math.max(...all.map((node) => node.position.x + NODE_WIDTH))
    const minY = Math.min(...all.map((node) => node.position.y))
    const maxY = Math.max(...all.map((node) => node.position.y + estimateNodeHeight(node)))
    const padding = 60
    const scale = Math.min(
      (rect.width - padding * 2) / Math.max(100, maxX - minX),
      (rect.height - padding * 2) / Math.max(100, maxY - minY)
    )
    const nextZoom = Math.min(1, Math.max(MIN_ZOOM, scale))
    applyView(nextZoom, {
      x: rect.width / 2 - ((minX + maxX) / 2) * nextZoom,
      y: rect.height / 2 - ((minY + maxY) / 2) * nextZoom,
    })
  }, [applyView])

  // Frame the whole flow once it has loaded
  useEffect(() => {
    if (loadState !== 'ready') return
    const frame = requestAnimationFrame(fitToView)
    return () => cancelAnimationFrame(frame)
  }, [loadState, fitToView])

  const zoomBy = useCallback((delta: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const current = zoomRef.current
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + delta))
    if (!rect) return applyView(next, panRef.current)
    const cx = rect.width / 2
    const cy = rect.height / 2
    applyView(next, { x: cx - (cx - panRef.current.x) * (next / current), y: cy - (cy - panRef.current.y) * (next / current) })
  }, [applyView])

  const centerOnNode = (nodeId: string) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const node = nodesRef.current.find((item) => item.id === nodeId)
    if (!rect || !node) return
    applyView(zoomRef.current, {
      x: rect.width / 2 - (node.position.x + NODE_WIDTH / 2) * zoomRef.current,
      y: rect.height / 2 - (node.position.y + estimateNodeHeight(node) / 2) * zoomRef.current,
    })
  }

  // Wheel: scroll pans, Ctrl/Cmd + wheel (and trackpad pinch) zooms around the pointer
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || loadState !== 'ready') return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) {
        const current = zoomRef.current
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * Math.exp(-event.deltaY * 0.003)))
        const mx = event.clientX - rect.left
        const my = event.clientY - rect.top
        applyView(next, { x: mx - (mx - panRef.current.x) * (next / current), y: my - (my - panRef.current.y) * (next / current) })
      } else {
        applyView(zoomRef.current, {
          x: panRef.current.x - (event.shiftKey ? event.deltaY : event.deltaX),
          y: panRef.current.y - (event.shiftKey ? 0 : event.deltaY),
        })
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [loadState, applyView])

  // ── Editing ────────────────────────────────────────────────────────────────
  const toCanvasPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (clientY - rect.top - panRef.current.y) / zoomRef.current,
    }
  }

  const addNode = (type: NodeType, position?: { x: number; y: number }) => {
    if (type === 'trigger' && nodesRef.current.some((node) => node.type === 'trigger')) return
    const definition = getNodeDefinition(type)
    const rect = canvasRef.current?.getBoundingClientRect()
    // Without a drop position, place it in the middle of the view, stepping each new block
    // down a little so several clicks do not stack blocks exactly on top of each other
    const cascade = (nodesRef.current.length % 6) * 28
    const centre = rect ? toCanvasPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : { x: 400, y: 300 }
    const id = `node-${type}-${uid()}`
    const published = nativeForms.find((form) => form.status === 'PUBLISHED' && form.flow_id_meta)
    const node: WorkflowNode = {
      id,
      type,
      position: position || { x: Math.round(centre.x - NODE_WIDTH / 2 + cascade), y: Math.round(centre.y - 60 + cascade) },
      data: definition.createData({ publishedFormId: published?.id }),
    }
    setNodes((prev) => [...prev, node])
    setSelectedNodeId(id)
    setPanel('inspector')
    markDirty()
  }

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((prev) => prev.filter((node) => node.id !== nodeId))
    setEdges((prev) => prev.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    setSelectedNodeId((current) => (current === nodeId ? null : current))
    setPanel((current) => (current === 'inspector' ? null : current))
    setDirty(true)
  }, [])

  const updateNodeData = (nodeId: string, updates: Record<string, any>) => {
    setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, ...updates } } : node)))
    markDirty()
  }

  /** Remove the connection leaving one output (used when a button or menu row is deleted). */
  const removeOutputEdge = (nodeId: string, handleId: string) => {
    setEdges((prev) => prev.filter((edge) => !(edge.source === nodeId && edge.sourceHandle === handleId)))
    markDirty()
  }

  const deleteEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((edge) => edge.id !== edgeId))
    markDirty()
  }

  const startConnection = (nodeId: string, handleId?: string) => {
    const same = connectingFrom?.nodeId === nodeId && (connectingFrom.handleId || '') === (handleId || '')
    setConnectingFrom(same ? null : { nodeId, handleId })
  }

  const completeConnection = (targetId: string) => {
    const from = connectingRef.current
    const target = nodesRef.current.find((node) => node.id === targetId)
    if (!from || !target || from.nodeId === targetId || target.type === 'trigger') return
    const edge: WorkflowEdge = {
      id: `edge-${uid()}`,
      source: from.nodeId,
      target: targetId,
      ...(from.handleId ? { sourceHandle: from.handleId } : {}),
    }
    // Each output leads to exactly one next step: a new connection replaces the old one
    setEdges((prev) => [...prev.filter((item) => !(item.source === from.nodeId && (item.sourceHandle || '') === (from.handleId || ''))), edge])
    setConnectingFrom(null)
    markDirty()
  }

  const handleNodeMouseDown = (event: React.MouseEvent, nodeId: string) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button')) return // ports and card buttons handle their own clicks
    event.stopPropagation()
    event.preventDefault()

    if (connectingRef.current) {
      completeConnection(nodeId)
      return
    }

    const node = nodesRef.current.find((item) => item.id === nodeId)
    if (!node) return
    const point = toCanvasPoint(event.clientX, event.clientY)
    dragRef.current = { nodeId, offsetX: point.x - node.position.x, offsetY: point.y - node.position.y }
    setIsDragging(true)
    setSelectedNodeId(nodeId)
    setPanel('inspector')
  }

  const handleCanvasMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0 && event.button !== 1) return
    const target = event.target as HTMLElement
    if (target.closest('.canvas-node-card') || target.closest('.canvas-control-toolbar') || target.closest('.canvas-edge')) return
    panStartRef.current = { x: event.clientX - panRef.current.x, y: event.clientY - panRef.current.y }
    setIsPanning(true)
    setSelectedNodeId(null)
    setConnectingFrom(null)
    setPanel((current) => (current === 'inspector' ? null : current))
  }

  // Window-level listeners keep a drag alive when the pointer leaves the canvas
  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      if (dragRef.current) {
        const { nodeId, offsetX, offsetY } = dragRef.current
        const x = Math.round((event.clientX - rect.left - panRef.current.x) / zoomRef.current - offsetX)
        const y = Math.round((event.clientY - rect.top - panRef.current.y) / zoomRef.current - offsetY)
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, position: { x, y } } : node)))
        setDirty(true)
        return
      }
      if (panStartRef.current) {
        const next = { x: Math.round(event.clientX - panStartRef.current.x), y: Math.round(event.clientY - panStartRef.current.y) }
        panRef.current = next
        setPan(next)
        return
      }
      if (connectingRef.current) {
        setPointer({
          x: Math.round((event.clientX - rect.left - panRef.current.x) / zoomRef.current),
          y: Math.round((event.clientY - rect.top - panRef.current.y) / zoomRef.current),
        })
      }
    }
    const onMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null
        setIsDragging(false)
      }
      if (panStartRef.current) {
        panStartRef.current = null
        setIsPanning(false)
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Keyboard: Ctrl/Cmd+S saves, Delete removes the selected block, Esc cancels, +/- zoom
  const selectedRef = useRef(selectedNodeId)
  selectedRef.current = selectedNodeId
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
      const command = event.metaKey || event.ctrlKey

      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveRef.current()
        return
      }
      if (typing) return

      if (command && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        zoomBy(0.1)
      } else if (command && event.key === '-') {
        event.preventDefault()
        zoomBy(-0.1)
      } else if (command && event.key === '0') {
        event.preventDefault()
        fitToView()
      } else if (event.key === 'Escape') {
        setConnectingFrom(null)
        setSelectedNodeId(null)
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRef.current) {
        event.preventDefault()
        deleteNode(selectedRef.current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [zoomBy, fitToView, deleteNode])

  // ── Simulator ──────────────────────────────────────────────────────────────
  const runSimulatorStep = async (payload: Record<string, any>) => {
    setSimulatorBusy(true)
    try {
      const res = await fetch('/api/flows/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges, ...payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The test could not run')
      setSimulationCompleted(Boolean(data.isCompleted))
      setSimulatedNodeId(data.isCompleted ? null : data.currentNodeId)
      setSimulatedState(data.simulatedState || {})
      const actions: string[] = data.simulatedState?.simulated_actions || []
      const earlier: string[] = payload.simulatedState?.simulated_actions || []
      setSimulatorMessages((prev) => [
        ...prev,
        // Show CRM actions that just ran, since they produce no chat message of their own
        ...actions.slice(earlier.length).map((text) => ({ sender: 'system' as const, text })),
        { sender: 'bot' as const, text: data.reply, buttons: data.buttons, isNativeFlow: data.isNativeFlow, ctaText: data.ctaText },
      ])
    } catch (err: any) {
      setSimulatorMessages((prev) => [...prev, { sender: 'system', text: err.message }])
    } finally {
      setSimulatorBusy(false)
    }
  }

  const startSimulator = () => {
    setPanel('simulator')
    setSimulationCompleted(false)
    setSimulatorMessages([])
    setSimulatedNodeId(null)
    setSimulatedState({})
    setSimulatorInput('')
    if (graphIssues.length === 0) runSimulatorStep({})
  }

  const sendSimulatorMessage = (text: string, buttonId?: string, flowSubmissionData?: Record<string, any>) => {
    if (simulationCompleted || simulatorBusy) return
    setSimulatorMessages((prev) => [...prev, { sender: 'user', text }])
    setSimulatorInput('')
    runSimulatorStep({ currentNodeId: simulatedNodeId, userInput: buttonId ? '' : text, buttonId, simulatedState, flowSubmissionData })
  }

  const submitSimulatedForm = () => {
    const node = nodes.find((item) => item.id === simulatedNodeId)
    const data: Record<string, any> = node?.data || {}
    const form = nativeForms.find((item) => item.id === (data.flowId || data.native_flow_id || data.flow_id))
    sendSimulatorMessage('Submitted the form', undefined, buildSampleAnswers(form))
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-[#0c1317]">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
          Loading the flow…
        </div>
      </div>
    )
  }

  if (loadState === 'missing') {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-[#0c1317] p-6">
        <div className="text-center space-y-3">
          <Workflow className="w-10 h-10 mx-auto text-slate-400" />
          <h1 className="text-base font-bold text-slate-900 dark:text-white">This flow could not be opened</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">It may have been deleted, or you may not have access to it.</p>
          <Link href="/dashboard/flows" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#008069] hover:bg-[#006d59] text-white text-xs font-bold">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to flows
          </Link>
        </div>
      </div>
    )
  }

  const selectedNode = nodes.find((node) => node.id === selectedNodeId)
  const failedSessions = recentSessions.filter((session) => session.status === 'FAILED')
  const formName = (id: string) => nativeForms.find((form) => form.id === id)?.name
  const stageName = (id: string) => pipelineStages.find((stage) => stage.id === id)?.name
  const connectedOutputs = new Set(edges.map((edge) => `${edge.source}::${edge.sourceHandle || ''}`))

  return (
    <>
      {/* The canvas needs a pointer and room to work */}
      <div className="md:hidden flex-1 flex items-center justify-center p-6 bg-slate-50 dark:bg-[#0c1317]">
        <div className="text-center space-y-3 max-w-xs">
          <Workflow className="w-10 h-10 mx-auto text-slate-400" />
          <h1 className="text-base font-bold text-slate-900 dark:text-white">Open this on a larger screen</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">The flow builder uses a drag-and-drop canvas that needs a tablet or computer.</p>
          <Link href="/dashboard/flows" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#008069] text-white text-xs font-bold">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to flows
          </Link>
        </div>
      </div>

      <div className="hidden md:flex flex-col h-full bg-slate-50 dark:bg-[#0a0f12] text-slate-900 dark:text-slate-100 overflow-hidden">
        {/* ── Header ── */}
        <header className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#11181c] px-3 flex items-center justify-between gap-3 z-20">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href="/dashboard/flows"
              aria-label="Back to flows"
              className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <input
              type="text"
              value={flowName}
              maxLength={120}
              aria-label="Flow name"
              placeholder="Untitled flow"
              onChange={(event) => {
                setFlowName(event.target.value)
                markDirty()
              }}
              className="min-w-0 w-64 bg-transparent font-bold text-sm text-slate-900 dark:text-white px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <span
              className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-bold ${
                isActive ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              {isActive ? 'Live' : 'Paused'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden lg:inline text-[11px] text-slate-400" aria-live="polite">
              {saving ? 'Saving…' : dirty ? 'Unsaved changes' : lastSaved ? `Saved ${lastSaved}` : ''}
            </span>

            <button
              type="button"
              onClick={() => setPanel(panel === 'issues' ? null : 'issues')}
              aria-pressed={panel === 'issues'}
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                issueCount
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-950/60'
                  : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/50'
              }`}
            >
              {issueCount ? <AlertCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {issueCount ? `${issueCount} to fix` : 'Ready'}
            </button>

            <button
              type="button"
              onClick={startSimulator}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
            >
              <Smartphone className="w-3.5 h-3.5" />
              Test
            </button>

            <button
              type="button"
              onClick={() => saveWorkflow()}
              disabled={saving || !dirty}
              title="Save (Ctrl/Cmd + S)"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold disabled:opacity-50 cursor-pointer disabled:cursor-default"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>

            <button
              type="button"
              onClick={toggleActive}
              disabled={saving || (!isActive && graphIssues.length > 0)}
              title={!isActive && graphIssues.length > 0 ? 'Fix the problems listed under “to fix” before going live' : undefined}
              className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-bold shadow-sm disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${
                isActive ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-[#008069] hover:bg-[#006d59] text-white'
              }`}
            >
              {isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isActive ? 'Pause' : 'Go live'}
            </button>
          </div>
        </header>

        {saveError && (
          <div role="alert" className="shrink-0 px-4 py-2 text-xs font-medium bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-200 border-b border-rose-200 dark:border-rose-900/60 flex items-center justify-between gap-3">
            <span>{saveError}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setSaveError('')} className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/50 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {failedSessions.length > 0 && (
          <details className="shrink-0 px-4 py-2 text-xs bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-b border-rose-200 dark:border-rose-900/60">
            <summary className="cursor-pointer font-semibold">
              {failedSessions.length} recent run{failedSessions.length === 1 ? '' : 's'} failed
            </summary>
            <ul className="mt-1.5 space-y-1">
              {failedSessions.map((session) => {
                const failedNode = nodes.find((node) => node.id === session.current_node_id)
                return (
                  <li key={session.id}>
                    {new Date(session.last_interaction_at).toLocaleString()} · {session.state_data?._last_error || 'Execution failed'}
                    {failedNode && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedNodeId(failedNode.id)
                          setPanel('inspector')
                          centerOnNode(failedNode.id)
                        }}
                        className="ml-1.5 underline font-semibold cursor-pointer"
                      >
                        at “{failedNode.data?.title || getNodeDefinition(failedNode.type).label}”
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </details>
        )}

        <div className="flex-1 flex min-h-0 relative">
          {/* ── Palette ── */}
          <aside className="w-60 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#11181c] flex flex-col z-10">
            <div className="px-3 pt-3 pb-2">
              <h2 className="text-xs font-bold text-slate-900 dark:text-white">Blocks</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Click to add, or drag onto the canvas.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-3">
              {PALETTE.map(({ group, items }) => (
                <div key={group}>
                  <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</h3>
                  <div className="space-y-1">
                    {items.map((definition) => {
                      const Icon = definition.icon
                      const unavailable = definition.type === 'trigger' && hasTrigger
                      return (
                        <button
                          key={definition.type}
                          type="button"
                          draggable={!unavailable}
                          disabled={unavailable}
                          title={unavailable ? 'A flow has exactly one trigger' : undefined}
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/plain', definition.type)
                            event.dataTransfer.effectAllowed = 'copy'
                          }}
                          onClick={() => addNode(definition.type)}
                          className="w-full text-left p-2 rounded-lg border border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center gap-2.5 transition-colors cursor-grab active:cursor-grabbing disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-transparent"
                        >
                          <span className={`h-8 w-8 shrink-0 rounded-lg flex items-center justify-center ${TONE_CLASSES[definition.tone].chip}`}>
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{definition.label}</span>
                            <span className="block text-[11px] leading-tight text-slate-500 dark:text-slate-400 truncate">
                              {unavailable ? 'Already added' : definition.description}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* ── Canvas ── */}
          <div
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(event) => {
              event.preventDefault()
              const type = event.dataTransfer.getData('text/plain') as NodeType
              if (!type || !getNodeDefinition(type).supported) return
              const point = toCanvasPoint(event.clientX, event.clientY)
              addNode(type, { x: Math.round(point.x - NODE_WIDTH / 2), y: Math.round(point.y - HEADER_HEIGHT / 2) })
            }}
            className={`flex-1 min-w-0 h-full relative overflow-hidden select-none bg-slate-100 dark:bg-[#0c1216] ${
              isPanning ? 'cursor-grabbing' : connectingFrom ? 'cursor-crosshair' : 'cursor-grab'
            }`}
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(100, 116, 139, 0.28) 1px, transparent 1px)',
              backgroundSize: `${Math.round(24 * zoom)}px ${Math.round(24 * zoom)}px`,
              backgroundPosition: `${pan.x}px ${pan.y}px`,
            }}
          >
            {connectingFrom && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pl-3 pr-1.5 py-1 rounded-full bg-slate-900 text-white text-xs font-medium shadow-lg flex items-center gap-2">
                Click the block this should lead to
                <button type="button" onClick={() => setConnectingFrom(null)} className="px-2 py-0.5 rounded-full bg-white/15 hover:bg-white/25 text-[11px] cursor-pointer">
                  Cancel (Esc)
                </button>
              </div>
            )}

            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center max-w-xs">
                  <Workflow className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600" />
                  <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Start with a Trigger</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Add a Trigger from the left, then connect the steps that should follow it.</p>
                </div>
              </div>
            )}

            {/* Zoom controls */}
            <div
              onMouseDown={(event) => event.stopPropagation()}
              className="canvas-control-toolbar absolute bottom-3 left-3 z-30 flex items-center gap-0.5 bg-white dark:bg-[#11181c] p-1 rounded-lg border border-slate-200 dark:border-slate-800 shadow-md cursor-default"
            >
              <button type="button" onClick={() => zoomBy(-0.1)} aria-label="Zoom out" title="Zoom out" className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-[11px] tabular-nums w-10 text-center font-semibold text-slate-600 dark:text-slate-300">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => zoomBy(0.1)} aria-label="Zoom in" title="Zoom in" className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <ZoomIn className="w-4 h-4" />
              </button>
              <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
              <button type="button" onClick={fitToView} aria-label="Fit the flow in view" title="Fit the flow in view" className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <Maximize2 className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => applyView(1, panRef.current)} aria-label="Zoom to 100%" title="Zoom to 100%" className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            {/* Everything below moves and scales with the viewport */}
            <div className="pointer-events-none absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
              <svg className="overflow-visible absolute top-0 left-0 w-px h-px pointer-events-none" style={{ zIndex: 1 }}>
                <defs>
                  <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                  </marker>
                  <marker id="flow-arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                  </marker>
                </defs>

                {edges.map((edge) => {
                  const source = nodes.find((node) => node.id === edge.source)
                  const target = nodes.find((node) => node.id === edge.target)
                  if (!source || !target) return null
                  const out = getOutputAnchor(source, edge.sourceHandle)
                  const sx = source.position.x + out.x
                  const sy = source.position.y + out.y
                  const ex = target.position.x + INPUT_ANCHOR.x
                  const ey = target.position.y + INPUT_ANCHOR.y
                  const path = edgePath(sx, sy, ex, ey)
                  const active = selectedNodeId === edge.source || selectedNodeId === edge.target || simulatedNodeId === edge.target
                  return (
                    <g key={edge.id} className="canvas-edge group pointer-events-auto cursor-pointer">
                      {/* Wide invisible stroke so the connection is easy to hover */}
                      <path d={path} fill="none" stroke="transparent" strokeWidth={18} />
                      <path
                        d={path}
                        fill="none"
                        strokeWidth={2}
                        stroke={active ? '#10b981' : '#94a3b8'}
                        markerEnd={active ? 'url(#flow-arrow-active)' : 'url(#flow-arrow)'}
                        className="group-hover:stroke-rose-500"
                      />
                      <g
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          deleteEdge(edge.id)
                        }}
                      >
                        <title>Remove this connection</title>
                        <circle cx={(sx + ex) / 2} cy={(sy + ey) / 2} r={9} fill="#e11d48" />
                        <path
                          d={`M ${(sx + ex) / 2 - 3} ${(sy + ey) / 2 - 3} l 6 6 m 0 -6 l -6 6`}
                          stroke="#fff"
                          strokeWidth={1.8}
                          strokeLinecap="round"
                        />
                      </g>
                    </g>
                  )
                })}

                {/* The connection being drawn follows the pointer */}
                {connectingFrom && pointer && (() => {
                  const source = nodes.find((node) => node.id === connectingFrom.nodeId)
                  if (!source) return null
                  const out = getOutputAnchor(source, connectingFrom.handleId)
                  return (
                    <path
                      d={edgePath(source.position.x + out.x, source.position.y + out.y, pointer.x, pointer.y)}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                    />
                  )
                })()}
              </svg>

              {nodes.map((node) => {
                const definition = getNodeDefinition(node.type)
                const Icon = definition.icon
                const tone = TONE_CLASSES[definition.tone]
                const outputs = getNodeOutputs(node)
                const nodeIssues = issuesByNode.get(node.id) || []
                const isSelected = selectedNodeId === node.id
                const isSimulated = simulatedNodeId === node.id
                const canReceive = Boolean(connectingFrom) && connectingFrom?.nodeId !== node.id && node.type !== 'trigger'
                const isConnectingSource = (handleId?: string) =>
                  connectingFrom?.nodeId === node.id && (connectingFrom.handleId || '') === (handleId || '')

                return (
                  <div
                    key={node.id}
                    onMouseDown={(event) => handleNodeMouseDown(event, node.id)}
                    onDragStart={(event) => event.preventDefault()}
                    style={{ position: 'absolute', left: node.position.x, top: node.position.y, width: NODE_WIDTH, zIndex: isSelected ? 10 : 2 }}
                    className={`canvas-node-card pointer-events-auto rounded-xl bg-white dark:bg-[#161f26] border shadow-sm transition-shadow ${
                      isDragging && isSelected ? 'cursor-grabbing shadow-xl' : canReceive ? 'cursor-pointer' : 'cursor-grab'
                    } ${
                      isSelected
                        ? 'border-emerald-500 ring-2 ring-emerald-500/30 shadow-lg'
                        : isSimulated
                        ? 'border-emerald-500 ring-4 ring-emerald-400/30'
                        : canReceive
                        ? 'border-emerald-400 border-dashed hover:ring-2 hover:ring-emerald-400/40'
                        : nodeIssues.length
                        ? 'border-amber-400 dark:border-amber-500/70'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div style={{ height: HEADER_HEIGHT }} className={`px-3 flex items-center gap-2 rounded-t-[11px] border-b ${tone.header}`}>
                      <span className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center ${tone.chip}`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide leading-none text-slate-500 dark:text-slate-400">{definition.label}</p>
                        <p className="mt-0.5 text-[13px] font-semibold leading-tight truncate text-slate-900 dark:text-white">{node.data?.title || definition.label}</p>
                      </div>
                      {nodeIssues.length > 0 && (
                        <span title={nodeIssues.join('\n')} className="shrink-0 text-amber-500">
                          <AlertCircle className="w-4 h-4" />
                          <span className="sr-only">
                            {nodeIssues.length} problem{nodeIssues.length === 1 ? '' : 's'}
                          </span>
                        </span>
                      )}
                    </div>

                    <div style={{ padding: BODY_PADDING }}>
                      {outputs ? (
                        <>
                          <p style={{ height: PREVIEW_HEIGHT, marginBottom: PREVIEW_GAP }} className="text-xs leading-5 truncate text-slate-600 dark:text-slate-400">
                            {getNodeSummary(node)}
                          </p>
                          {outputs.map((output) => {
                            const connected = connectedOutputs.has(`${node.id}::${output.id}`)
                            return (
                              <div
                                key={output.id}
                                style={{ height: ROW_HEIGHT, marginBottom: ROW_GAP }}
                                className="relative flex items-center px-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 text-xs font-medium text-slate-700 dark:text-slate-200"
                              >
                                <span className="truncate">{output.label}</span>
                                <button
                                  type="button"
                                  aria-label={`Connect “${output.label}” to the next step`}
                                  title={connected ? 'Connected. Click to choose a different next step' : 'Click, then click the next step'}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    startConnection(node.id, output.id)
                                  }}
                                  style={{ width: PORT_SIZE, height: PORT_SIZE, right: -(BODY_PADDING + PORT_SIZE / 2 + 1) }}
                                  className={`absolute top-1/2 -translate-y-1/2 rounded-full border-2 border-white dark:border-[#161f26] cursor-crosshair transition-transform hover:scale-125 ${
                                    isConnectingSource(output.id) ? 'bg-emerald-500 ring-4 ring-emerald-500/30' : connected ? tone.port : 'bg-slate-300 dark:bg-slate-600'
                                  }`}
                                />
                              </div>
                            )
                          })}
                        </>
                      ) : (
                        <p className="text-xs leading-relaxed line-clamp-3 break-words text-slate-600 dark:text-slate-400">
                          {getNodeSummary(node, { formName, stageName })}
                        </p>
                      )}
                    </div>

                    {/* Input: connections arrive at the header */}
                    {node.type !== 'trigger' && (
                      <span
                        aria-hidden="true"
                        style={{ width: PORT_SIZE, height: PORT_SIZE, left: -(PORT_SIZE / 2 + 1), top: HEADER_HEIGHT / 2 - PORT_SIZE / 2 }}
                        className={`absolute rounded-full border-2 border-white dark:border-[#161f26] ${canReceive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                      />
                    )}

                    {/* Single "next step" output */}
                    {!outputs && !definition.terminal && (
                      <button
                        type="button"
                        aria-label="Connect to the next step"
                        title={connectedOutputs.has(`${node.id}::`) ? 'Connected. Click to choose a different next step' : 'Click, then click the next step'}
                        onClick={(event) => {
                          event.stopPropagation()
                          startConnection(node.id)
                        }}
                        style={{ width: PORT_SIZE, height: PORT_SIZE, right: -(PORT_SIZE / 2 + 1), top: HEADER_HEIGHT / 2 - PORT_SIZE / 2 }}
                        className={`absolute rounded-full border-2 border-white dark:border-[#161f26] cursor-crosshair transition-transform hover:scale-125 ${
                          isConnectingSource() ? 'bg-emerald-500 ring-4 ring-emerald-500/30' : connectedOutputs.has(`${node.id}::`) ? tone.port : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Right panel: one of block settings, problems list, or the test chat ── */}
          {panel === 'inspector' && selectedNode && (
            <NodeInspector
              key={selectedNode.id}
              node={selectedNode}
              issues={issuesByNode.get(selectedNode.id) || []}
              nativeForms={nativeForms}
              pipelineStages={pipelineStages}
              variables={variables}
              onChange={(updates) => updateNodeData(selectedNode.id, updates)}
              onRemoveOutput={(handleId) => removeOutputEdge(selectedNode.id, handleId)}
              onDelete={() => deleteNode(selectedNode.id)}
              onClose={() => {
                setSelectedNodeId(null)
                setPanel(null)
              }}
            />
          )}

          {panel === 'issues' && (
            <aside className="w-[340px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#11181c] flex flex-col z-10">
              <div className="px-4 h-12 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#11181c]">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">{issueCount ? 'Fix before going live' : 'Ready to go live'}</h3>
                <button type="button" aria-label="Close" onClick={() => setPanel(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {issueCount === 0 && (
                  <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-xs leading-relaxed text-emerald-800 dark:text-emerald-200">
                    <CheckCircle2 className="w-5 h-5 mb-1.5" />
                    No problems found. Use <strong>Test</strong> to try the conversation, then <strong>Go live</strong>.
                  </div>
                )}
                {graphIssues.map((issue) => {
                  const node = issue.nodeId ? nodes.find((item) => item.id === issue.nodeId) : undefined
                  return (
                    <button
                      key={issue.text}
                      type="button"
                      disabled={!node}
                      onClick={() => {
                        if (!node) return
                        setSelectedNodeId(node.id)
                        setPanel('inspector')
                        centerOnNode(node.id)
                      }}
                      className="w-full text-left p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-amber-400 disabled:hover:border-slate-200 dark:disabled:hover:border-slate-700 cursor-pointer disabled:cursor-default"
                    >
                      <span className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                        <span className="min-w-0">
                          {node && <span className="block text-xs font-bold text-slate-900 dark:text-white truncate">{node.data?.title || getNodeDefinition(node.type).label}</span>}
                          <span className="block text-xs leading-relaxed text-slate-600 dark:text-slate-300 first-letter:uppercase">{issue.message}</span>
                        </span>
                      </span>
                    </button>
                  )
                })}
                {environmentIssues.length > 0 && (
                  <>
                    <h4 className="pt-2 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Found when last saved</h4>
                    {environmentIssues.map((issue) => (
                      <div key={issue} className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                        <span className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{issue}</span>
                      </div>
                    ))}
                    <p className="px-1 text-[11px] text-slate-500 dark:text-slate-400">These are checked on the server. Save again after fixing them.</p>
                  </>
                )}
              </div>
            </aside>
          )}

          {panel === 'simulator' && (
            <FlowSimulator
              messages={simulatorMessages}
              busy={simulatorBusy}
              completed={simulationCompleted}
              blockedReason={
                graphIssues.length > 0
                  ? `This flow has ${graphIssues.length} problem${graphIssues.length === 1 ? '' : 's'}. Fix ${graphIssues.length === 1 ? 'it' : 'them'} (see “to fix” at the top), then run the test again.`
                  : undefined
              }
              input={simulatorInput}
              onInputChange={setSimulatorInput}
              onSend={(text, buttonId) => sendSimulatorMessage(text, buttonId)}
              onSubmitForm={submitSimulatedForm}
              onRestart={startSimulator}
              onClose={() => {
                setPanel(selectedNodeId ? 'inspector' : null)
                setSimulatedNodeId(null)
              }}
            />
          )}
        </div>
      </div>
    </>
  )
}
