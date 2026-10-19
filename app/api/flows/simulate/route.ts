import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/api-auth-helper'
import type { WorkflowNode, WorkflowEdge } from '@/lib/flows/flow-types'
import { getNextNode, getChoices, resolveReply, validateWorkflow, readNodeField, normalizeTags, interpolateVariables } from '@/lib/flows/flow-graph'
import { runFlow, type FlowReply } from '@/lib/flows/flow-runner'

export async function POST(request: NextRequest) {
  if (!await getAuthenticatedUser(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { nodes, edges, currentNodeId, userInput = '', buttonId, simulatedState = {}, flowSubmissionData } = await request.json()
    const errors = validateWorkflow(nodes, edges)
    if (errors.length) return NextResponse.json({ error: errors.join('\n'), validationErrors: errors }, { status: 422 })
    const nodeList: WorkflowNode[] = nodes
    const edgeList: WorkflowEdge[] = edges
    let state = { name: 'Test Customer', phone: '+10000000000', contact: { id: 'simulation', name: 'Test Customer', phone: '+10000000000' }, ...simulatedState, last_input: userInput }
    let next: WorkflowNode | undefined
    let answeredChoice = false
    if (!currentNodeId) next = nodeList.find(node => node.type === 'trigger')
    else {
      const current = nodeList.find(node => node.id === currentNodeId)
      if (!current) throw new Error('The current step no longer exists; restart the simulator')
      // Like live: the customer's next message after "type your question" goes to the knowledge assistant
      if (current.type === 'ai_rag_node') return NextResponse.json({ reply: 'Live, your knowledge assistant answers this question. No AI answer is generated in simulation.', isCompleted: true, currentNodeId: null, simulatedState: state })
      const isChoice = ['interactive_buttons', 'list_menu'].includes(current.type)
      const choice = isChoice ? resolveReply(current, nodes, edges, userInput, buttonId) : undefined
      // A tapped "Cancel" button follows its own branch; only a typed exit word leaves the flow
      if (!choice?.matched && ['stop', 'cancel', 'exit'].includes(userInput.trim().toLowerCase())) return NextResponse.json({ reply: 'Flow cancelled.', isCompleted: true, currentNodeId: null, simulatedState: state })
      if (isChoice) {
        const result = choice!
        if (!result.matched) return NextResponse.json({ reply: 'Please choose an option above, or reply “cancel”.', buttons: getChoices(current).map(item => ({ id: item.id, title: item.title })), currentNodeId, simulatedState: state })
        answeredChoice = true
        state.last_choice = result.choice!.id
        state.last_choice_title = result.choice!.title
        if (current.data.variableName || current.data.variable_name) state[current.data.variableName || current.data.variable_name] = result.choice!.id
        next = result.next
      } else if (current.type === 'native_flow_trigger') {
        if (!flowSubmissionData || typeof flowSubmissionData !== 'object' || Array.isArray(flowSubmissionData)) return NextResponse.json({ reply: 'Submit sample form answers to continue. Ordinary chat messages do not complete a native form.', isNativeFlow: true, ctaText: 'Submit sample answers', currentNodeId, simulatedState: state })
        state = { ...state, form: flowSubmissionData, submission: flowSubmissionData }
        next = current.data.onSuccessNodeId ? nodes.find((node: WorkflowNode) => node.id === current.data.onSuccessNodeId) : getNextNode(nodes, edges, current.id)
      } else next = getNextNode(nodes, edges, current.id)
    }
    const replies: FlowReply[] = []
    if (!next) return NextResponse.json({ reply: 'Flow completed.', isCompleted: true, currentNodeId: null, simulatedState: state })
    const result = await runFlow(nodeList, edgeList, next, state, {
      send: async reply => { replies.push(reply) },
      nativeFlow: async node => ({ type: 'native_flow', body: node.data.description || 'Complete the form to continue.', flowPayload: { flow_cta: readNodeField(node.data, 'flowCtaText', 'cta_text') || 'Open Form' } }),
      action: async (node, state) => {
        if (node.type === 'crm_deal_action') return { deal_id: 'simulated-deal', simulated_actions: [...(state.simulated_actions || []), 'Would create a CRM lead'] }
        if (node.type === 'ticket_action') return { ticket_id: 'simulated-ticket', simulated_actions: [...(state.simulated_actions || []), 'Would create a support ticket'] }
        if (node.type === 'tag_action') {
          const verb = readNodeField(node.data, 'action', 'tag_action_type') === 'remove' ? 'remove' : 'add'
          return { simulated_actions: [...(state.simulated_actions || []), `Would ${verb} tags: ${normalizeTags(node.data.tags).join(', ')}`] }
        }
        return { handed_off: true, simulated_actions: [...(state.simulated_actions || []), 'Would assign the conversation and pause automation'] }
      },
    })
    if (result.isRagFallback && answeredChoice) {
      // A menu choice is not the question itself: ask for it, as the live runtime does
      const node = nodeList.find(item => item.id === result.currentNodeId)
      replies.push({ type: 'text', body: interpolateVariables(readNodeField(node?.data || {}, 'promptText', 'prompt', 'description') || 'Sure! Type your question and I’ll answer it right here.', result.state) })
      return NextResponse.json({ reply: replies.map(reply => reply.body).join('\n\n'), replies, currentNodeId: result.currentNodeId, simulatedState: result.state, isCompleted: false })
    }
    const last = replies.at(-1)
    return NextResponse.json({
      reply: replies.map(reply => reply.body).join('\n\n') || (result.isRagFallback ? 'Live execution delegates this message to your knowledge assistant. No AI answer is generated in simulation.' : 'Flow completed.'),
      replies, buttons: last?.buttons || last?.sections?.flatMap(section => section.rows), isNativeFlow: last?.type === 'native_flow', ctaText: last?.flowPayload?.flow_cta,
      currentNodeId: result.currentNodeId, simulatedState: result.state, isCompleted: result.status === 'COMPLETED' || result.isRagFallback,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Simulation failed' }, { status: 400 })
  }
}
