'use client'

import { useState, useEffect } from 'react'
import {
  Sparkles, Search, MessageSquare, Terminal, Settings, Info,
  CheckCircle2, AlertTriangle, HelpCircle, ArrowRight, Loader2, Play
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

const PRESET_QUERIES = [
  'Can I apply for PR extension without valid passport?',
  'Do I need to send my original Indian passport for Passport renewal?',
  'I don\'t have landing paper. What should I do?',
  'How do I submit a Passport Surrender application?',
  'What happens if I write a generic greeting like Hello?'
]

interface FAQMatch {
  title: string
  content: string
  similarity?: number
}

interface PlaygroundResult {
  query: string
  expandedQuery?: string
  matchedSynonyms?: { alias: string; canonical: string }[]
  retrievalMode: 'vector' | 'keyword' | 'hybrid' | 'none'
  vectorResults: { id: string; title: string; content: string; similarity: number }[]
  vectorError: string | null
  keywordResults: { title: string; content: string }[]
  selectedFaqs: FAQMatch[]
  systemPrompt: string
  gptReply: string
  isRiseTicket: boolean
  callError: string | null
}

export default function PlaygroundPage() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [orgId, setOrgId] = useState<string | null>(null)
  const [result, setResult] = useState<PlaygroundResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedVectorIndex, setExpandedVectorIndex] = useState<number | null>(null)
  const [expandedKeywordIndex, setExpandedKeywordIndex] = useState<number | null>(null)

  useEffect(() => {
    async function loadOrg() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .maybeSingle()

          if (profile?.organization_id) {
            setOrgId(profile.organization_id)
            const { data: org } = await supabase
              .from('organizations')
              .select('name')
              .eq('id', profile.organization_id)
              .maybeSingle()
            if (org) {
              setOrgName(org.name)
            }
          }
        }
      } catch (err) {
        console.error('Failed to load organization settings:', err)
      }
    }
    loadOrg()
  }, [])

  const handleTest = async (testQuery: string) => {
    if (!testQuery.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    setExpandedVectorIndex(null)
    setExpandedKeywordIndex(null)

    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: testQuery.trim(), playground: true })
      })

      const text = await res.text()
      let data: any
      try {
        data = JSON.parse(text)
      } catch (err) {
        if (!res.ok) {
          throw new Error(`Server error (${res.status}): ${res.statusText || 'Unknown Error'}`)
        }
        throw new Error('Failed to parse server response as JSON')
      }

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to fetch diagnostic results')
      }

      setResult(data)
    } catch (err: any) {
      setError(err.message || 'Something went wrong while testing.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-8 bg-slate-50 dark:bg-[#0b141a] p-4 sm:p-6 lg:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#1f2c34] p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-emerald-500/10 rounded-full flex items-center justify-center text-[#00a884]">
              <Sparkles size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">WhatsApp Chatbot Playground</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Test and inspect similarity matching and chatbot replies for <span className="font-semibold text-[#00a884]">{orgName || 'your organization'}</span>.
              </p>
            </div>
          </div>
        </div>

        {/* Test Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left panel: Test Input */}
          <div className="lg:col-span-1 space-y-5">
            <div className="bg-white dark:bg-[#1f2c34] p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
              <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Run Test Query</h3>
              
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Type customer message:</label>
                <div className="relative">
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. Can I apply for PR extension?"
                    rows={3}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-[#2a3942] rounded-lg border border-slate-200 dark:border-transparent text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 resize-none leading-relaxed"
                  />
                </div>
              </div>

              <button
                onClick={() => handleTest(query)}
                disabled={loading || !query.trim()}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-[#00a884] hover:bg-[#008069] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Searching...</span>
                  </>
                ) : (
                  <>
                    <Play size={12} fill="white" />
                    <span>Run Diagnostic Test</span>
                  </>
                )}
              </button>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-lg text-[11px] text-red-600 dark:text-red-400 leading-relaxed flex items-start gap-2">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Presets */}
            <div className="bg-white dark:bg-[#1f2c34] p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Common Test Scenarios</h3>
              <div className="flex flex-col gap-1.5">
                {PRESET_QUERIES.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => { setQuery(q); handleTest(q); }}
                    disabled={loading}
                    className="w-full text-left p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg text-[11px] text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-800/40 hover:border-slate-200 hover:text-emerald-500 dark:hover:text-emerald-400 transition-all font-medium truncate"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Right panel: Diagnostics & Results */}
          <div className="lg:col-span-2 space-y-6">
            {!result && !loading && (
              <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs p-12 text-center flex flex-col items-center justify-center space-y-3 min-h-[400px]">
                <div className="h-12 w-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500">
                  <Terminal size={24} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Awaiting Test Executions</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1 mx-auto">
                    Type a question or select a preset query on the left to see how similarity search matches and how the chatbot replies.
                  </p>
                </div>
              </div>
            )}

            {loading && (
              <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs p-12 text-center flex flex-col items-center justify-center space-y-4 min-h-[400px]">
                <Loader2 size={36} className="animate-spin text-[#00a884]" />
                <div>
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Searching Knowledge Base</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1 mx-auto">
                    Searching match options, validating synonyms, and generating chatbot reply...
                  </p>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-6 animate-in fade-in duration-300">
                
                {/* 1. Retrieval Summary */}
                <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Search size={14} className="text-[#00a884]" /> AI Search Diagnostics
                    </h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      result.retrievalMode === 'hybrid'
                        ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400'
                        : result.retrievalMode === 'vector' 
                        ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                        : result.retrievalMode === 'keyword'
                        ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
                        : 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                    }`}>
                      Mode: {result.retrievalMode === 'hybrid' ? '🧬 Smart Matching' : result.retrievalMode === 'vector' ? '⚡ Semantic Matching' : result.retrievalMode === 'keyword' ? '🔍 Direct Word Matching' : '❌ No Matched FAQs'}
                    </span>
                  </div>

                  {result.matchedSynonyms && result.matchedSynonyms.length > 0 && (
                    <div className="mx-5 mt-4 p-3 bg-emerald-500/10 dark:bg-emerald-500/5 rounded-xl border border-emerald-500/20 text-[10px] text-slate-700 dark:text-slate-300 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider text-[9px]">🔍 Synonym Search Active</p>
                        <div className="flex flex-wrap items-center gap-1.5 font-medium">
                          <span>Original Message:</span> <span className="font-semibold text-slate-800 dark:text-slate-100 italic">"{result.query}"</span>
                          <span>➔</span>
                          <span>Searched With Synonyms:</span> <span className="font-semibold text-emerald-700 dark:text-emerald-300">"{result.expandedQuery}"</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Synonym Mapping:</span>
                        {result.matchedSynonyms.map((s, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-500/30">
                            {s.alias} ➔ {s.canonical}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Vector RPC matches */}
                    <div className="space-y-2 bg-slate-50 dark:bg-[#2a3942]/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800/40">
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">1. Semantic Matches (Meaning-Based)</p>
                      {result.vectorError ? (
                        <p className="text-[10px] text-red-500">{result.vectorError}</p>
                      ) : result.vectorResults.length === 0 ? (
                        <p className="text-[10px] text-slate-400">0 articles matched above similarity threshold</p>
                      ) : (
                        <div className="space-y-1.5">
                          {result.vectorResults.map((r, i) => (
                            <div key={i} className="flex flex-col text-[10px] text-slate-700 dark:text-slate-300 bg-white dark:bg-[#1f2c34] rounded border border-slate-100 dark:border-slate-850 overflow-hidden">
                              <button
                                onClick={() => setExpandedVectorIndex(expandedVectorIndex === i ? null : i)}
                                className="flex justify-between items-center w-full p-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors focus:outline-none"
                              >
                                <span className="truncate pr-2 font-medium">{r.title}</span>
                                <span className="font-bold text-emerald-500 flex-shrink-0 flex items-center gap-1.5">
                                  {(r.similarity * 100).toFixed(0)}%
                                  <span className="text-slate-400 text-[8px]">{expandedVectorIndex === i ? '▲' : '▼'}</span>
                                </span>
                              </button>
                              {expandedVectorIndex === i && (
                                <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/10 space-y-1.5 text-slate-600 dark:text-slate-400">
                                  <div className="space-y-0.5">
                                    <p className="font-bold text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">FAQ Title</p>
                                    <p className="font-medium text-slate-800 dark:text-slate-200">{r.title}</p>
                                  </div>
                                  <div className="space-y-0.5">
                                    <p className="font-bold text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">FAQ Answer</p>
                                    <p className="whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">{r.content || '(No content stored)'}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Keyword fallback matches */}
                    <div className="space-y-2 bg-slate-50 dark:bg-[#2a3942]/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800/40">
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">2. Direct Word Matches (Fallback)</p>
                      {result.keywordResults.length === 0 ? (
                        <p className="text-[10px] text-slate-400">0 articles matched in direct word lookup</p>
                      ) : (
                        <div className="space-y-1.5">
                          {result.keywordResults.map((r, i) => (
                            <div key={i} className="flex flex-col text-[10px] text-slate-700 dark:text-slate-300 bg-white dark:bg-[#1f2c34] rounded border border-slate-100 dark:border-slate-850 overflow-hidden">
                              <button
                                onClick={() => setExpandedKeywordIndex(expandedKeywordIndex === i ? null : i)}
                                className="flex justify-between items-center w-full p-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors focus:outline-none"
                              >
                                <span className="truncate pr-2 font-medium">{r.title}</span>
                                <span className="text-blue-500 font-bold flex-shrink-0 flex items-center gap-1.5">
                                  Direct Match
                                  <span className="text-slate-400 text-[8px]">{expandedKeywordIndex === i ? '▲' : '▼'}</span>
                                </span>
                              </button>
                              {expandedKeywordIndex === i && (
                                <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/10 space-y-1.5 text-slate-600 dark:text-slate-400">
                                  <div className="space-y-0.5">
                                    <p className="font-bold text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">FAQ Title</p>
                                    <p className="font-medium text-slate-800 dark:text-slate-200">{r.title}</p>
                                  </div>
                                  <div className="space-y-0.5">
                                    <p className="font-bold text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">FAQ Answer</p>
                                    <p className="whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">{r.content || '(No content stored)'}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. Matched FAQ Articles Sent to Chatbot */}
                <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Info size={14} className="text-blue-500" /> Matched FAQs Sent to Chatbot
                    </h3>
                  </div>
                  <div className="p-5 space-y-4 max-h-[300px] overflow-y-auto leading-relaxed">
                    {result.selectedFaqs.length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-slate-500 italic">No FAQ articles matching this question were found in the database. The chatbot will fall back to escalation rules.</p>
                    ) : (
                      result.selectedFaqs.map((faq, i) => (
                        <div key={i} className="space-y-1.5 p-3.5 bg-slate-50 dark:bg-[#202c33]/50 rounded-xl border border-slate-100 dark:border-slate-800/40">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200">Q: {faq.title}</p>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{faq.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 3. Chatbot Response Preview */}
                <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <MessageSquare size={14} className="text-indigo-500" /> Chatbot Response Preview
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        result.isRiseTicket 
                          ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400' 
                          : 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                      }`}>
                        🎟️ Escalate to Team: {result.isRiseTicket ? 'YES' : 'NO'}
                      </span>
                    </div>
                  </div>
                  <div className="p-5 space-y-4">
                    {/* Simulated Whatsapp Chat Container */}
                    <div className="bg-[#efeae2] dark:bg-[#0b141a] p-4 rounded-xl border border-slate-200 dark:border-slate-800/40 min-h-[120px] flex flex-col justify-end space-y-3"
                      style={{
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'300\' height=\'300\' viewBox=\'0 0 300 300\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23667781\' fill-opacity=\'0.04\'%3E%3Ccircle cx=\'25\' cy=\'25\' r=\'3\'/%3E%3Ccircle cx=\'75\' cy=\'50\' r=\'2\'/%3E%3Ccircle cx=\'150\' cy=\'25\' r=\'2.5\'/%3E%3Ccircle cx=\'225\' cy=\'75\' r=\'2\'/%3E%3Ccircle cx=\'50\' cy=\'125\' r=\'3\'/%3E%3Ccircle cx=\'175\' cy=\'150\' r=\'2\'/%3E%3Ccircle cx=\'275\' cy=\'175\' r=\'2.5\'/%3E%3Ccircle cx=\'100\' cy=\'200\' r=\'2\'/%3E%3Ccircle cx=\'250\' cy=\'250\' r=\'3\'/%3E%3Ccircle cx=\'50\' cy=\'275\' r=\'2\'/%3E%3Ccircle cx=\'200\' cy=\'100\' r=\'2\'/%3E%3C/g%3E%3C/svg%3E")',
                      }}>
                      {/* Customer bubble */}
                      <div className="flex justify-end">
                        <div className="max-w-[70%] bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] px-3.5 py-2 rounded-lg rounded-tr-none shadow-[0_1px_0.5px_rgba(11,20,26,.13)] text-xs leading-relaxed">
                          {result.query}
                        </div>
                      </div>
                      
                      {/* Bot bubble */}
                      <div className="flex justify-start animate-in fade-in duration-500">
                        <div className="max-w-[70%] bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] px-3.5 py-2 rounded-lg rounded-tl-none shadow-[0_1px_0.5px_rgba(11,20,26,.13)] text-xs leading-relaxed border-t border-transparent">
                          {result.gptReply || <span className="italic text-slate-400">No reply generated.</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Compiled Prompts Debugger */}
                <div className="bg-white dark:bg-[#1f2c34] rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Terminal size={14} className="text-slate-500" /> Compiled System Prompt sent to GPT-4o-mini
                    </h3>
                  </div>
                  <div className="p-5">
                    <pre className="p-4 bg-slate-900 text-slate-300 rounded-xl overflow-x-auto text-[10px] leading-relaxed font-mono whitespace-pre-wrap max-h-[300px]">
                      {result.systemPrompt}
                    </pre>
                  </div>
                </div>

              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  )
}
