'use client'

import { useState, useEffect, useRef } from 'react'
import { 
  Sparkles, Mail, BarChart3, FileText, Bell, X, Send, Copy, Check, RotateCcw, 
  Smartphone, Monitor, Save, Plus, Trash2, Clock, Eye, Code, Layers, AlertTriangle, Info
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Contact } from '@/lib/types'

interface AssistantDrawerProps {
  isOpen: boolean
  onClose: () => void
  orgId: string
  orgName: string
}

type Tab = 'templates' | 'stats' | 'notes' | 'notifications'

// 4 Pre-designed Tailwind CSS Email Templates
const EMAIL_TEMPLATES = [
  {
    id: 'welcome',
    name: 'Welcome Onboarding',
    description: 'Clean welcome greeting with active CTA button and footer info.',
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Welcome Onboard</title>
</head>
<body class="bg-slate-50 font-sans p-6 text-slate-800">
  <div class="max-w-md mx-auto bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
    <div class="bg-gradient-to-r from-emerald-600 to-teal-500 p-6 text-white text-center">
      <h1 class="text-xl font-bold">Welcome Onboard!</h1>
      <p class="text-xs text-white/80 mt-1">We are excited to have you with us</p>
    </div>
    <div class="p-6 space-y-4">
      <p class="text-sm font-semibold">Hi {{first_name}},</p>
      <p class="text-xs leading-relaxed text-slate-550">Thank you for joining our platform. We are dedicated to providing the best tools to help grow your business. Click the button below to complete your onboarding setup.</p>
      <div class="text-center py-2">
        <a href="{{onboarding_link}}" class="inline-block bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-md transition-all">Get Started Now</a>
      </div>
      <p class="text-xs text-slate-400">If you have any questions, just reply directly to this email. We are here to help!</p>
    </div>
    <div class="bg-slate-50 p-4 border-t border-slate-100 text-center text-[10px] text-slate-400">
      &copy; {{company}} Inc. | All rights reserved.
    </div>
  </div>
</body>
</html>`
  },
  {
    id: 'newsletter',
    name: 'Monthly Newsletter',
    description: 'Hero header, multi-column release updates, and social details.',
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Monthly Updates</title>
</head>
<body class="bg-slate-50 font-sans p-6 text-slate-800">
  <div class="max-w-md mx-auto bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
    <div class="p-6 border-b border-slate-100 text-center">
      <span class="text-xs font-bold tracking-wider text-emerald-600 uppercase">Product Bulletin</span>
      <h1 class="text-lg font-extrabold mt-1 text-slate-900">What's New in {{month}}</h1>
    </div>
    <div class="p-6 space-y-5">
      <div class="space-y-2">
        <h3 class="text-xs font-extrabold text-slate-800 uppercase">1. Dashboard Customizers</h3>
        <p class="text-xs text-slate-500 leading-relaxed">You can now customize your analytics reporting cards and export campaigns data directly to spreadsheets in one click.</p>
      </div>
      <div class="space-y-2">
        <h3 class="text-xs font-extrabold text-slate-800 uppercase">2. AI Copilot RAG Integration</h3>
        <p class="text-xs text-slate-500 leading-relaxed">Our AI response recommendation engine scans your manual knowledge base articles to generate high-quality replies instantly.</p>
      </div>
      <div class="text-center py-2">
        <a href="{{update_link}}" class="inline-block bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all">Read Release Notes</a>
      </div>
    </div>
    <div class="bg-slate-50 p-4 border-t border-slate-100 text-center text-[10px] text-slate-400">
      You are receiving this because you subscribed to {{company}} updates. <a href="{{unsubscribe_link}}" class="underline">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`
  },
  {
    id: 'invoice',
    name: 'Transactional Invoice',
    description: 'Clean invoice with a transaction details table and billing badge.',
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice Receipt</title>
</head>
<body class="bg-slate-50 font-sans p-6 text-slate-800">
  <div class="max-w-md mx-auto bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
    <div class="p-6 border-b border-slate-100">
      <div class="flex justify-between items-center">
        <span class="text-[10px] font-extrabold text-slate-400 tracking-wider">INVOICE {{invoice_number}}</span>
        <span class="bg-emerald-100 text-emerald-800 text-[9px] font-bold px-2 py-0.5 rounded-full">PAID</span>
      </div>
      <h2 class="text-sm font-bold text-slate-900 mt-2">Thank you for your purchase!</h2>
    </div>
    <div class="p-6 space-y-4">
      <div class="bg-slate-50 p-4 rounded-xl space-y-2 text-xs">
        <div class="flex justify-between"><span class="text-slate-450">Customer:</span><span class="font-bold">{{first_name}}</span></div>
        <div class="flex justify-between"><span class="text-slate-450">Billing Date:</span><span>{{date}}</span></div>
      </div>
      <table class="w-full text-xs text-left border-collapse">
        <thead>
          <tr class="border-b border-slate-100 text-slate-400"><th class="py-2">Item</th><th class="py-2 text-right">Price</th></tr>
        </thead>
        <tbody>
          <tr class="border-b border-slate-100/50"><td class="py-2.5 font-medium">{{product_name}}</td><td class="py-2.5 text-right font-semibold">{{price}}</td></tr>
          <tr class="font-bold text-slate-900"><td class="py-3">Total Charged</td><td class="py-3 text-right">{{price}}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="bg-slate-50 p-4 border-t border-slate-100 text-center text-[10px] text-slate-400">
      Need help? Contact support at support@{{domain}}
    </div>
  </div>
</body>
</html>`
  },
  {
    id: 'promo',
    name: 'Promotional Coupon',
    description: 'Vibrant event discount banner, coupon code dash, and coupon details.',
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Exclusive Promo Code</title>
</head>
<body class="bg-slate-50 font-sans p-6 text-slate-800">
  <div class="max-w-md mx-auto bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden text-center">
    <div class="bg-gradient-to-br from-rose-500 to-amber-500 p-8 text-white">
      <span class="text-[9px] font-extrabold uppercase tracking-wider bg-white/20 px-3 py-1 rounded-full">Limited Offer</span>
      <h1 class="text-2xl font-black mt-3">Get {{discount}} OFF!</h1>
      <p class="text-xs text-white/80 mt-1">Exclusive promotion for our loyal customers</p>
    </div>
    <div class="p-6 space-y-4">
      <p class="text-xs text-slate-550">Hi {{first_name}}, use the code below at checkout to redeem your special discount on all premium subscription packages.</p>
      <div class="bg-slate-100 border-2 border-dashed border-slate-300 p-4 rounded-xl max-w-xs mx-auto text-center font-mono font-bold text-lg text-rose-600 tracking-wider">
        {{coupon_code}}
      </div>
      <p class="text-[9px] text-slate-400">This coupon code expires on {{expiration_date}} and cannot be combined with other offers.</p>
      <div class="pt-2">
        <a href="{{shop_link}}" class="inline-block bg-gradient-to-r from-rose-500 to-amber-500 hover:opacity-90 text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-md">Claim Discount Now</a>
      </div>
    </div>
    <div class="bg-slate-50 p-4 border-t border-slate-100 text-[10px] text-slate-400">
      &copy; {{company}} Inc. | <a href="{{privacy_link}}" class="underline">Privacy Policy</a>
    </div>
  </div>
</body>
</html>`
  }
]

export function AssistantDrawer({ isOpen, onClose, orgId, orgName }: AssistantDrawerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('templates')
  
  // Tab 2: Email Template Builder states
  const [templateCode, setTemplateCode] = useState('')
  const [templateName, setTemplateName] = useState('Welcome Template')
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [templatePrompt, setTemplatePrompt] = useState('')
  const [templateGenerating, setTemplateGenerating] = useState(false)
  const [templateGenError, setTemplateGenError] = useState<string | null>(null)
  
  // Tab 3: Stats States
  const [contactsCount, setContactsCount] = useState(0)
  const [tagEstimator, setTagEstimator] = useState<Array<{ name: string; count: number }>>([])
  const [loadingStats, setLoadingStats] = useState(false)

  // Tab 4: Notes & Tasks States
  const [notesText, setNotesText] = useState('')
  const [reminders, setReminders] = useState<Array<{ id: string; text: string; date: string; done: boolean }>>([])
  const [newReminderText, setNewReminderText] = useState('')
  const [newReminderDate, setNewReminderDate] = useState('')

  // Tab 5: Notifications States
  const [notifications, setNotifications] = useState<Array<{ id: string; msg: string; time: string }>>([])
  
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Copy helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedText(id)
    setTimeout(() => setCopiedText(null), 1500)
    addNotification(`Copied element ${id} to clipboard`)
  }

  // Add notification log helper
  const addNotification = (msg: string) => {
    const newNotif = {
      id: Date.now().toString(),
      msg,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }
    setNotifications(prev => [newNotif, ...prev].slice(0, 30))
    // Save to local storage
    const current = JSON.parse(localStorage.getItem('assistant_notifs') || '[]')
    localStorage.setItem('assistant_notifs', JSON.stringify([newNotif, ...current].slice(0, 30)))
  }

  // Load starter template on mount
  useEffect(() => {
    const matched = EMAIL_TEMPLATES.find(t => t.id === 'welcome')
    if (matched) {
      setTemplateCode(matched.html)
      setTemplateName(matched.name)
    }
  }, [])

  // Update iframe live preview
  useEffect(() => {
    if (!iframeRef.current) return
    const doc = iframeRef.current.contentDocument
    if (!doc) return
    doc.open()
    doc.write(`
      <html>
        <head>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body>
          ${templateCode}
        </body>
      </html>
    `)
    doc.close()
  }, [templateCode])

  // Load localStorage variables
  useEffect(() => {
    const storedNotes = localStorage.getItem('assistant_notes')
    if (storedNotes) setNotesText(storedNotes)
    
    const storedReminders = localStorage.getItem('assistant_reminders')
    if (storedReminders) setReminders(JSON.parse(storedReminders))

    const storedNotifs = localStorage.getItem('assistant_notifs')
    if (storedNotifs) setNotifications(JSON.parse(storedNotifs))
  }, [])

  // Fetch db stats/tags segment estimation
  useEffect(() => {
    if (!isOpen || !orgId) return
    
    async function loadStats() {
      setLoadingStats(true)
      try {
        const res = await fetch(`/api/contacts?organizationId=${orgId}&limit=200`)
        const data = await res.json()
        const contactsList: Contact[] = data.contacts || []
        
        setContactsCount(contactsList.length)
        
        // Tag Histogram calculator
        const tagMap: Record<string, number> = {}
        contactsList.forEach(c => {
          if (c.tags && Array.isArray(c.tags)) {
            c.tags.forEach(tag => {
              if (tag && tag.trim()) {
                const norm = tag.trim()
                tagMap[norm] = (tagMap[norm] || 0) + 1
              }
            })
          }
        })
        
        const est = Object.entries(tagMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
        setTagEstimator(est)
      } catch (err) {
        console.error('Failed to load stats tags:', err)
      } finally {
        setLoadingStats(false)
      }
    }
    
    loadStats()
  }, [isOpen, orgId])

  // Save Note Text
  const handleSaveNotes = (text: string) => {
    setNotesText(text)
    localStorage.setItem('assistant_notes', text)
  }

  // Reminders helper
  const handleAddReminder = () => {
    if (!newReminderText.trim()) return
    const reminder = {
      id: Date.now().toString(),
      text: newReminderText.trim(),
      date: newReminderDate || new Date().toISOString().slice(0, 16),
      done: false
    }
    const updated = [...reminders, reminder]
    setReminders(updated)
    localStorage.setItem('assistant_reminders', JSON.stringify(updated))
    setNewReminderText('')
    addNotification(`Reminder added: "${reminder.text}"`)
  }

  const handleToggleReminder = (id: string) => {
    const updated = reminders.map(r => r.id === id ? { ...r, done: !r.done } : r)
    setReminders(updated)
    localStorage.setItem('assistant_reminders', JSON.stringify(updated))
  }

  const handleDeleteReminder = (id: string) => {
    const updated = reminders.filter(r => r.id !== id)
    setReminders(updated)
    localStorage.setItem('assistant_reminders', JSON.stringify(updated))
  }

  // Clear notifs
  const handleClearNotifs = () => {
    setNotifications([])
    localStorage.removeItem('assistant_notifs')
  }



  // Save template in database
  const handleSaveTemplateToDb = async () => {
    if (!templateName.trim() || !templateCode.trim() || !orgId) {
      setSaveStatus('Error: Template name or code cannot be blank')
      return
    }
    setSaveLoading(true)
    setSaveStatus(null)
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: orgId,
          name: templateName,
          category: 'MARKETING',
          language: 'en',
          body: templateCode
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setSaveStatus('Success: Template saved successfully!')
      addNotification(`Saved email template "${templateName}" to campaigns`)
      setTimeout(() => setSaveStatus(null), 3000)
    } catch (err: any) {
      setSaveStatus(`Error: ${err.message || 'Failed to save template'}`)
    } finally {
      setSaveLoading(false)
    }
  }

  // Generate/rewrite template utilizing OpenAI
  const handleGenerateTemplateWithAi = async () => {
    if (!templatePrompt.trim() || !templateCode.trim()) {
      setTemplateGenError('Error: Please write a customization prompt and select/load a template first.')
      return
    }
    setTemplateGenerating(true)
    setTemplateGenError(null)
    try {
      const res = await fetch('/api/ai/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          prompt: templatePrompt,
          templateHtml: templateCode
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to customize template with AI.')
      setTemplateCode(data.customizedHtml)
      addNotification(`Successfully customized template with AI using prompt: "${templatePrompt.substring(0, 30)}..."`)
      setTemplatePrompt('')
    } catch (err: any) {
      setTemplateGenError(err.message || 'Failed to customize template with AI.')
    } finally {
      setTemplateGenerating(false)
    }
  }

  // Quick color palette themes replacement helper
  const handleApplyColorTheme = (themeName: 'emerald' | 'indigo' | 'sunset' | 'dark') => {
    let code = templateCode
    if (themeName === 'emerald') {
      code = code
        .replace(/from-(rose|indigo|slate)-\d+/g, 'from-emerald-600')
        .replace(/to-(amber|violet|slate)-\d+/g, 'to-teal-500')
        .replace(/bg-(rose|indigo|slate)-\d+/g, 'bg-emerald-600')
        .replace(/text-(rose|indigo|slate)-\d+/g, 'text-emerald-600')
        .replace(/border-(rose|indigo|slate)-\d+/g, 'border-emerald-500/20');
    } else if (themeName === 'indigo') {
      code = code
        .replace(/from-(emerald|rose|slate)-\d+/g, 'from-indigo-600')
        .replace(/to-(teal|amber|slate)-\d+/g, 'to-violet-500')
        .replace(/bg-(emerald|rose|slate)-\d+/g, 'bg-indigo-600')
        .replace(/text-(emerald|rose|slate)-\d+/g, 'text-indigo-600')
        .replace(/border-(emerald|rose|slate)-\d+/g, 'border-indigo-500/20');
    } else if (themeName === 'sunset') {
      code = code
        .replace(/from-(emerald|indigo|slate)-\d+/g, 'from-rose-500')
        .replace(/to-(teal|violet|slate)-\d+/g, 'to-amber-500')
        .replace(/bg-(emerald|indigo|slate)-\d+/g, 'bg-rose-500')
        .replace(/text-(emerald|indigo|slate)-\d+/g, 'text-rose-600')
        .replace(/border-(emerald|indigo|slate)-\d+/g, 'border-rose-500/20');
    } else if (themeName === 'dark') {
      code = code
        .replace(/bg-white/g, 'bg-slate-900 text-slate-100')
        .replace(/bg-slate-50/g, 'bg-slate-950')
        .replace(/text-slate-800/g, 'text-slate-100')
        .replace(/text-slate-500/g, 'text-slate-400')
        .replace(/border-slate-100/g, 'border-slate-850');
    }
    setTemplateCode(code)
    addNotification(`Applied color theme: ${themeName}`)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] max-w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg border-l border-slate-200/60 dark:border-slate-800/80 shadow-2xl z-50 flex flex-col overflow-hidden animate-in slide-in-from-right duration-300 font-sans text-slate-855 dark:text-slate-100">
      
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/20 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-lg bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white">
            <Sparkles size={13} className="animate-pulse" />
          </div>
          <div>
            <h3 className="text-xs font-black tracking-tight text-slate-900 dark:text-white leading-none">Marketing Assistant</h3>
            <span className="text-[9px] text-slate-400 font-bold block mt-1 uppercase">{orgName || 'Workspace'}</span>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-800 dark:hover:text-white rounded-lg transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Navigation tabs */}
      <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/10 shrink-0 p-1 justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400 select-none">
        <button 
          onClick={() => setActiveTab('templates')} 
          className={`flex-1 py-1.5 text-center rounded-lg transition-all ${activeTab === 'templates' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-450 shadow-xs' : 'hover:text-slate-855'}`}
        >
          Templates
        </button>
        <button 
          onClick={() => setActiveTab('stats')} 
          className={`flex-1 py-1.5 text-center rounded-lg transition-all ${activeTab === 'stats' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-450 shadow-xs' : 'hover:text-slate-855'}`}
        >
          Stats
        </button>
        <button 
          onClick={() => setActiveTab('notes')} 
          className={`flex-1 py-1.5 text-center rounded-lg transition-all ${activeTab === 'notes' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-450 shadow-xs' : 'hover:text-slate-855'}`}
        >
          Tasks
        </button>
        <button 
          onClick={() => setActiveTab('notifications')} 
          className={`flex-1 py-1.5 text-center rounded-lg transition-all ${activeTab === 'notifications' ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-450 shadow-xs' : 'hover:text-slate-855'}`}
        >
          Logs
        </button>
      </div>

      {/* Main Tab View */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Tab 2: Email Template Builder */}
        {activeTab === 'templates' && (
          <div className="space-y-4 animate-in fade-in duration-200">


            {/* AI Template Customizer UI */}
            <div className="bg-gradient-to-tr from-indigo-500/10 to-emerald-500/10 dark:from-indigo-950/20 dark:to-emerald-950/20 p-4 rounded-2xl border border-indigo-500/20 dark:border-indigo-500/30 space-y-3 shadow-md relative overflow-hidden">
              {/* Subtle background glow */}
              <div className="absolute -right-10 -bottom-10 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl pointer-events-none" />
              
              <h5 className="text-[11px] font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1">
                <Sparkles size={12} className="text-indigo-500 animate-pulse" />
                AI Template Customizer & Content Writer
              </h5>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 font-semibold leading-relaxed">
                Describe the campaign objectives, product details, discounts, or tone shifts. AI will rewrite the template text copy, buttons, and titles while keeping the responsive styles intact.
              </p>
              <div className="space-y-2.5">
                <textarea
                  value={templatePrompt}
                  onChange={(e) => setTemplatePrompt(e.target.value)}
                  placeholder="e.g. Customize this onboarding template for our sneaker launch, add a promo code SNEAKER20 with 20% off, and make the button link to /shop"
                  rows={3}
                  className="w-full px-3 py-2 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/50 dark:border-slate-700/60 rounded-xl focus:outline-none focus:border-indigo-500/50 text-[10.5px] font-medium leading-relaxed"
                />
                
                {templateGenError && (
                  <div className="p-2 rounded-xl text-[9px] font-bold border bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-450">
                    {templateGenError}
                  </div>
                )}
                
                <button
                  onClick={handleGenerateTemplateWithAi}
                  disabled={templateGenerating || !templatePrompt.trim()}
                  className="w-full py-2 bg-gradient-to-r from-indigo-650 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 text-white rounded-xl text-[10px] font-extrabold shadow-md shadow-indigo-500/10 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {templateGenerating ? (
                    <>
                      <Clock size={11} className="animate-spin" />
                      <span>AI is rewriting template HTML...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={11} />
                      <span>Customize Template with AI</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Themer selection */}
            <div className="bg-slate-50 dark:bg-slate-850 p-3 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
              <label className="block text-[9px] font-bold text-slate-400 uppercase">Quick-Theme Color Palettes</label>
              <div className="grid grid-cols-4 gap-1.5 text-[8.5px] font-bold text-center">
                <button 
                  onClick={() => handleApplyColorTheme('emerald')}
                  className="py-1 px-1.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-100"
                >
                  Emerald
                </button>
                <button 
                  onClick={() => handleApplyColorTheme('indigo')}
                  className="py-1 px-1.5 bg-indigo-50 dark:bg-indigo-955/20 border border-indigo-200/50 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100"
                >
                  Indigo
                </button>
                <button 
                  onClick={() => handleApplyColorTheme('sunset')}
                  className="py-1 px-1.5 bg-rose-50 dark:bg-rose-955/20 border border-rose-200/50 text-rose-600 dark:text-rose-450 rounded-lg hover:bg-rose-100"
                >
                  Sunset
                </button>
                <button 
                  onClick={() => handleApplyColorTheme('dark')}
                  className="py-1 px-1.5 bg-slate-900 border border-slate-800 text-white rounded-lg hover:bg-slate-850"
                >
                  Dark Mode
                </button>
              </div>
            </div>

            {/* Viewport & preview toggles */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-extrabold text-slate-500 uppercase flex items-center gap-1">
                  <Eye size={12} className="text-emerald-500" />
                  Live Preview
                </label>
                <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/30">
                  <button 
                    onClick={() => setViewport('desktop')}
                    className={`p-1.5 rounded-md ${viewport === 'desktop' ? 'bg-white dark:bg-slate-750 text-slate-800 dark:text-white shadow-xs' : 'text-slate-400'}`}
                    title="Desktop Preview"
                  >
                    <Monitor size={11} />
                  </button>
                  <button 
                    onClick={() => setViewport('mobile')}
                    className={`p-1.5 rounded-md ${viewport === 'mobile' ? 'bg-white dark:bg-slate-750 text-slate-800 dark:text-white shadow-xs' : 'text-slate-400'}`}
                    title="Mobile Viewport"
                  >
                    <Smartphone size={11} />
                  </button>
                </div>
              </div>

              {/* Preview Window Frame */}
              <div className="flex justify-center bg-slate-100 dark:bg-slate-950 p-2.5 rounded-2xl border border-slate-150 dark:border-slate-850">
                <div 
                  className="bg-white rounded-xl shadow-inner border border-slate-200/10 overflow-hidden transition-all duration-300 relative"
                  style={{ width: viewport === 'mobile' ? '280px' : '100%', height: '320px' }}
                >
                  <iframe 
                    ref={iframeRef}
                    className="w-full h-full border-0 select-none scale-90 origin-top"
                    title="Template Sandbox"
                  />
                </div>
              </div>
            </div>

            {/* Code Editor */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-extrabold text-slate-500 uppercase flex items-center gap-1">
                  <Code size={12} className="text-indigo-500" />
                  HTML / Tailwind Code Editor
                </label>
                <button 
                  onClick={() => handleCopy(templateCode, 'code')}
                  className="text-[9px] text-emerald-600 hover:text-emerald-500 font-bold flex items-center gap-0.5"
                >
                  {copiedText === 'code' ? <Check size={10} /> : <Copy size={10} />}
                  <span>{copiedText === 'code' ? 'Copied HTML' : 'Copy'}</span>
                </button>
              </div>
              <textarea 
                value={templateCode}
                onChange={(e) => setTemplateCode(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 bg-slate-900 text-slate-100 border border-slate-800 rounded-xl focus:outline-none text-[10px] font-mono leading-relaxed"
              />
            </div>

            {/* Save Template DB Controls */}
            <div className="bg-slate-50 dark:bg-slate-850 p-3.5 rounded-2xl border border-slate-150 dark:border-slate-800 space-y-3.5">
              <h5 className="text-[10.5px] font-bold text-slate-855 dark:text-white uppercase flex items-center gap-1">
                <Save size={12} className="text-emerald-500" />
                Save to Campaign Repository
              </h5>
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label className="block text-[9px] font-bold text-slate-400 uppercase">Template Name</label>
                  <input 
                    type="text" 
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g. Winter Sale Newsletter"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-700/60 rounded-xl focus:outline-none text-[11px] font-medium"
                  />
                </div>
                
                {saveStatus && (
                  <div className={`p-2 rounded-xl text-[9.5px] font-bold border ${saveStatus.startsWith('Success') ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
                    {saveStatus}
                  </div>
                )}
                
                <button
                  onClick={handleSaveTemplateToDb}
                  disabled={saveLoading || !templateName.trim()}
                  className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-650 text-white rounded-xl text-[10px] font-extrabold shadow-sm active:scale-98 transition-all flex items-center justify-center gap-1.5"
                >
                  {saveLoading && <Clock size={11} className="animate-spin" />}
                  <span>{saveLoading ? 'Saving...' : 'Save & Publish Template'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Workspace Stats */}
        {activeTab === 'stats' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Stats matrix card */}
            <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3">
              <h4 className="text-[11px] font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1">
                <BarChart3 size={12} className="text-emerald-500" />
                Workspace Marketing metrics
              </h4>
              
              {loadingStats ? (
                <div className="py-8 flex items-center justify-center gap-2 text-slate-450 text-xs">
                  <Clock size={12} className="animate-spin text-emerald-500" />
                  <span>Loading tags...</span>
                </div>
              ) : (
                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3 text-center text-xs">
                    <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-150 dark:border-slate-800/80 shadow-xs">
                      <span className="block text-[9px] text-slate-400 font-bold uppercase mb-1">Total Audience</span>
                      <span className="text-base font-black text-slate-800 dark:text-white">{contactsCount}</span>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-150 dark:border-slate-800/80 shadow-xs">
                      <span className="block text-[9px] text-slate-400 font-bold uppercase mb-1">Distinct Segments</span>
                      <span className="text-base font-black text-slate-800 dark:text-white">{tagEstimator.length}</span>
                    </div>
                  </div>

                  {/* Segment tag size checker */}
                  <div className="space-y-2">
                    <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Tag Reach Estimator</h5>
                    {tagEstimator.length === 0 ? (
                      <p className="text-[10px] text-slate-450 dark:text-slate-500 italic p-3 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-150 dark:border-slate-800/80">No active contact tags found.</p>
                    ) : (
                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-150 dark:border-slate-800/80 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/60 max-h-60 overflow-y-auto">
                        {tagEstimator.map(tag => (
                          <div key={tag.name} className="flex justify-between items-center p-2.5 text-[10.5px]">
                            <span className="font-semibold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200/30 dark:border-slate-700/30 text-slate-700 dark:text-slate-300">#{tag.name}</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">{tag.count} contacts ({Math.round(tag.count / contactsCount * 100)}%)</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Status Note card */}
                  <div className="bg-indigo-500/5 dark:bg-indigo-500/10 p-3 rounded-xl border border-indigo-500/10 text-[9.5px] leading-relaxed text-indigo-700 dark:text-indigo-300 font-medium flex gap-1.5 items-start">
                    <Info size={13} className="shrink-0 mt-0.5" />
                    <p>Estimations check all contact rows. Tag contacts under the <strong>Contacts</strong> workspace to build larger broadcast lists before launching email or SMS campaigns.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Notes & Tasks */}
        {activeTab === 'notes' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Notes Notepad */}
            <div className="space-y-2">
              <label className="text-[10px] font-extrabold text-slate-500 uppercase flex items-center gap-1">
                <FileText size={12} className="text-emerald-500" />
                Marketing Notepad
              </label>
              <textarea
                value={notesText}
                onChange={(e) => handleSaveNotes(e.target.value)}
                placeholder="Write campaign ideas, subject line variations, draft messages, or copy blocks here..."
                rows={6}
                className="w-full px-3.5 py-2.5 bg-slate-55 dark:bg-slate-905 border border-slate-200/60 dark:border-slate-800 focus:border-emerald-500/50 rounded-2xl focus:outline-none text-[11px] leading-relaxed text-slate-800 dark:text-slate-100 placeholder-slate-400 shadow-inner"
              />
              <span className="text-[8px] text-slate-400 font-bold block mt-0.5 text-right uppercase">Auto-saved in browser</span>
            </div>

            {/* Reminders list */}
            <div className="bg-slate-55 dark:bg-slate-850 p-4 rounded-2xl border border-slate-150 dark:border-slate-800 space-y-3">
              <h4 className="text-[11px] font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1">
                <Clock size={12} className="text-indigo-500" />
                Campaign Reminders
              </h4>
              
              {/* Add form */}
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Task title (e.g. Send Summer Newsletter)"
                  value={newReminderText}
                  onChange={(e) => setNewReminderText(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-700/60 rounded-xl focus:outline-none text-[10.5px] font-medium"
                />
                <div className="flex gap-2">
                  <input
                    type="datetime-local"
                    value={newReminderDate}
                    onChange={(e) => setNewReminderDate(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-700/60 rounded-xl focus:outline-none text-[10px] font-bold text-slate-500"
                  />
                  <button
                    onClick={handleAddReminder}
                    className="px-3 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-750 text-white rounded-xl text-[10px] font-black flex items-center justify-center gap-1"
                  >
                    <Plus size={12} />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              {/* Reminders List */}
              {reminders.length === 0 ? (
                <p className="text-[10px] text-slate-450 dark:text-slate-500 italic text-center py-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl">No pending tasks.</p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto pt-1">
                  {reminders.map(r => (
                    <div 
                      key={r.id} 
                      className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${r.done ? 'bg-slate-100/50 dark:bg-slate-900/40 border-slate-200/30 dark:border-slate-800/40 opacity-60' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800/80 shadow-xs'}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={r.done}
                          onChange={() => handleToggleReminder(r.id)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                        <div className="min-w-0">
                          <p className={`text-[10.5px] font-semibold truncate ${r.done ? 'line-through text-slate-450 dark:text-slate-500' : 'text-slate-850 dark:text-slate-100'}`}>{r.text}</p>
                          <p className="text-[8px] text-slate-400 font-bold block mt-0.5">{new Date(r.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteReminder(r.id)}
                        className="text-slate-400 hover:text-rose-500 p-1 rounded-lg hover:bg-slate-55 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 5: System Notifications Logs */}
        {activeTab === 'notifications' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-extrabold text-slate-500 uppercase flex items-center gap-1">
                <Bell size={12} className="text-emerald-500" />
                Operation Logs History
              </label>
              {notifications.length > 0 && (
                <button 
                  onClick={handleClearNotifs}
                  className="text-[9px] text-rose-550 hover:text-rose-450 font-extrabold"
                >
                  Clear Logs
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl select-none">
                No logs recorded in this session.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                {notifications.map(n => (
                  <div key={n.id} className="p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 rounded-xl text-[10px] leading-relaxed flex justify-between gap-3 text-slate-650 dark:text-slate-350">
                    <span className="font-semibold break-all">{n.msg}</span>
                    <span className="text-[8px] font-bold text-slate-400 shrink-0 mt-0.5">{n.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
