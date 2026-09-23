import { NextRequest, NextResponse } from 'next/server'
import { WorkflowNode, WorkflowEdge } from '@/lib/flows/flow-types'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nodes, edges, currentNodeId, userInput, buttonId, simulatedState = {} } = body

    if (!nodes || !edges) {
      return NextResponse.json({ error: 'Missing nodes or edges' }, { status: 400 })
    }

    const nodeList: WorkflowNode[] = nodes
    const edgeList: WorkflowEdge[] = edges

    // 1. If starting simulator from scratch
    if (!currentNodeId) {
      const triggerNode = nodeList.find((n) => n.type === 'trigger')
      if (!triggerNode) {
        return NextResponse.json({
          reply: '⚠️ No starting Trigger node found in canvas. Add a trigger node to begin.',
          currentNodeId: null,
          simulatedState,
        })
      }

      // Find first connected node after trigger
      const firstEdge = edgeList.find((e) => e.source === triggerNode.id)
      if (!firstEdge) {
        return NextResponse.json({
          reply: 'Trigger node is not connected to any subsequent message or action.',
          currentNodeId: triggerNode.id,
          simulatedState,
        })
      }

      const nextNode = nodeList.find((n) => n.id === firstEdge.target)
      if (!nextNode) {
        return NextResponse.json({
          reply: 'Target node not found.',
          currentNodeId: triggerNode.id,
          simulatedState,
        })
      }

      return processSimulatedNode(nextNode, nodeList, edgeList, simulatedState)
    }

    // 2. Advancing from an existing node
    const currentNode = nodeList.find((n) => n.id === currentNodeId)
    if (!currentNode) {
      return NextResponse.json({
        reply: 'Current node not found.',
        currentNodeId: null,
        simulatedState,
      })
    }

    // Match edge based on button click or default
    let matchingEdge = edgeList.find((e) => {
      if (e.source !== currentNode.id) return false
      if (buttonId && e.sourceHandle) {
        return e.sourceHandle === buttonId
      }
      return true
    })

    if (!matchingEdge) {
      // Check fallback AI RAG node if off-script input
      const aiNode = nodeList.find((n) => n.type === 'ai_rag_node')
      if (aiNode && userInput) {
        return NextResponse.json({
          reply: `🤖 [AI RAG Intelligent Fallback]: Based on our knowledge base, here is the answer for "${userInput}". \n\n👉 Would you like to resume your previous step?`,
          buttons: [
            { id: 'resume_step', title: '↩️ Resume Step' },
            { id: 'talk_agent', title: '👤 Talk to Agent' },
          ],
          currentNodeId: aiNode.id,
          simulatedState: { ...simulatedState, last_rag_query: userInput },
          isRag: true,
        })
      }

      return NextResponse.json({
        reply: '✅ Flow completed or reached an endpoint with no further connected nodes.',
        currentNodeId: currentNode.id,
        isCompleted: true,
        simulatedState,
      })
    }

    const nextNode = nodeList.find((n) => n.id === matchingEdge.target)
    if (!nextNode) {
      return NextResponse.json({
        reply: 'Connected node target missing.',
        currentNodeId: currentNode.id,
        simulatedState,
      })
    }

    return processSimulatedNode(nextNode, nodeList, edgeList, simulatedState)
  } catch (err: any) {
    console.error('[Simulate POST] Error:', err)
    return NextResponse.json({ error: err.message || 'Simulation error' }, { status: 500 })
  }
}

function processSimulatedNode(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  state: Record<string, any>
): NextResponse {
  if (node.type === 'message') {
    const data = node.data as any
    return NextResponse.json({
      reply: data.body || '...',
      currentNodeId: node.id,
      nodeType: 'message',
      simulatedState: state,
    })
  }

  if (node.type === 'interactive_buttons') {
    const data = node.data as any
    return NextResponse.json({
      reply: data.body || 'Please select an option:',
      buttons: data.buttons || [],
      currentNodeId: node.id,
      nodeType: 'interactive_buttons',
      simulatedState: state,
    })
  }

  if (node.type === 'native_flow_trigger') {
    const data = node.data as any
    return NextResponse.json({
      reply: `📱 WhatsApp Native Form Sheet: "${data.cta_text || 'Open Form'}"`,
      isNativeFlow: true,
      ctaText: data.cta_text || 'Open Interactive Form',
      flowToken: data.flow_token || 'demo_token',
      currentNodeId: node.id,
      nodeType: 'native_flow_trigger',
      simulatedState: state,
    })
  }

  if (node.type === 'crm_deal_action') {
    const data = node.data as any
    const nextEdge = edges.find((e) => e.source === node.id)
    const nextNode = nextEdge ? nodes.find((n) => n.id === nextEdge.target) : null

    const updatedState = { ...state, deal_created: true, deal_title: data.deal_name }

    if (nextNode) {
      const chained = processSimulatedNode(nextNode, nodes, edges, updatedState)
      return chained
    }

    return NextResponse.json({
      reply: `💼 CRM Action: Successfully created deal "${data.deal_name || 'New Opportunity'}" in pipeline stage "${data.pipeline_stage || 'lead_in'}"!`,
      currentNodeId: node.id,
      nodeType: 'crm_deal_action',
      simulatedState: updatedState,
    })
  }

  if (node.type === 'ticket_action') {
    const data = node.data as any
    return NextResponse.json({
      reply: `🎫 Ticket Created: "${data.subject || 'Customer Support Request'}" with priority ${data.priority || 'medium'}. An agent has been alerted.`,
      currentNodeId: node.id,
      nodeType: 'ticket_action',
      simulatedState: { ...state, ticket_created: true },
    })
  }

  if (node.type === 'ai_rag_node') {
    const data = node.data as any
    return NextResponse.json({
      reply: `🧠 AI RAG Node: "${data.title || 'Knowledge Assistant'}" ready to answer mid-flow questions.`,
      currentNodeId: node.id,
      nodeType: 'ai_rag_node',
      simulatedState: state,
    })
  }

  return NextResponse.json({
    reply: `Reached ${node.type} (${node.data?.title || node.id})`,
    currentNodeId: node.id,
    simulatedState: state,
  })
}
