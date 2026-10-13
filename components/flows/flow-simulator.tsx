'use client'

import { useEffect, useRef } from 'react'
import { RotateCcw, Send, Smartphone, X } from 'lucide-react'

export interface SimulatorMessage {
  sender: 'user' | 'bot' | 'system'
  text: string
  buttons?: Array<{ id: string; title: string }>
  isNativeFlow?: boolean
  ctaText?: string
}

/** A WhatsApp-style chat that runs the flow on the canvas, including unsaved edits. */
export function FlowSimulator({
  messages,
  busy,
  completed,
  blockedReason,
  input,
  onInputChange,
  onSend,
  onSubmitForm,
  onRestart,
  onClose,
}: {
  messages: SimulatorMessage[]
  busy: boolean
  completed: boolean
  /** Set when the flow cannot be run yet (it has validation problems). */
  blockedReason?: string
  input: string
  onInputChange: (value: string) => void
  onSend: (text: string, buttonId?: string) => void
  onSubmitForm: () => void
  onRestart: () => void
  onClose: () => void
}) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, busy])

  const lastIndex = messages.length - 1

  return (
    <aside className="w-[340px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-[#0b141a] flex flex-col z-10">
      <div className="px-4 h-12 flex items-center justify-between bg-[#202c33] border-b border-black/20">
        <div className="flex items-center gap-2 min-w-0">
          <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-white leading-tight">Test this flow</p>
            <p className="text-[10px] text-slate-400 leading-tight truncate">Nothing is sent and no records are created</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onRestart} title="Restart" aria-label="Restart test" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer">
            <RotateCcw className="w-4 h-4" />
          </button>
          <button type="button" onClick={onClose} aria-label="Close test panel" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {blockedReason ? (
          <p className="m-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs leading-relaxed text-amber-200">{blockedReason}</p>
        ) : (
          messages.map((message, index) =>
            message.sender === 'system' ? (
              <p key={index} className="text-center text-[11px] text-slate-400 py-1">
                {message.text}
              </p>
            ) : (
              <div key={index} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-lg text-[13px] leading-relaxed shadow-sm ${
                    message.sender === 'user' ? 'bg-[#005c4b] text-white rounded-tr-none' : 'bg-[#202c33] text-slate-100 rounded-tl-none'
                  }`}
                >
                  <p className="whitespace-pre-line break-words">{message.text}</p>

                  {message.buttons && message.buttons.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                      {message.buttons.map((button) => (
                        <button
                          key={button.id}
                          type="button"
                          // Only the latest question can still be answered
                          disabled={busy || completed || index !== lastIndex}
                          onClick={() => onSend(button.title, button.id)}
                          className="w-full py-1.5 px-3 rounded-lg bg-white/5 hover:bg-white/10 text-sky-300 font-medium text-xs transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                        >
                          {button.title}
                        </button>
                      ))}
                    </div>
                  )}

                  {message.isNativeFlow && (
                    <div className="mt-2 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        disabled={busy || completed || index !== lastIndex}
                        onClick={onSubmitForm}
                        className="w-full py-1.5 px-3 rounded-lg bg-white/5 hover:bg-white/10 text-sky-300 font-medium text-xs flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        {message.ctaText || 'Open form'}
                      </button>
                      <p className="mt-1 text-[10px] text-slate-400 text-center">Submits sample answers</p>
                    </div>
                  )}
                </div>
              </div>
            )
          )
        )}

        {busy && <p className="text-[11px] text-slate-400 px-1">Running the next step…</p>}
        {completed && !busy && !blockedReason && (
          <p className="text-center text-[11px] text-slate-400 py-1">
            End of the flow.{' '}
            <button type="button" onClick={onRestart} className="text-emerald-400 font-semibold hover:underline cursor-pointer">
              Run it again
            </button>
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (input.trim()) onSend(input.trim())
        }}
        className="p-2.5 bg-[#202c33] flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          disabled={busy || completed || Boolean(blockedReason)}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={completed ? 'Flow finished' : 'Type a customer reply…'}
          aria-label="Customer reply"
          className="flex-1 px-3 py-2 text-[13px] rounded-lg bg-[#2a3942] text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
        />
        <button
          type="submit"
          aria-label="Send reply"
          disabled={busy || completed || Boolean(blockedReason) || !input.trim()}
          className="h-9 w-9 shrink-0 rounded-full bg-[#00a884] text-white flex items-center justify-center hover:bg-[#008f70] disabled:opacity-40 cursor-pointer"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </aside>
  )
}
