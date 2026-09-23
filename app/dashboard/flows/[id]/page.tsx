'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Workflow,
  ArrowLeft,
  Save,
  Play,
  Pause,
  Plus,
  Trash2,
  Sparkles,
  Smartphone,
  MessageSquare,
  ListPlus,
  HelpCircle,
  Briefcase,
  Ticket,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronRight,
  X,
  Check,
  Send,
  AlertCircle,
  Split,
  Bot,
  User,
  Settings2,
  CornerDownRight,
  FileText,
  Clock,
  ExternalLink,
} from 'lucide-react'
import { WorkflowNode, WorkflowEdge, NodeType, isFlowBetaAllowed } from '@/lib/flows/flow-types'

export default function FlowCanvasBuilderPage() {
  const params = useParams()
  const router = useRouter()
  const workflowId = params?.id as string

  // Flow State
  const [workflow, setWorkflow] = useState<any>(null)
  const [nodes, setNodes] = useState<WorkflowNode[]>([])
  const [edges, setEdges] = useState<WorkflowEdge[]>([])
  const [flowName, setFlowName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Selection & UI State
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; handleId?: string } | null>(null)
  const [showSimulator, setShowSimulator] = useState(false)
  const [availableNativeForms, setAvailableNativeForms] = useState<any[]>([])

  // Canvas Viewport (Pan & Zoom)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  // Node Dragging State
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [nodeDragOffset, setNodeDragOffset] = useState({ x: 0, y: 0 })

  // Spacebar pan & connection preview state
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const isSpacePressedRef = useRef(false)
  const [canvasMousePos, setCanvasMousePos] = useState<{ x: number; y: number } | null>(null)

  // Synchronized refs for high-performance window-level event tracking
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  const nodesRef = useRef(nodes)
  const draggingNodeIdRef = useRef<string | null>(null)
  const nodeDragOffsetRef = useRef({ x: 0, y: 0 })
  const isPanningRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  useEffect(() => { panRef.current = pan }, [pan])
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { nodesRef.current = nodes }, [nodes])

  // Simulator State
  const [simulatorMessages, setSimulatorMessages] = useState<Array<{ sender: 'user' | 'bot'; text: string; buttons?: any[]; isNativeFlow?: boolean; ctaText?: string }>>([])
  const [simulatedCurrentNodeId, setSimulatedCurrentNodeId] = useState<string | null>(null)
  const [simulatedState, setSimulatedState] = useState<Record<string, any>>({})
  const [simulatorInput, setSimulatorInput] = useState('')
  const [simulatingStep, setSimulatingStep] = useState(false)

  // Fetch Workflow & Native Forms
  useEffect(() => {
    async function loadFlow() {
      if (!workflowId) return
      setLoading(true)
      try {
        const res = await fetch(`/api/flows/workflows/${workflowId}`)
        if (res.ok) {
          const data = await res.json()
          const wf = data.workflow

          if (!isFlowBetaAllowed(wf.organization_id)) {
            router.replace('/dashboard')
            return
          }

          setWorkflow(wf)
          setFlowName(wf.name)
          setIsActive(wf.is_active)
          setNodes(wf.canvas_nodes || [])
          setEdges(wf.canvas_edges || [])
          if (wf.canvas_nodes?.length > 0) {
            setSelectedNodeId(wf.canvas_nodes[0].id)
          }

          // Fetch native forms for the org
          if (wf.organization_id) {
            const formsRes = await fetch(`/api/flows/native?organizationId=${wf.organization_id}`)
            if (formsRes.ok) {
              const formsData = await formsRes.json()
              setAvailableNativeForms(formsData.flows || [])
            }
          }
        }
      } catch (err) {
        console.error('Failed to load workflow:', err)
      } finally {
        setLoading(false)
      }
    }
    loadFlow()
  }, [workflowId])

  // Save changes
  const saveWorkflow = async () => {
    if (!workflowId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/flows/workflows/${workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: flowName,
          is_active: isActive,
          canvas_nodes: nodes,
          canvas_edges: edges,
        }),
      })

      if (res.ok) {
        setHasUnsavedChanges(false)
        setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      }
    } catch (err) {
      console.error('Failed to save workflow:', err)
    } finally {
      setSaving(false)
    }
  }

  // Fit view function to auto-center all nodes nicely
  const fitToView = useCallback(() => {
    if (nodesRef.current.length === 0) {
      zoomRef.current = 1
      panRef.current = { x: 0, y: 0 }
      setZoom(1)
      setPan({ x: 0, y: 0 })
      return
    }

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const minX = Math.min(...nodesRef.current.map((n) => n.position.x))
    const maxX = Math.max(...nodesRef.current.map((n) => n.position.x + 300))
    const minY = Math.min(...nodesRef.current.map((n) => n.position.y))
    const maxY = Math.max(...nodesRef.current.map((n) => n.position.y + 220))

    const graphWidth = Math.max(100, maxX - minX)
    const graphHeight = Math.max(100, maxY - minY)

    const padding = 100
    const availableWidth = Math.max(200, rect.width - padding * 2)
    const availableHeight = Math.max(200, rect.height - padding * 2)

    const scaleX = availableWidth / graphWidth
    const scaleY = availableHeight / graphHeight
    const targetZoom = Math.min(1.2, Math.max(0.35, Math.min(scaleX, scaleY)))

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    const targetPanX = rect.width / 2 - centerX * targetZoom
    const targetPanY = rect.height / 2 - centerY * targetZoom

    const finalZoom = Math.round(targetZoom * 100) / 100
    const finalPan = { x: Math.round(targetPanX), y: Math.round(targetPanY) }

    zoomRef.current = finalZoom
    panRef.current = finalPan

    setZoom(finalZoom)
    setPan(finalPan)
  }, [])

  // Zoom centered on canvas viewport
  const handleZoomStep = (delta: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const currentZoom = zoomRef.current
    const newZoom = Math.min(2.5, Math.max(0.2, Math.round((currentZoom + delta) * 100) / 100))

    if (rect) {
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const newPanX = centerX - (centerX - panRef.current.x) * (newZoom / currentZoom)
      const newPanY = centerY - (centerY - panRef.current.y) * (newZoom / currentZoom)
      const finalPan = { x: Math.round(newPanX), y: Math.round(newPanY) }
      panRef.current = finalPan
      setPan(finalPan)
    }
    zoomRef.current = newZoom
    setZoom(newZoom)
  }

  // Imperative non-passive wheel listener on canvasRef to prevent browser window zoom & back navigation
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const rect = canvas.getBoundingClientRect()
      const currentZoom = zoomRef.current
      const currentPan = panRef.current

      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch-to-zoom or Ctrl/Cmd + Mouse Wheel
        const zoomIntensity = 0.003
        const delta = -e.deltaY
        const factor = Math.exp(delta * zoomIntensity)
        const newZoom = Math.min(2.5, Math.max(0.2, currentZoom * factor))

        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        const newPanX = mouseX - (mouseX - currentPan.x) * (newZoom / currentZoom)
        const newPanY = mouseY - (mouseY - currentPan.y) * (newZoom / currentZoom)

        const finalZoom = Math.round(newZoom * 100) / 100
        const finalPan = { x: Math.round(newPanX), y: Math.round(newPanY) }

        zoomRef.current = finalZoom
        panRef.current = finalPan

        setZoom(finalZoom)
        setPan(finalPan)
      } else {
        // Natural 2-finger trackpad panning or mouse wheel scroll
        const deltaX = e.shiftKey ? e.deltaY : e.deltaX
        const deltaY = e.shiftKey ? 0 : e.deltaY

        const newPan = {
          x: Math.round(currentPan.x - deltaX),
          y: Math.round(currentPan.y - deltaY),
        }

        panRef.current = newPan
        setPan(newPan)
      }
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Window-level keyboard shortcuts for Space-pan, Zoom +/-, and Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      if (e.code === 'Space' && !isSpacePressedRef.current) {
        setIsSpacePressed(true)
        isSpacePressedRef.current = true
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        handleZoomStep(0.1)
      } else if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault()
        handleZoomStep(-0.1)
      } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault()
        zoomRef.current = 1
        panRef.current = { x: 0, y: 0 }
        setZoom(1)
        setPan({ x: 0, y: 0 })
      } else if (e.key === 'Escape') {
        setConnectingFrom(null)
        setSelectedNodeId(null)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false)
        isSpacePressedRef.current = false
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // Node Drag Start: Compute exact unscaled canvas coordinate
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if (e.button !== 0) return // Left click only
    if (isSpacePressedRef.current) return // Space held: allow canvas pan

    const target = e.target as HTMLElement
    // Ignore drag if clicking inside buttons, inputs or port handles
    if (target.closest('button') || target.closest('input') || target.closest('textarea')) {
      return
    }

    e.stopPropagation()
    e.preventDefault()

    setSelectedNodeId(nodeId)
    setDraggingNodeId(nodeId)
    draggingNodeIdRef.current = nodeId

    const rect = canvasRef.current?.getBoundingClientRect()
    const currentZoom = zoomRef.current
    const currentPan = panRef.current
    const node = nodesRef.current.find((n) => n.id === nodeId)

    if (rect && node) {
      // Calculate cursor position in canvas coordinate space
      const mouseCanvasX = (e.clientX - rect.left - currentPan.x) / currentZoom
      const mouseCanvasY = (e.clientY - rect.top - currentPan.y) / currentZoom

      const offset = {
        x: mouseCanvasX - node.position.x,
        y: mouseCanvasY - node.position.y,
      }
      setNodeDragOffset(offset)
      nodeDragOffsetRef.current = offset
    }
  }

  // Canvas Pan Start
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return // Left or middle click
    const target = e.target as HTMLElement

    // If clicking on a node card or control toolbar, don't initiate canvas pan
    if (target.closest('.canvas-node-card') || target.closest('.canvas-control-toolbar')) {
      return
    }

    setIsPanning(true)
    isPanningRef.current = true
    const start = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y }
    setDragStart(start)
    dragStartRef.current = start
    setSelectedNodeId(null)
    setConnectingFrom(null)
  }

  // Window-level mousemove and mouseup listeners for buttery-smooth drag & pan
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      // 1. Dragging Node
      if (draggingNodeIdRef.current) {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return

        const currentZoom = zoomRef.current
        const currentPan = panRef.current
        const offset = nodeDragOffsetRef.current
        const nodeId = draggingNodeIdRef.current

        const mouseCanvasX = (e.clientX - rect.left - currentPan.x) / currentZoom
        const mouseCanvasY = (e.clientY - rect.top - currentPan.y) / currentZoom

        const newX = Math.round(mouseCanvasX - offset.x)
        const newY = Math.round(mouseCanvasY - offset.y)

        setNodes((prev) =>
          prev.map((n) => (n.id === nodeId ? { ...n, position: { x: newX, y: newY } } : n))
        )
        setHasUnsavedChanges(true)
        return
      }

      // 2. Panning Canvas
      if (isPanningRef.current) {
        const start = dragStartRef.current
        const newPan = {
          x: Math.round(e.clientX - start.x),
          y: Math.round(e.clientY - start.y),
        }
        panRef.current = newPan
        setPan(newPan)
        return
      }

      // 3. Track mouse position for in-progress edge preview
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        const currentZoom = zoomRef.current
        const currentPan = panRef.current
        const mx = Math.round((e.clientX - rect.left - currentPan.x) / currentZoom)
        const my = Math.round((e.clientY - rect.top - currentPan.y) / currentZoom)
        setCanvasMousePos({ x: mx, y: my })
      }
    }

    const onMouseUp = () => {
      if (draggingNodeIdRef.current) {
        draggingNodeIdRef.current = null
        setDraggingNodeId(null)
      }
      if (isPanningRef.current) {
        isPanningRef.current = false
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

  // Add New Node (from click or drag-and-drop)
  const addNode = (type: NodeType, position?: { x: number; y: number }) => {
    const id = `node-${type}-${Date.now().toString(36)}`
    
    let posX: number
    let posY: number

    if (position) {
      posX = position.x
      posY = position.y
    } else {
      // Center of canvas viewport
      const rect = canvasRef.current?.getBoundingClientRect()
      const centerX = rect ? rect.width / 2 : 400
      const centerY = rect ? rect.height / 2 : 300
      posX = Math.round((centerX - panRef.current.x) / zoomRef.current) - 140
      posY = Math.round((centerY - panRef.current.y) / zoomRef.current) - 80
    }

    let defaultData: any = { title: `${type.replace(/_/g, ' ').toUpperCase()}` }

    if (type === 'trigger') {
      defaultData = {
        title: 'Keyword Trigger',
        trigger_type: 'keyword',
        keywords: ['hi', 'hello', 'start'],
        match_mode: 'fuzzy',
      }
    } else if (type === 'message') {
      defaultData = {
        title: 'Send Message',
        body: 'Hello {{contact.name}}! Thank you for contacting us.',
      }
    } else if (type === 'interactive_buttons') {
      defaultData = {
        title: 'Interactive Buttons',
        body: 'Please choose an option to continue:',
        buttons: [
          { id: 'btn_option_1', title: 'Option 1' },
          { id: 'btn_option_2', title: 'Option 2' },
        ],
      }
    } else if (type === 'native_flow_trigger') {
      defaultData = {
        title: 'WhatsApp Native Form',
        cta_text: 'Open Consultation Form',
        native_flow_id: availableNativeForms[0]?.id || '',
        flow_token: 'token_' + Date.now(),
      }
    } else if (type === 'ai_rag_node') {
      defaultData = {
        title: 'AI RAG Knowledge Guard',
        system_prompt: 'Answer questions strictly using our verified knowledge base. Then prompt user to resume step.',
        enable_auto_resume: true,
        max_turns: 3,
      }
    } else if (type === 'crm_deal_action') {
      defaultData = {
        title: 'Create CRM Deal',
        pipeline_stage: 'lead_in',
        deal_name: 'Lead from {{contact.name}}',
        monetary_value: 1000,
      }
    } else if (type === 'ticket_action') {
      defaultData = {
        title: 'Create Support Ticket',
        subject: 'Inquiry from {{contact.name}}',
        priority: 'medium',
      }
    }

    const newNode: WorkflowNode = {
      id,
      type,
      position: { x: posX, y: posY },
      data: defaultData,
    }

    setNodes((prev) => [...prev, newNode])
    setSelectedNodeId(id)
    setHasUnsavedChanges(true)
  }

  // Delete Node
  const deleteNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId))
    setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId))
    if (selectedNodeId === nodeId) setSelectedNodeId(null)
    setHasUnsavedChanges(true)
  }

  // Delete Edge
  const deleteEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== edgeId))
    setHasUnsavedChanges(true)
  }

  // Connect Ports
  const handleConnectPort = (nodeId: string, handleId?: string) => {
    if (!connectingFrom) {
      setConnectingFrom({ nodeId, handleId })
    } else {
      if (connectingFrom.nodeId === nodeId) {
        setConnectingFrom(null)
        return
      }

      const newEdge: WorkflowEdge = {
        id: `e-${connectingFrom.nodeId}-${nodeId}-${Date.now().toString(36)}`,
        source: connectingFrom.nodeId,
        target: nodeId,
        sourceHandle: connectingFrom.handleId,
      }

      // Avoid duplicates
      setEdges((prev) => [
        ...prev.filter(
          (e) => !(e.source === newEdge.source && e.target === newEdge.target && e.sourceHandle === newEdge.sourceHandle)
        ),
        newEdge,
      ])
      setConnectingFrom(null)
      setHasUnsavedChanges(true)
    }
  }

  // Update Node Data
  const updateNodeData = (nodeId: string, updates: Partial<any>) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n))
    )
    setHasUnsavedChanges(true)
  }

  // Simulator Engine
  const startSimulator = async () => {
    setShowSimulator(true)
    setSimulatorMessages([])
    setSimulatedCurrentNodeId(null)
    setSimulatedState({})
    setSimulatingStep(true)

    try {
      const res = await fetch('/api/flows/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes,
          edges,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setSimulatorMessages([{ sender: 'bot', text: data.reply, buttons: data.buttons, isNativeFlow: data.isNativeFlow, ctaText: data.ctaText }])
        setSimulatedCurrentNodeId(data.currentNodeId)
        setSimulatedState(data.simulatedState || {})
      }
    } catch (err) {
      console.error('Simulator error:', err)
    } finally {
      setSimulatingStep(false)
    }
  }

  const sendSimulatorMessage = async (text: string, buttonId?: string) => {
    if (!text.trim() && !buttonId) return
    setSimulatingStep(true)

    const userMsg = text || (buttonId ? `[Clicked: ${buttonId}]` : '')
    setSimulatorMessages((prev) => [...prev, { sender: 'user', text: userMsg }])
    setSimulatorInput('')

    try {
      const res = await fetch('/api/flows/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes,
          edges,
          currentNodeId: simulatedCurrentNodeId,
          userInput: text,
          buttonId,
          simulatedState,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setSimulatorMessages((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: data.reply,
            buttons: data.buttons,
            isNativeFlow: data.isNativeFlow,
            ctaText: data.ctaText,
          },
        ])
        setSimulatedCurrentNodeId(data.currentNodeId)
        setSimulatedState(data.simulatedState || {})
      }
    } catch (err) {
      console.error('Simulator step error:', err)
    } finally {
      setSimulatingStep(false)
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900 text-white">
        <div className="flex items-center gap-3">
          <Workflow className="w-6 h-6 text-emerald-400 animate-spin" />
          <span>Loading Visual Canvas...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0f12] text-slate-100 select-none overflow-hidden font-sans">
      {/* Top Header */}
      <header className="h-14 border-b border-slate-800 bg-[#11181c] px-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/flows"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="flex items-center gap-2">
            <span className="p-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Workflow className="w-4 h-4" />
            </span>
            <input
              type="text"
              value={flowName}
              onChange={(e) => {
                setFlowName(e.target.value)
                setHasUnsavedChanges(true)
              }}
              className="bg-transparent font-bold text-sm tracking-tight text-white hover:bg-slate-800/40 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <button
            onClick={() => {
              setIsActive(!isActive)
              setHasUnsavedChanges(true)
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wider transition-colors ${
              isActive
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <span>{isActive ? 'ACTIVE' : 'PAUSED'}</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              Saved at {lastSaved}
            </span>
          )}

          {hasUnsavedChanges && (
            <span className="text-[11px] text-amber-400 font-medium hidden sm:inline flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              Unsaved changes
            </span>
          )}

          <button
            onClick={startSimulator}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/20 text-xs font-semibold shadow-sm transition-all"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Test Simulator</span>
          </button>

          <button
            onClick={saveWorkflow}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00705c] text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Flow'}</span>
          </button>
        </div>
      </header>

      {/* Main Canvas & Drawers Area */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Left Palette: Add Node Blocks */}
        <aside className="w-64 border-r border-slate-800/80 bg-[#11181c] p-3 flex flex-col gap-3 z-10 overflow-y-auto">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Canvas Blocks</span>
            <p className="text-[11px] text-slate-500 mt-0.5">Click or drag blocks onto canvas</p>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">Triggers</span>
            <button
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', 'trigger')
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => addNode('trigger')}
              className="w-full text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-emerald-500/40 text-xs flex items-center gap-2.5 transition-all group cursor-grab active:cursor-grabbing"
            >
              <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20">
                <Play className="w-3.5 h-3.5" />
              </span>
              <div>
                <p className="font-semibold text-slate-200">Customer Trigger</p>
                <p className="text-[10px] text-slate-400">Match keywords or ad clicks</p>
              </div>
            </button>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold text-teal-400 uppercase tracking-wide">Conversational</span>
            <button
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', 'message')
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => addNode('message')}
              className="w-full text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-teal-500/40 text-xs flex items-center gap-2.5 transition-all group cursor-grab active:cursor-grabbing"
            >
              <span className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400 group-hover:bg-teal-500/20">
                <MessageSquare className="w-3.5 h-3.5" />
              </span>
              <div>
                <p className="font-semibold text-slate-200">Text Message</p>
                <p className="text-[10px] text-slate-400">Send WhatsApp speech bubble</p>
              </div>
            </button>

            <button
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', 'interactive_buttons')
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => addNode('interactive_buttons')}
              className="w-full text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-teal-500/40 text-xs flex items-center gap-2.5 transition-all group cursor-grab active:cursor-grabbing"
            >
              <span className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400 group-hover:bg-teal-500/20">
                <ListPlus className="w-3.5 h-3.5" />
              </span>
              <div>
                <p className="font-semibold text-slate-200">Interactive Buttons</p>
                <p className="text-[10px] text-slate-400">Quick-reply button options</p>
              </div>
            </button>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide">WhatsApp Native Form</span>
            <button
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', 'native_flow_trigger')
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => addNode('native_flow_trigger')}
              className="w-full text-left p-2.5 rounded-xl bg-indigo-950/20 hover:bg-indigo-900/30 border border-indigo-500/30 hover:border-indigo-400 text-xs flex items-center gap-2.5 transition-all group cursor-grab active:cursor-grabbing"
            >
              <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 group-hover:bg-indigo-500/30">
                <Smartphone className="w-3.5 h-3.5" />
              </span>
              <div>
                <p className="font-semibold text-indigo-200">Meta Native Flow</p>
                <p className="text-[10px] text-indigo-300/70">In-app zero-redirect sheet</p>
              </div>
            </button>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wide">AI Intelligence</span>
            <button
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', 'ai_rag_node')
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => addNode('ai_rag_node')}
              className="w-full text-left p-2.5 rounded-xl bg-cyan-950/20 hover:bg-cyan-900/30 border border-cyan-500/30 hover:border-cyan-400 text-xs flex items-center gap-2.5 transition-all group cursor-grab active:cursor-grabbing"
            >
              <span className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 group-hover:bg-cyan-500/30">
                <Sparkles className="w-3.5 h-3.5" />
              </span>
              <div>
                <p className="font-semibold text-cyan-200">AI RAG Guard</p>
                <p className="text-[10px] text-cyan-300/70">Mid-flow FAQ answering</p>
              </div>
            </button>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">CRM & Actions</span>
            <button
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', 'crm_deal_action')
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => addNode('crm_deal_action')}
              className="w-full text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-amber-500/40 text-xs flex items-center gap-2.5 transition-all group cursor-grab active:cursor-grabbing"
            >
              <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20">
                <Briefcase className="w-3.5 h-3.5" />
              </span>
              <div>
                <p className="font-semibold text-slate-200">Create Pipeline Deal</p>
                <p className="text-[10px] text-slate-400">Insert deal into Sales stage</p>
              </div>
            </button>

            <button
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', 'ticket_action')
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => addNode('ticket_action')}
              className="w-full text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-amber-500/40 text-xs flex items-center gap-2.5 transition-all group cursor-grab active:cursor-grabbing"
            >
              <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20">
                <Ticket className="w-3.5 h-3.5" />
              </span>
              <div>
                <p className="font-semibold text-slate-200">Create Ticket</p>
                <p className="text-[10px] text-slate-400">Escalate to support team</p>
              </div>
            </button>
          </div>
        </aside>

        {/* Center: Infinite Canvas */}
        <div
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(e) => {
            e.preventDefault()
            const nodeType = e.dataTransfer.getData('text/plain') as NodeType
            if (nodeType) {
              const rect = canvasRef.current?.getBoundingClientRect()
              if (!rect) return
              const dropCanvasX = Math.round((e.clientX - rect.left - panRef.current.x) / zoomRef.current) - 140
              const dropCanvasY = Math.round((e.clientY - rect.top - panRef.current.y) / zoomRef.current) - 40
              addNode(nodeType, { x: dropCanvasX, y: dropCanvasY })
            }
          }}
          className={`flex-1 h-full relative overflow-hidden bg-[#0c1216] select-none ${
            isPanning ? 'cursor-grabbing' : isSpacePressed ? 'cursor-grab' : 'cursor-default'
          }`}
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
            backgroundSize: `${Math.round(24 * zoom)}px ${Math.round(24 * zoom)}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        >
          {/* Floating Connecting Prompt */}
          {connectingFrom && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium backdrop-blur-md shadow-lg flex items-center gap-2 animate-bounce">
              <span>Click a node port to connect, or press Esc to cancel</span>
              <button
                onClick={() => setConnectingFrom(null)}
                className="ml-1 text-emerald-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Zoom & View Controls Toolbar */}
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="canvas-control-toolbar absolute bottom-4 left-4 z-30 flex items-center gap-1.5 bg-[#11181c]/90 backdrop-blur-md p-1.5 rounded-xl border border-slate-800 shadow-xl"
          >
            <button
              onClick={() => handleZoomStep(-0.1)}
              title="Zoom Out (Cmd -)"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-mono px-1.5 text-slate-300 font-semibold min-w-[44px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => handleZoomStep(0.1)}
              title="Zoom In (Cmd +)"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="w-[1px] h-4 bg-slate-700 mx-0.5" />
            <button
              onClick={fitToView}
              title="Fit Graph to View"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                zoomRef.current = 1
                panRef.current = { x: 0, y: 0 }
                setZoom(1)
                setPan({ x: 0, y: 0 })
              }}
              title="Reset Zoom to 100% (Cmd 0)"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Canvas Transformation Container */}
          <div
            className="pointer-events-none absolute inset-0 w-full h-full"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            {/* SVG Edges Layer */}
            <svg
              className="overflow-visible absolute top-0 left-0 w-full h-full pointer-events-none"
              style={{ zIndex: 1 }}
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
                </marker>
              </defs>

              {/* In-progress connecting line preview */}
              {connectingFrom && canvasMousePos && (() => {
                const src = nodes.find((n) => n.id === connectingFrom.nodeId)
                if (!src) return null
                const startX = src.position.x + 280
                const startY = src.position.y + 50
                const endX = canvasMousePos.x
                const endY = canvasMousePos.y
                const controlX = (startX + endX) / 2

                return (
                  <path
                    d={`M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeDasharray="6,4"
                    className="animate-pulse"
                    markerEnd="url(#arrow)"
                  />
                )
              })()}

              {edges.map((edge) => {
                const sourceNode = nodes.find((n) => n.id === edge.source)
                const targetNode = nodes.find((n) => n.id === edge.target)
                if (!sourceNode || !targetNode) return null

                // Compute port coordinates
                const startX = sourceNode.position.x + 280
                const startY = sourceNode.position.y + 50
                const endX = targetNode.position.x
                const endY = targetNode.position.y + 50

                const controlX = (startX + endX) / 2
                const midY = (startY + endY) / 2

                const isSimulatedActive =
                  simulatedCurrentNodeId === edge.source || simulatedCurrentNodeId === edge.target

                return (
                  <g key={edge.id} className="group pointer-events-auto cursor-pointer">
                    {/* Invisible wider hit area for easy hovering */}
                    <path
                      d={`M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                    />
                    <path
                      d={`M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`}
                      fill="none"
                      stroke={isSimulatedActive ? '#10b981' : '#334155'}
                      strokeWidth={isSimulatedActive ? 3 : 2}
                      strokeDasharray={isSimulatedActive ? '6,3' : undefined}
                      className={`transition-colors group-hover:stroke-rose-500/80 ${isSimulatedActive ? 'animate-pulse' : ''}`}
                      markerEnd="url(#arrow)"
                    />
                    {edge.sourceHandle && (
                      <text
                        x={(startX + endX) / 2}
                        y={midY - 8}
                        fill="#94a3b8"
                        fontSize="10"
                        textAnchor="middle"
                        className="font-mono bg-slate-900"
                      >
                        {edge.sourceHandle}
                      </text>
                    )}
                    {/* Delete Edge button on hover */}
                    <g
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteEdge(edge.id)
                      }}
                    >
                      <circle cx={controlX} cy={midY} r="8" fill="#e11d48" className="hover:scale-125 transition-transform" />
                      <text
                        x={controlX}
                        y={midY + 3.5}
                        fill="#ffffff"
                        fontSize="11"
                        fontWeight="bold"
                        textAnchor="middle"
                        className="pointer-events-none select-none font-mono"
                      >
                        ×
                      </text>
                    </g>
                  </g>
                )
              })}
            </svg>

            {/* Render Nodes */}
            {nodes.map((node) => {
              const isSelected = selectedNodeId === node.id
              const isSimulated = simulatedCurrentNodeId === node.id

              return (
                <div
                  key={node.id}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onDragStart={(e) => e.preventDefault()}
                  style={{
                    position: 'absolute',
                    left: `${node.position.x}px`,
                    top: `${node.position.y}px`,
                    width: '280px',
                    zIndex: isSelected ? 10 : 2,
                  }}
                  className={`canvas-node-card pointer-events-auto select-none rounded-2xl border transition-shadow cursor-move ${
                    isSelected
                      ? 'border-emerald-400 shadow-xl shadow-emerald-500/10 ring-2 ring-emerald-500/30'
                      : isSimulated
                      ? 'border-emerald-500 ring-4 ring-emerald-400/40 animate-pulse'
                      : 'border-slate-800 bg-[#161f26] hover:border-slate-700 shadow-md'
                  }`}
                >
                  {/* Node Header */}
                  <div
                    className={`px-3.5 py-2.5 rounded-t-2xl flex items-center justify-between border-b ${
                      node.type === 'trigger'
                        ? 'bg-emerald-950/40 border-emerald-900/50 text-emerald-300'
                        : node.type === 'native_flow_trigger'
                        ? 'bg-indigo-950/40 border-indigo-900/50 text-indigo-300'
                        : node.type === 'ai_rag_node'
                        ? 'bg-cyan-950/40 border-cyan-900/50 text-cyan-300'
                        : node.type === 'crm_deal_action' || node.type === 'ticket_action'
                        ? 'bg-amber-950/40 border-amber-900/50 text-amber-300'
                        : 'bg-slate-800/40 border-slate-700/50 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {node.type === 'trigger' && <Play className="w-3.5 h-3.5 text-emerald-400" />}
                      {node.type === 'message' && <MessageSquare className="w-3.5 h-3.5 text-teal-400" />}
                      {node.type === 'interactive_buttons' && <ListPlus className="w-3.5 h-3.5 text-teal-400" />}
                      {node.type === 'native_flow_trigger' && <Smartphone className="w-3.5 h-3.5 text-indigo-400" />}
                      {node.type === 'ai_rag_node' && <Sparkles className="w-3.5 h-3.5 text-cyan-400" />}
                      {node.type === 'crm_deal_action' && <Briefcase className="w-3.5 h-3.5 text-amber-400" />}
                      {node.type === 'ticket_action' && <Ticket className="w-3.5 h-3.5 text-amber-400" />}
                      <span className="text-xs font-bold tracking-tight line-clamp-1">
                        {node.data?.title || node.type}
                      </span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteNode(node.id)
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Node Body Content Preview */}
                  <div className="p-3 text-xs text-slate-300 bg-[#161f26] rounded-b-2xl space-y-2">
                    {node.type === 'trigger' && (
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase font-semibold">Keywords:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(node.data?.keywords || []).map((kw: string, i: number) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-[10px]">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {node.type === 'message' && (
                      <p className="line-clamp-3 text-slate-300 font-normal leading-relaxed bg-[#0c1216] p-2 rounded-xl border border-slate-800">
                        {node.data?.body || 'No message content'}
                      </p>
                    )}

                    {node.type === 'interactive_buttons' && (
                      <div className="space-y-1.5">
                        <p className="line-clamp-2 text-slate-400">{node.data?.body}</p>
                        <div className="space-y-1">
                          {(node.data?.buttons || []).map((btn: any) => (
                            <div
                              key={btn.id}
                              className="px-2.5 py-1 rounded-lg bg-teal-500/10 text-teal-300 border border-teal-500/20 text-[11px] font-medium flex items-center justify-between"
                            >
                              <span>{btn.title}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleConnectPort(node.id, btn.id)
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-3 h-3 rounded-full bg-teal-400 hover:scale-125 transition-transform"
                                title="Connect this button"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {node.type === 'native_flow_trigger' && (
                      <div className="p-2 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-indigo-200">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[11px]">{node.data?.cta_text || 'Open Form'}</span>
                          <ExternalLink className="w-3 h-3 text-indigo-400" />
                        </div>
                        <span className="text-[9px] text-indigo-300/60 block mt-1">Zero-redirect native form</span>
                      </div>
                    )}

                    {node.type === 'ai_rag_node' && (
                      <div className="p-2 rounded-xl bg-cyan-950/30 border border-cyan-500/20 text-cyan-200">
                        <span className="font-semibold text-[11px]">Mid-Flow AI Interceptor</span>
                        <p className="text-[10px] text-cyan-300/70 mt-0.5">
                          Answers off-topic queries & presents resume chip
                        </p>
                      </div>
                    )}

                    {node.type === 'crm_deal_action' && (
                      <div className="text-[11px] text-amber-200/90">
                        <span>Stage: </span>
                        <span className="font-semibold font-mono">{node.data?.pipeline_stage || 'lead_in'}</span>
                        <span className="block text-[10px] text-slate-400">Val: ${node.data?.monetary_value || 0}</span>
                      </div>
                    )}

                    {node.type === 'ticket_action' && (
                      <div className="text-[11px] text-amber-200/90">
                        <span>Priority: </span>
                        <span className="font-semibold uppercase">{node.data?.priority || 'medium'}</span>
                      </div>
                    )}
                  </div>

                  {/* Ports for Edge Connection */}
                  {/* Left Target Handle */}
                  {node.type !== 'trigger' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleConnectPort(node.id)
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded-full bg-slate-700 hover:bg-emerald-400 border-2 border-[#161f26] absolute -left-2 top-1/2 -translate-y-1/2 cursor-crosshair transition-colors"
                      title="Connect target input"
                    />
                  )}

                  {/* Right Source Handle (if not button-based) */}
                  {node.type !== 'interactive_buttons' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleConnectPort(node.id)
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className={`w-4 h-4 rounded-full border-2 border-[#161f26] absolute -right-2 top-1/2 -translate-y-1/2 cursor-crosshair transition-colors ${
                        connectingFrom?.nodeId === node.id ? 'bg-emerald-400 ring-4 ring-emerald-500/30' : 'bg-slate-700 hover:bg-emerald-400'
                      }`}
                      title="Connect next step"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Inspector Drawer (Edit Selected Node) */}
        {selectedNode && (
          <aside className="w-80 border-l border-slate-800 bg-[#11181c] p-4 flex flex-col justify-between z-10 overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-bold text-sm">Node Inspector</h3>
                </div>
                <button
                  onClick={() => setSelectedNodeId(null)}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Title Input */}
              <div>
                <label className="text-xs font-semibold text-slate-400">Node Title</label>
                <input
                  type="text"
                  value={selectedNode.data?.title || ''}
                  onChange={(e) => updateNodeData(selectedNode.id, { title: e.target.value })}
                  className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-900 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Specific Field Editors */}
              {selectedNode.type === 'trigger' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-400">Inbound Trigger Keywords</label>
                    <p className="text-[10px] text-slate-500">Comma-separated</p>
                    <input
                      type="text"
                      value={(selectedNode.data?.keywords || []).join(', ')}
                      onChange={(e) =>
                        updateNodeData(selectedNode.id, {
                          keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean),
                        })
                      }
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-900 border border-slate-700 font-mono"
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === 'message' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-400">Message Content</label>
                    <textarea
                      rows={5}
                      value={selectedNode.data?.body || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, { body: e.target.value })}
                      placeholder="Type WhatsApp message..."
                      className="w-full mt-1 p-2.5 text-xs rounded-xl bg-slate-900 border border-slate-700 leading-relaxed focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">Insert Variables</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {['{{contact.name}}', '{{contact.phone}}', '{{org.name}}'].map((tag) => (
                        <button
                          key={tag}
                          onClick={() =>
                            updateNodeData(selectedNode.id, {
                              body: (selectedNode.data?.body || '') + ' ' + tag,
                            })
                          }
                          className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700 hover:bg-slate-700"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {selectedNode.type === 'interactive_buttons' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-400">Prompt Text</label>
                    <textarea
                      rows={3}
                      value={selectedNode.data?.body || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, { body: e.target.value })}
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-900 border border-slate-700"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">Buttons (Max 3)</label>
                    <div className="space-y-1.5 mt-1">
                      {(selectedNode.data?.buttons || []).map((btn: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={btn.title}
                            onChange={(e) => {
                              const newButtons = [...selectedNode.data.buttons]
                              newButtons[idx] = { ...btn, title: e.target.value }
                              updateNodeData(selectedNode.id, { buttons: newButtons })
                            }}
                            className="flex-1 p-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700"
                          />
                          <button
                            onClick={() => {
                              const newButtons = selectedNode.data.buttons.filter((_: any, i: number) => i !== idx)
                              updateNodeData(selectedNode.id, { buttons: newButtons })
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}

                      {(selectedNode.data?.buttons || []).length < 3 && (
                        <button
                          onClick={() => {
                            const newBtn = {
                              id: `btn_${Date.now().toString(36)}`,
                              title: `Option ${(selectedNode.data?.buttons || []).length + 1}`,
                            }
                            updateNodeData(selectedNode.id, {
                              buttons: [...(selectedNode.data?.buttons || []), newBtn],
                            })
                          }}
                          className="w-full py-1.5 rounded-lg border border-dashed border-slate-700 text-xs text-slate-400 hover:text-white hover:border-emerald-500"
                        >
                          + Add Button
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {selectedNode.type === 'native_flow_trigger' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-400">Select Meta Native Form</label>
                    <select
                      value={selectedNode.data?.native_flow_id || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, { native_flow_id: e.target.value })}
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-900 border border-slate-700"
                    >
                      <option value="">Select a form...</option>
                      {availableNativeForms.map((form) => (
                        <option key={form.id} value={form.id}>
                          {form.name} ({form.screens?.length || 1} screens)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">CTA Button Text</label>
                    <input
                      type="text"
                      value={selectedNode.data?.cta_text || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, { cta_text: e.target.value })}
                      placeholder="e.g. Open Application Form"
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-900 border border-slate-700"
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === 'ai_rag_node' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-400">Knowledge Assistant Instructions</label>
                    <textarea
                      rows={4}
                      value={selectedNode.data?.system_prompt || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, { system_prompt: e.target.value })}
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-900 border border-slate-700 leading-relaxed"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-slate-300">Auto-Offer Resume Step</span>
                    <input
                      type="checkbox"
                      checked={selectedNode.data?.enable_auto_resume !== false}
                      onChange={(e) => updateNodeData(selectedNode.id, { enable_auto_resume: e.target.checked })}
                      className="rounded accent-emerald-500"
                    />
                  </div>
                </div>
              )}

              {selectedNode.type === 'crm_deal_action' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-400">Pipeline Stage</label>
                    <input
                      type="text"
                      value={selectedNode.data?.pipeline_stage || 'lead_in'}
                      onChange={(e) => updateNodeData(selectedNode.id, { pipeline_stage: e.target.value })}
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-900 border border-slate-700"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-400">Monetary Value ($)</label>
                    <input
                      type="number"
                      value={selectedNode.data?.monetary_value || 0}
                      onChange={(e) => updateNodeData(selectedNode.id, { monetary_value: Number(e.target.value) })}
                      className="w-full mt-1 p-2 text-xs rounded-xl bg-slate-900 border border-slate-700"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-800">
              <button
                onClick={() => deleteNode(selectedNode.id)}
                className="w-full py-2 rounded-xl bg-rose-950/40 text-rose-400 hover:bg-rose-900/50 border border-rose-800/40 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Node</span>
              </button>
            </div>
          </aside>
        )}

        {/* Right Drawer: Live Phone Simulator */}
        {showSimulator && (
          <aside className="w-96 border-l border-slate-800 bg-[#0b1014] flex flex-col z-20 shadow-2xl">
            {/* Simulator Header */}
            <div className="p-3 bg-[#161f26] border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold text-slate-200">WhatsApp Live Simulator</span>
              </div>
              <button
                onClick={() => setShowSimulator(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Simulated Phone Frame */}
            <div
              className="flex-1 p-3 overflow-y-auto space-y-3"
              style={{
                backgroundImage:
                  'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)',
                backgroundSize: '16px 16px',
              }}
            >
              {simulatorMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed shadow-sm ${
                      msg.sender === 'user'
                        ? 'bg-[#005c4b] text-white rounded-tr-none'
                        : 'bg-[#202c33] text-slate-100 rounded-tl-none border border-slate-700/50'
                    }`}
                  >
                    <p className="whitespace-pre-line">{msg.text}</p>

                    {/* Interactive Button Chips */}
                    {msg.buttons && msg.buttons.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-600/50 space-y-1.5">
                        {msg.buttons.map((b: any) => (
                          <button
                            key={b.id}
                            onClick={() => sendSimulatorMessage('', b.id)}
                            className="w-full py-1.5 px-3 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 font-semibold text-[11px] border border-emerald-500/30 transition-colors flex items-center justify-center gap-1.5"
                          >
                            <span>{b.title}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Native Flow CTA */}
                    {msg.isNativeFlow && (
                      <div className="mt-2.5 pt-2 border-t border-slate-600/50">
                        <button
                          onClick={() =>
                            sendSimulatorMessage(
                              `[Submitted WhatsApp Native Form with { name: 'John Doe', budget: '$10k+' }]`
                            )
                          }
                          className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] shadow-sm flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                          <span>{msg.ctaText || 'Open Interactive Form'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-500 mt-1 px-1">
                    {msg.sender === 'user' ? 'You' : 'Assistant Bot'}
                  </span>
                </div>
              ))}

              {simulatingStep && (
                <div className="flex items-center gap-2 text-xs text-slate-400 p-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>Processing node...</span>
                </div>
              )}
            </div>

            {/* Simulator Input Footer */}
            <div className="p-3 bg-[#161f26] border-t border-slate-800 flex items-center gap-2">
              <input
                type="text"
                value={simulatorInput}
                onChange={(e) => setSimulatorInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendSimulatorMessage(simulatorInput)}
                placeholder="Type customer reply..."
                className="flex-1 p-2 text-xs rounded-xl bg-[#0c1216] border border-slate-700 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button
                onClick={() => sendSimulatorMessage(simulatorInput)}
                disabled={!simulatorInput.trim()}
                className="p-2 rounded-xl bg-[#008069] text-white hover:bg-[#00705c] disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
