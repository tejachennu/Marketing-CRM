'use client'

import Link from 'next/link'
import { AlertCircle, Plus, Trash2, X } from 'lucide-react'
import type { WorkflowNode } from '@/lib/flows/flow-types'
import { ChipsInput } from './chips-input'
import { getNodeDefinition, TONE_CLASSES, uid } from './node-catalog'

export interface InspectorForm {
  id: string
  name: string
  status: string
  flow_id_meta?: string | null
}

const fieldClass =
  'w-full mt-1 px-2.5 py-2 text-[13px] rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'

function Field({
  label,
  hint,
  count,
  max,
  children,
}: {
  label: string
  hint?: string
  /** Current length, shown against `max` so limits are visible before saving. */
  count?: number
  max?: number
  children: React.ReactNode
}) {
  const over = max !== undefined && count !== undefined && count > max
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
        <span>{label}</span>
        {max !== undefined && count !== undefined && (
          <span className={`font-normal tabular-nums ${over ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>
            {count}/{max}
          </span>
        )}
      </span>
      {children}
      {hint && <span className="block mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  )
}

/** Buttons that append a `{{variable}}` placeholder to a text field. */
function VariableChips({ variables, onInsert }: { variables: string[]; onInsert: (token: string) => void }) {
  return (
    <div>
      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Insert a variable</span>
      <div className="flex flex-wrap gap-1 mt-1">
        {variables.map((variable) => (
          <button
            key={variable}
            type="button"
            onClick={() => onInsert(`{{${variable}}}`)}
            className="px-1.5 py-0.5 rounded-md text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border border-slate-200 dark:border-slate-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
          >
            {variable}
          </button>
        ))}
      </div>
    </div>
  )
}

const OPERATOR_LABELS: Record<string, string> = {
  equals: 'is equal to',
  not_equals: 'is not equal to',
  contains: 'contains',
  greater_than: 'is greater than',
  less_than: 'is less than',
  is_set: 'has any value',
}

export function NodeInspector({
  node,
  issues,
  nativeForms,
  pipelineStages,
  variables,
  onChange,
  onRemoveOutput,
  onDelete,
  onClose,
}: {
  node: WorkflowNode
  /** Validation messages for this block. */
  issues: string[]
  nativeForms: InspectorForm[]
  pipelineStages: Array<{ id: string; name: string }>
  /** Variable paths that exist at runtime, e.g. `contact.name` or `form.budget`. */
  variables: string[]
  onChange: (updates: Record<string, any>) => void
  /** Called when a button / list row is deleted so its connection is removed too. */
  onRemoveOutput: (handleId: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  const data: Record<string, any> = node.data || {}
  const definition = getNodeDefinition(node.type)
  const Icon = definition.icon
  const tone = TONE_CLASSES[definition.tone]
  const read = (...keys: string[]) => keys.map((key) => data[key]).find((value) => value !== undefined && value !== null && value !== '')
  const append = (key: string, current: string) => (token: string) => onChange({ [key]: current ? `${current} ${token}` : token })

  const body = String(read('messageText', 'bodyText', 'body', 'message_text', 'body_text') ?? '')
  const setBody = (value: string) => onChange({ body: value, messageText: undefined, bodyText: undefined, message_text: undefined, body_text: undefined })

  const buttons: Array<{ id: string; title: string }> = Array.isArray(data.buttons) ? data.buttons : []
  const rows: Array<{ id: string; title: string; description?: string }> = (Array.isArray(data.sections) ? data.sections : []).flatMap(
    (section: any) => (Array.isArray(section?.rows) ? section.rows : [])
  )
  // The builder edits a single section; rows from any extra sections are folded into it
  const setRows = (next: typeof rows) => onChange({ sections: [{ title: data.sections?.[0]?.title || 'Options', rows: next }] })

  const triggerType = read('triggerType', 'trigger_type') || 'keyword'
  const selectedForm = nativeForms.find((form) => form.id === read('flowId', 'native_flow_id', 'flow_id'))
  const isPublished = (form: InspectorForm) => form.status === 'PUBLISHED' && Boolean(form.flow_id_meta)

  return (
    <aside className="w-[340px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#11181c] flex flex-col z-10">
      <div className="px-4 h-12 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#11181c]">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center ${tone.chip}`}>
            <Icon className="w-4 h-4" />
          </span>
          <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">{definition.label}</h3>
        </div>
        <button
          type="button"
          aria-label="Close block settings"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {issues.length > 0 && (
          <div role="alert" className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-200 space-y-1">
            {issues.map((issue) => (
              <p key={issue} className="flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span className="first-letter:uppercase">{issue}</span>
              </p>
            ))}
          </div>
        )}

        <Field label="Block name" hint="Only you see this. It labels the block on the canvas.">
          <input type="text" value={data.title || ''} maxLength={60} onChange={(event) => onChange({ title: event.target.value })} className={fieldClass} />
        </Field>

        {node.type === 'trigger' && (
          <>
            <Field label="Start this flow when">
              <select value={triggerType} onChange={(event) => onChange({ trigger_type: event.target.value, triggerType: undefined })} className={fieldClass}>
                <option value="keyword">A message matches a keyword</option>
                <option value="first_message">A customer writes for the first time</option>
              </select>
            </Field>
            {triggerType === 'keyword' ? (
              <>
                <Field label="Match">
                  <select
                    value={read('matchType', 'match_mode') === 'exact' ? 'exact' : 'contains'}
                    onChange={(event) => onChange({ match_mode: event.target.value, matchType: undefined })}
                    className={fieldClass}
                  >
                    <option value="contains">Message contains the keyword</option>
                    <option value="exact">Message is exactly the keyword</option>
                  </select>
                </Field>
                <div>
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Keywords</span>
                  <ChipsInput
                    ariaLabel="Add a keyword"
                    placeholder="Type a keyword, press Enter"
                    values={Array.isArray(data.keywords) ? data.keywords : []}
                    onChange={(keywords) => onChange({ keywords })}
                  />
                  <span className="block mt-1 text-[11px] text-slate-500 dark:text-slate-400">Not case-sensitive. Any one keyword starts the flow.</span>
                </div>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Runs once, on the very first message of a new conversation. Keyword flows take priority when both match.
              </p>
            )}
          </>
        )}

        {node.type === 'message' && (
          <>
            <Field label="Message" count={body.length} max={4096}>
              <textarea rows={6} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Type the WhatsApp message…" className={`${fieldClass} leading-relaxed resize-y`} />
            </Field>
            <VariableChips variables={variables} onInsert={(token) => setBody(body ? `${body} ${token}` : token)} />
          </>
        )}

        {(node.type === 'interactive_buttons' || node.type === 'list_menu') && (
          <>
            <Field label="Question" count={body.length} max={1024}>
              <textarea rows={3} value={body} onChange={(event) => setBody(event.target.value)} className={`${fieldClass} leading-relaxed resize-y`} />
            </Field>
            <VariableChips variables={variables} onInsert={(token) => setBody(body ? `${body} ${token}` : token)} />
          </>
        )}

        {node.type === 'interactive_buttons' && (
          <div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Buttons ({buttons.length}/3)</span>
            <div className="space-y-1.5 mt-1">
              {buttons.map((button, index) => (
                <div key={button.id} className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={button.title}
                      maxLength={20}
                      aria-label={`Button ${index + 1} label`}
                      onChange={(event) => onChange({ buttons: buttons.map((item) => (item.id === button.id ? { ...item, title: event.target.value } : item)) })}
                      className={`${fieldClass} mt-0 pr-12`}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-slate-400">{button.title.length}/20</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove button ${button.title}`}
                    disabled={buttons.length <= 1}
                    onClick={() => {
                      onChange({ buttons: buttons.filter((item) => item.id !== button.id) })
                      onRemoveOutput(button.id)
                    }}
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {buttons.length < 3 && (
                <button
                  type="button"
                  onClick={() => onChange({ buttons: [...buttons, { id: `btn_${uid()}`, title: `Option ${buttons.length + 1}` }] })}
                  className="w-full py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-emerald-700 hover:border-emerald-500 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add button
                </button>
              )}
            </div>
            <span className="block mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">Connect each button to the step that should follow it.</span>
          </div>
        )}

        {node.type === 'list_menu' && (
          <>
            <Field label="Menu button label" count={String(read('buttonText', 'button_text') ?? 'Choose').length} max={20}>
              <input type="text" maxLength={20} value={read('buttonText', 'button_text') ?? 'Choose'} onChange={(event) => onChange({ button_text: event.target.value, buttonText: undefined })} className={fieldClass} />
            </Field>
            <div>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Choices ({rows.length}/10)</span>
              <div className="space-y-1.5 mt-1">
                {rows.map((row, index) => (
                  <div key={row.id} className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={row.title}
                        maxLength={24}
                        aria-label={`Choice ${index + 1} label`}
                        onChange={(event) => setRows(rows.map((item) => (item.id === row.id ? { ...item, title: event.target.value } : item)))}
                        className={`${fieldClass} mt-0 pr-12`}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-slate-400">{row.title.length}/24</span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove choice ${row.title}`}
                      disabled={rows.length <= 1}
                      onClick={() => {
                        setRows(rows.filter((item) => item.id !== row.id))
                        onRemoveOutput(row.id)
                      }}
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {rows.length < 10 && (
                  <button
                    type="button"
                    onClick={() => setRows([...rows, { id: `row_${uid()}`, title: `Choice ${rows.length + 1}` }])}
                    className="w-full py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-emerald-700 hover:border-emerald-500 flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add choice
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {node.type === 'native_flow_trigger' && (
          <>
            <Field
              label="Form to send"
              hint={
                nativeForms.length === 0
                  ? 'You have no forms yet. Create one from Flows → WhatsApp forms.'
                  : selectedForm && !isPublished(selectedForm)
                  ? 'This form is still a draft. Publish it to WhatsApp before going live.'
                  : undefined
              }
            >
              <select value={read('flowId', 'native_flow_id', 'flow_id') || ''} onChange={(event) => onChange({ native_flow_id: event.target.value, flowId: undefined, flow_id: undefined })} className={fieldClass}>
                <option value="">Select a form…</option>
                {nativeForms.map((form) => (
                  <option key={form.id} value={form.id}>
                    {form.name} {isPublished(form) ? '' : '(draft)'}
                  </option>
                ))}
              </select>
            </Field>
            {selectedForm && !isPublished(selectedForm) && (
              <Link href={`/dashboard/flows/native/${selectedForm.id}`} className="inline-block text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                Open the form designer to publish it →
              </Link>
            )}
            <Field label="Message above the form" count={String(data.description || '').length} max={1024}>
              <textarea rows={2} value={data.description || ''} placeholder="Please complete the form below:" onChange={(event) => onChange({ description: event.target.value })} className={`${fieldClass} resize-y`} />
            </Field>
            <Field label="Button label" count={String(read('flowCtaText', 'cta_text', 'flow_cta_text') ?? '').length} max={30}>
              <input type="text" maxLength={30} value={read('flowCtaText', 'cta_text', 'flow_cta_text') ?? ''} placeholder="Open form" onChange={(event) => onChange({ cta_text: event.target.value, flowCtaText: undefined, flow_cta_text: undefined })} className={fieldClass} />
            </Field>
            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              The flow waits here until the customer submits the form. Answers are then available as <span className="font-mono">form.field_name</span>.
            </p>
          </>
        )}

        {node.type === 'condition_branch' && (
          <>
            <Field label="Check this value" hint="For example last_choice_title (the button or menu choice they tapped) or form.budget (a form answer).">
              <input
                type="text"
                list="flow-variable-suggestions"
                value={read('variableName', 'variable_name', 'variable') || ''}
                placeholder="last_choice_title"
                onChange={(event) => onChange({ variable_name: event.target.value, variableName: undefined, variable: undefined })}
                className={`${fieldClass} font-mono`}
              />
              <datalist id="flow-variable-suggestions">
                {[...new Set(['last_choice_title', 'last_choice', 'last_input', ...variables])].map((variable) => (
                  <option key={variable} value={variable} />
                ))}
              </datalist>
            </Field>
            <Field label="Condition">
              <select value={data.operator || 'equals'} onChange={(event) => onChange({ operator: event.target.value })} className={fieldClass}>
                {Object.entries(OPERATOR_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {data.operator !== 'is_set' && (
              <Field label="Compare with" hint="To check a button or menu choice, type its label exactly as the customer sees it.">
                <input
                  type="text"
                  value={read('compareValue', 'compare_value', 'value') ?? ''}
                  onChange={(event) => onChange({ compare_value: event.target.value, compareValue: undefined, value: undefined })}
                  className={`${fieldClass} font-mono`}
                />
              </Field>
            )}
            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">Connect both outputs: one for when the condition matches and one for everything else.</p>
          </>
        )}

        {node.type === 'set_variable' && (
          <>
            <Field label="Variable name" hint="Letters, numbers and underscores. Use a dot to group values, e.g. lead.tier.">
              <input type="text" value={read('variableName', 'variable_name') || ''} placeholder="lead_tier" onChange={(event) => onChange({ variable_name: event.target.value.trim(), variableName: undefined })} className={`${fieldClass} font-mono`} />
            </Field>
            <Field label="Type">
              <select value={read('valueType', 'value_type') || 'text'} onChange={(event) => onChange({ value_type: event.target.value, valueType: undefined })} className={fieldClass}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Yes / no</option>
              </select>
            </Field>
            <Field label="Value">
              <input type="text" value={read('valueExpression', 'value_expression') ?? ''} placeholder="premium" onChange={(event) => onChange({ value_expression: event.target.value, valueExpression: undefined })} className={fieldClass} />
            </Field>
            <VariableChips variables={variables} onInsert={append('value_expression', String(read('valueExpression', 'value_expression') ?? ''))} />
          </>
        )}

        {node.type === 'crm_deal_action' && (
          <>
            <Field label="Lead title">
              <input type="text" value={read('dealTitle', 'deal_name', 'deal_title') ?? ''} placeholder="Lead from {{contact.name}}" onChange={(event) => onChange({ deal_name: event.target.value, dealTitle: undefined, deal_title: undefined })} className={fieldClass} />
            </Field>
            <VariableChips variables={variables} onInsert={append('deal_name', String(read('dealTitle', 'deal_name', 'deal_title') ?? ''))} />
            <Field label="Pipeline stage">
              <select value={read('stageId', 'pipeline_stage', 'stage_id') || 'lead_in'} onChange={(event) => onChange({ pipeline_stage: event.target.value, stageId: undefined, stage_id: undefined })} className={fieldClass}>
                <option value="lead_in">First stage of the pipeline</option>
                {pipelineStages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Deal value">
              <input type="number" min={0} value={read('dealValue', 'monetary_value', 'deal_value') ?? 0} onChange={(event) => onChange({ monetary_value: Math.max(0, Number(event.target.value) || 0), dealValue: undefined, deal_value: undefined })} className={fieldClass} />
            </Field>
            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">Form answers collected earlier in the flow are saved in the lead notes.</p>
          </>
        )}

        {node.type === 'ticket_action' && (
          <>
            <Field label="Ticket subject">
              <input type="text" value={data.subject || ''} placeholder="Support request from {{contact.name}}" onChange={(event) => onChange({ subject: event.target.value })} className={fieldClass} />
            </Field>
            <VariableChips variables={variables} onInsert={append('subject', String(data.subject || ''))} />
          </>
        )}

        {node.type === 'tag_action' && (
          <>
            <Field label="Action">
              <select value={read('action', 'tag_action_type') === 'remove' ? 'remove' : 'add'} onChange={(event) => onChange({ action: event.target.value, tag_action_type: undefined })} className={fieldClass}>
                <option value="add">Add these tags to the contact</option>
                <option value="remove">Remove these tags from the contact</option>
              </select>
            </Field>
            <div>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Tags</span>
              <ChipsInput ariaLabel="Add a tag" placeholder="Type a tag, press Enter" values={Array.isArray(data.tags) ? data.tags : []} onChange={(tags) => onChange({ tags })} />
            </div>
          </>
        )}

        {node.type === 'assign_agent_action' && (
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Returns the conversation to the shared team queue and turns automatic replies off for it, so a teammate can take over in the inbox. The flow ends here.
          </p>
        )}

        {node.type === 'ai_rag_node' && (
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Your knowledge assistant answers the customer&apos;s message using the knowledge base and prompt from Settings. The flow ends here.
          </p>
        )}

        {!definition.supported && (
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            This type of block cannot run yet, so a flow that contains it cannot go live. Delete it and connect the surrounding steps directly.
          </p>
        )}
      </div>

      <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#11181c]">
        <button
          type="button"
          onClick={onDelete}
          className="w-full h-9 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete block
        </button>
      </div>
    </aside>
  )
}
