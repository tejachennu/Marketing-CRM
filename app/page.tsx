'use client'

import { useState } from 'react'
import Link from 'next/link'
import { 
  MessageCircle, ArrowRight, Shield, Mail, Phone, 
  Bot, Zap, Sparkles, Check, Send, Star, HelpCircle,
  Coins, Key, Lock, ArrowUpRight, CheckCircle2, ChevronRight
} from 'lucide-react'

export default function LandingPage() {
  // State for Contact Sales Form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formSuccess, setFormSuccess] = useState(false)

  // State for interactive savings calculator
  const [messageVolume, setMessageVolume] = useState(25000) // number of messages/month

  // Cost calculation details
  // Traditional CRM charges ~$0.02 per message (with markup) + $120/seat
  // BYOK wholesale cost (Twilio/SendGrid/OpenAI direct) averages ~$0.005 per message + flat BYOK CRM fee
  const seatCount = 5
  const traditionalCost = (seatCount * 120) + (messageVolume * 0.02)
  const byokCost = 79 + (messageVolume * 0.005) // Professional plan ($79) + wholesale API charges
  const savings = Math.max(0, Math.round(traditionalCost - byokCost))

  const handleSubmitContact = (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setTimeout(() => {
      setIsSubmitting(false)
      setFormSuccess(true)
      setName('')
      setEmail('')
      setCompany('')
      setMessage('')
      setTimeout(() => setFormSuccess(false), 5000)
    }, 1000)
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-[#f8fafc] font-sans antialiased overflow-x-hidden relative">
      
      {/* ━━━ BACKGROUND GLOW PATTERNS (MESH GRADIENTS) ━━━ */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] rounded-full bg-[#00a884]/10 blur-[120px] -z-10 pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[450px] h-[450px] rounded-full bg-[#3b82f6]/5 blur-[120px] -z-10 pointer-events-none" />
      <div className="absolute bottom-1/4 left-10 w-[600px] h-[600px] rounded-full bg-[#008069]/5 blur-[150px] -z-10 pointer-events-none" />

      {/* Grid Pattern overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-[0.15] -z-20 pointer-events-none" />

      {/* ━━━ GLASSMORPHIC HEADER ━━━ */}
      <header className="sticky top-0 z-50 backdrop-blur-lg bg-[#090d16]/75 border-b border-slate-800 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-[#00a884] to-[#008069] flex items-center justify-center shadow-lg text-white">
              <Key size={18} className="rotate-45" />
            </div>
            <span className="font-extrabold text-lg tracking-tight text-white">
              Byok<span className="text-[#00a884]">CRM</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-xs font-bold text-slate-400">
            <a href="#features" className="hover:text-[#00a884] transition-colors">Features</a>
            <a href="#economics" className="hover:text-[#00a884] transition-colors">BYOK Economics</a>
            <a href="#pricing" className="hover:text-[#00a884] transition-colors">Pricing</a>
            <a href="#contact" className="hover:text-[#00a884] transition-colors">Contact Sales</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link 
              href="/login" 
              className="text-xs font-bold text-slate-300 hover:text-white px-4 py-2 transition-colors"
            >
              Sign In
            </Link>
            <Link 
              href="/signup" 
              className="bg-[#00a884] hover:bg-[#008069] text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg hover:shadow-[#00a884]/20 transition-all duration-200 active:scale-[0.98]"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      {/* ━━━ HERO SECTION ━━━ */}
      <section className="relative pt-20 pb-24 md:pt-28 md:pb-36">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          
          {/* Glowing Badge */}
          <div className="inline-flex items-center gap-2 bg-[#00a884]/10 border border-[#00a884]/30 text-[#00a884] px-4 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase mb-8 shadow-[0_0_15px_rgba(0,168,132,0.1)]">
            <Lock size={11} />
            <span>100% Tenant Isolation & Cost Autonomy</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.1] max-w-4xl mx-auto mb-6">
            The Omnichannel AI CRM <br />
            <span className="bg-gradient-to-r from-[#00a884] via-[#059669] to-[#3b82f6] bg-clip-text text-transparent">
              Powered by Your Own Keys
            </span>
          </h1>

          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto mb-10 font-medium leading-relaxed">
            Connect your own messaging, email, and AI gateway integrations. Experience zero markup on messaging tokens, secure database level multitenancy, and total API sovereign control.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center w-full max-w-md mx-auto mb-16">
            <Link 
              href="/signup" 
              className="w-full sm:w-auto bg-[#00a884] hover:bg-[#008069] text-white text-xs font-bold px-8 py-4 rounded-xl shadow-xl shadow-[#00a884]/10 hover:shadow-[#00a884]/20 transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <span>Deploy Your Workspace</span>
              <ArrowRight size={14} />
            </Link>
            <a 
              href="#economics" 
              className="w-full sm:w-auto bg-slate-900/80 hover:bg-slate-800 text-[#f8fafc] text-xs font-bold px-8 py-4 rounded-xl border border-slate-800 transition-all text-center"
            >
              Calculate Savings
            </a>
          </div>

          {/* Premium UI Dashboard Preview */}
          <div className="max-w-5xl mx-auto bg-slate-950/80 rounded-2xl border border-slate-800 p-3 shadow-[0_0_50px_rgba(0,168,132,0.05)] relative group">
            {/* Ambient border glow effect */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-[#00a884]/20 to-[#3b82f6]/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none -z-10" />
            
            <div className="rounded-xl border border-slate-800/80 overflow-hidden bg-[#0d141c] h-[400px] flex flex-col relative text-left">
              
              {/* App Bar Mock */}
              <div className="h-14 bg-[#1e2630] border-b border-slate-800 px-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-[#00a884] flex items-center justify-center text-white font-bold text-xs shadow-md">
                    <Key size={14} className="rotate-45" />
                  </div>
                  <div>
                    <h5 className="text-[11px] font-extrabold text-white leading-none">ByokCRM Panel</h5>
                    <span className="text-[9px] text-[#00a884] font-bold block mt-1">● Active Workspace (canada-tenant)</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex items-center gap-1.5 bg-[#00a884]/10 border border-[#00a884]/20 text-[#00a884] text-[9px] font-extrabold px-3 py-1 rounded-lg">
                    <span>SMS/WhatsApp: Active</span>
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[9px] font-extrabold px-3 py-1 rounded-lg">
                    <span>OpenAI: Active</span>
                  </div>
                  <div className="h-2.5 w-2.5 rounded-full bg-[#00a884] animate-pulse" />
                </div>
              </div>

              {/* Main Area */}
              <div className="flex-1 flex overflow-hidden">
                
                {/* Mock Sidebar */}
                <div className="w-1/3 border-r border-slate-800 bg-[#0f1722] hidden md:block p-4">
                  <div className="h-8 bg-[#1e2630] rounded-lg mb-4 flex items-center px-3 text-[10px] text-slate-500 font-bold">Search conversations...</div>
                  <div className="space-y-2">
                    <div className="bg-[#1e2630] p-3 rounded-xl border border-slate-800 border-l-3 border-l-[#00a884] flex items-center gap-3">
                      <div className="h-7 w-7 rounded-full bg-slate-700 flex items-center justify-center font-bold text-[10px] text-slate-300">BC</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <h6 className="text-[10px] font-extrabold text-white truncate">BLS Canada Support</h6>
                          <span className="text-[8px] text-[#00a884] font-bold">10:14 AM</span>
                        </div>
                        <p className="text-[9px] text-slate-400 truncate mt-0.5">Setup messaging credentials...</p>
                      </div>
                    </div>
                    <div className="p-3 hover:bg-[#1e2630]/30 rounded-xl flex items-center gap-3 cursor-pointer transition-all border border-transparent">
                      <div className="h-7 w-7 rounded-full bg-slate-700 flex items-center justify-center font-bold text-[10px] text-slate-400">US</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <h6 className="text-[10px] font-bold text-slate-400 truncate">Uday Chennu</h6>
                          <span className="text-[8px] text-slate-500">Yesterday</span>
                        </div>
                        <p className="text-[9px] text-slate-500 truncate mt-0.5">Campaign delivered successfully</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mock Chat Pane */}
                <div className="flex-1 flex flex-col justify-between p-5 bg-[#0b0f19] relative">
                  
                  {/* Messages */}
                  <div className="space-y-4 overflow-y-auto">
                    <div className="flex justify-start">
                      <div className="bg-[#1e2630] rounded-2xl rounded-tl-none p-3 max-w-[80%] border border-slate-800 text-left">
                        <p className="text-[11px] text-slate-200 leading-relaxed">
                          Hi, I would like to set up the voice calling agent. What details do I need to input under my CRM dashboard settings?
                        </p>
                        <span className="text-[8px] text-slate-500 text-right block mt-1.5 font-bold">10:14 AM</span>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <div className="bg-[#005c4b] rounded-2xl rounded-tr-none p-3 max-w-[80%] text-left shadow-md">
                        <p className="text-[11px] text-white leading-relaxed">
                          Hi there! Navigate to your <strong className="text-[#00a884]">Settings</strong> tab. You just need to enter your WhatsApp/SMS SID, Auth Token, and OpenAI API Key. We'll automatically set up your webhook endpoints instantly.
                        </p>
                        <span className="text-[8px] text-emerald-300 text-right block mt-1.5 font-bold">10:15 AM ● ✓✓</span>
                      </div>
                    </div>
                  </div>

                  {/* suggested responses / input bar */}
                  <div className="space-y-3 mt-4 pt-3 border-t border-slate-800">
                    <div className="flex gap-2 overflow-x-auto py-1">
                      <button className="bg-[#00a884]/10 border border-[#00a884]/25 text-[#00a884] text-[9px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap hover:bg-[#00a884]/20 transition-all flex items-center gap-1">
                        <Sparkles size={10} />
                        <span>AI: How to configure WhatsApp</span>
                      </button>
                      <button className="bg-[#1e2630] border border-slate-800 text-slate-300 text-[9px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap hover:bg-slate-800 transition-all">
                        <span>AI: View pricing FAQ</span>
                      </button>
                    </div>
                    <div className="h-10 bg-[#1e2630] border border-slate-800 rounded-xl flex items-center justify-between px-4">
                      <span className="text-[10px] text-slate-500 font-semibold">Type a message...</span>
                      <div className="flex items-center gap-3">
                        <Send size={13} className="text-[#00a884] cursor-pointer hover:text-white transition-colors" />
                      </div>
                    </div>
                  </div>

                </div>

              </div>

            </div>
          </div>
        </div>
      </section>

      {/* ━━━ THE ECONOMICS SECTION (INTERACTIVE CALCULATOR) ━━━ */}
      <section id="economics" className="py-20 md:py-28 border-t border-slate-900 bg-[#070a10]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-1.5 bg-emerald-500/10 text-[#00a884] px-3.5 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase mb-4">
              <Coins size={12} />
              <span>Cost Economics Comparison</span>
            </div>
            <h2 className="text-3xl font-black mb-4">Bypass the Middleman, Slash CRM Bills</h2>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed font-semibold">
              Traditional CRMs double or triple API token costs. With ByokCRM, you connect your own keys, paying wholesale prices directly to major messaging gateways, email servers, and AI gateways.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-5xl mx-auto items-center">
            
            {/* Interactive Calculator */}
            <div className="bg-slate-950 p-6 sm:p-8 rounded-2xl border border-slate-800 shadow-xl space-y-6">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Savings Calculator</h3>
              
              <div className="space-y-4">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-slate-400">Monthly Message/Call Volume</span>
                  <span className="text-[#00a884] font-mono text-sm">{messageVolume.toLocaleString()} messages</span>
                </div>
                <input
                  type="range"
                  min="5000"
                  max="150000"
                  step="5000"
                  value={messageVolume}
                  onChange={(e) => setMessageVolume(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[#00a884]"
                />
                <div className="flex justify-between text-[9px] text-slate-500 font-bold">
                  <span>5K /mo</span>
                  <span>75K /mo</span>
                  <span>150K /mo</span>
                </div>
              </div>

              {/* Side by side cost visualization */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-900">
                <div className="bg-[#1e1515] border border-red-900/30 p-4 rounded-xl">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-red-400">Traditional CRM Cost</span>
                  <p className="text-xl font-black text-red-500 mt-1">${Math.round(traditionalCost)}<span className="text-[9px] font-bold text-slate-500">/mo</span></p>
                  <p className="text-[8px] text-slate-400 mt-2 font-semibold">Includes seat fees + 300% markup on API messages.</p>
                </div>
                <div className="bg-[#0e1c18] border border-emerald-900/30 p-4 rounded-xl">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#00a884]">ByokCRM Cost</span>
                  <p className="text-xl font-black text-[#00a884] mt-1">${Math.round(byokCost)}<span className="text-[9px] font-bold text-slate-500">/mo</span></p>
                  <p className="text-[8px] text-slate-400 mt-2 font-semibold">Flat software fee + raw direct-to-provider wholesale cost.</p>
                </div>
              </div>

              <div className="bg-[#00a884]/10 border border-[#00a884]/20 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-300">Your Monthly Savings</h4>
                  <p className="text-base text-white font-extrabold mt-1">Save up to <span className="text-[#00a884]">${savings.toLocaleString()} / month</span></p>
                </div>
                <div className="bg-[#00a884] text-white text-[9px] font-black px-3.5 py-2 rounded-lg uppercase">
                  {Math.round((savings / traditionalCost) * 100)}% Saved
                </div>
              </div>
            </div>

            {/* Explanatory content */}
            <div className="space-y-6 text-left">
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-[#00a884] flex-shrink-0">
                  <Coins size={16} />
                </div>
                <div>
                  <h4 className="text-xs font-black text-white">Wholesale Pricing Autonomy</h4>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed font-semibold">
                    Cut out standard middleware fees. Connect directly to messaging networks for SMS at ~$0.0079/msg, email servers at ~$0.0075/10 emails, and AI engines at ~$0.002/1K tokens.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-[#00a884] flex-shrink-0">
                  <Lock size={16} />
                </div>
                <div>
                  <h4 className="text-xs font-black text-white">No Seat-Count Lock-In</h4>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed font-semibold">
                    Unlike traditional CRMs that penalize team growth, we charge a flat software fee. Add team members, agents, and admins with no incremental charges.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-[#00a884] flex-shrink-0">
                  <Shield size={16} />
                </div>
                <div>
                  <h4 className="text-xs font-black text-white">Dedicated API Security</h4>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed font-semibold">
                    All credentials are encrypted and stored inside organization-scoped variables in your databases. Your credentials never pool or leak to other tenants.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ━━━ DETAILED FEATURES LIST ━━━ */}
      <section id="features" className="py-20 md:py-24 border-t border-slate-900 bg-[#090d16]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-2xl sm:text-3xl font-black text-white mb-4">
              Premium CRM Modules at Flat Software Rates
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed font-semibold">
              Get all high-end communication features deployed instantly under your own developer accounts.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 hover:border-[#00a884]/30 hover:shadow-[0_0_20px_rgba(0,168,132,0.05)] transition-all duration-300 group flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-[#00a884] mb-5 group-hover:scale-110 transition-transform">
                  <MessageCircle size={20} />
                </div>
                
                {/* Visual Mockup - High Fidelity Chat Inbox */}
                <div className="bg-[#0f1722] rounded-xl mb-5 border border-slate-800 flex flex-col h-32 overflow-hidden relative select-none">
                  {/* Mock App Header */}
                  <div className="h-7 bg-[#1e2630] border-b border-slate-800 px-3 flex items-center justify-between text-[7px] text-slate-400">
                    <span className="font-bold text-white">BLS Canada Support</span>
                    <span className="bg-[#00a884]/20 text-[#00a884] font-extrabold px-1.5 py-0.5 rounded text-[6px]">WhatsApp</span>
                  </div>
                  {/* Chat Area */}
                  <div className="flex-1 p-2.5 bg-[#0b0f19] flex flex-col gap-2 justify-end">
                    <div className="bg-[#1e2630] p-2 rounded-lg rounded-tl-none border border-slate-800 max-w-[80%] self-start text-[7px] text-slate-300 leading-tight">
                      How do I configure my credentials?
                    </div>
                    <div className="bg-[#005c4b] p-2 rounded-lg rounded-tr-none max-w-[80%] self-end text-[7px] text-white leading-tight">
                      Open Settings, fill the keys, and your webhook triggers!
                      <span className="text-emerald-300 font-bold text-[6px] block text-right mt-1">10:15 AM ● ✓✓</span>
                    </div>
                  </div>
                </div>

                <h3 className="text-sm font-black text-white mb-2">WhatsApp Web style Inbox</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed font-semibold">
                  An intuitive workspace optimized to mimic WhatsApp Web. Real-time WebSocket syncing, AM/PM timestamps, checkmark ticks, and reply-quoting.
                </p>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 hover:border-[#00a884]/30 hover:shadow-[0_0_20px_rgba(0,168,132,0.05)] transition-all duration-300 group flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-[#00a884] mb-5 group-hover:scale-110 transition-transform">
                  <Zap size={20} />
                </div>

                {/* Visual Mockup - High Fidelity Campaign Excel Mapper */}
                <div className="bg-[#0f1722] rounded-xl mb-5 border border-slate-800 flex flex-col h-32 overflow-hidden relative select-none">
                  {/* Mock App Header */}
                  <div className="h-7 bg-[#1e2630] border-b border-slate-800 px-3 flex items-center justify-between text-[7px] text-slate-400">
                    <span className="font-bold text-white">Campaign Wizard</span>
                    <span className="text-slate-400 text-[6px] font-bold">Step 3 of 4</span>
                  </div>
                  {/* Campaign Area */}
                  <div className="flex-1 p-3 bg-[#0b0f19] flex flex-col gap-2 justify-center">
                    <div className="flex items-center justify-between text-[7px] bg-[#1e2630] p-1.5 rounded border border-slate-800">
                      <span className="text-slate-300 font-bold">📄 contacts_list.xlsx</span>
                      <span className="text-[#00a884] font-extrabold text-[6px]">124 Rows</span>
                    </div>
                    <div className="bg-[#1e2630]/40 border border-slate-800/80 p-2 rounded flex items-center justify-between text-[7px]">
                      <span className="text-slate-400 font-semibold">Map variable {"`{{name}}`"}</span>
                      <span className="bg-[#00a884] text-white font-bold px-2 py-0.5 rounded text-[6px]">Col A (Name)</span>
                    </div>
                  </div>
                </div>

                <h3 className="text-sm font-black text-white mb-2">Excel Campaign Broadcasts</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed font-semibold">
                  Drag-and-drop spreadsheets (`.xlsx`/`.csv`) and auto-map variables like {"`{{name}}`"} or {"`{{code}}`"}. Dispatch templates or freeform texts instantly.
                </p>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 hover:border-[#00a884]/30 hover:shadow-[0_0_20px_rgba(0,168,132,0.05)] transition-all duration-300 group flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-[#00a884] mb-5 group-hover:scale-110 transition-transform">
                  <Phone size={20} />
                </div>

                {/* Visual Mockup - High Fidelity Node Graph */}
                <div className="bg-[#0f1722] rounded-xl mb-5 border border-slate-800 flex flex-col h-32 overflow-hidden relative select-none bg-[radial-gradient(#1e293b_1px,transparent_1px)] bg-[size:8px_8px]">
                  {/* Mock App Header */}
                  <div className="h-7 bg-[#1e2630]/80 border-b border-slate-800 px-3 flex items-center justify-between text-[7px] text-slate-400">
                    <span className="font-bold text-white">IVR Builder: Canada Menu</span>
                    <span className="bg-emerald-500/20 text-[#00a884] font-extrabold px-1.5 py-0.5 rounded text-[6px]">Active</span>
                  </div>
                  {/* Flow Canvas */}
                  <div className="flex-1 p-2 flex flex-col items-center justify-center gap-1.5">
                    <div className="bg-[#1e2630] border border-slate-800 px-2 py-0.5 rounded text-[7px] text-white font-bold shadow-sm">
                      📞 Trigger: Incoming Call
                    </div>
                    <div className="h-2 w-px bg-[#00a884]" />
                    <div className="bg-[#0c1a16] border border-[#00a884]/30 px-3 py-1.5 rounded text-[7px] text-slate-200 text-center max-w-[90%] shadow-sm">
                      <div className="font-bold text-[#00a884]">Gather Digits Node</div>
                      <div className="text-[6px] text-slate-400 mt-0.5">Press 1 for Sales, 2 for Support</div>
                    </div>
                  </div>
                </div>

                <h3 className="text-sm font-black text-white mb-2">IVR Visual Call-Flow Builder</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed font-semibold">
                  Design custom telephone menu trees visually. Configure Gather nodes, DTMF digit routing (1, 2, 3), dial transfers, and voicemail recorders.
                </p>
              </div>
            </div>

            {/* Feature 4 */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 hover:border-[#00a884]/30 hover:shadow-[0_0_20px_rgba(0,168,132,0.05)] transition-all duration-300 group flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-[#00a884] mb-5 group-hover:scale-110 transition-transform">
                  <Bot size={20} />
                </div>

                {/* Visual Mockup - High Fidelity AI phone bot */}
                <div className="bg-[#0f1722] rounded-xl mb-5 border border-slate-800 flex flex-col h-32 overflow-hidden relative select-none">
                  {/* Mock App Header */}
                  <div className="h-7 bg-[#1e2630] border-b border-slate-800 px-3 flex items-center justify-between text-[7px] text-slate-400">
                    <span className="font-bold text-white">AI Calling Bot</span>
                    <span className="bg-blue-500/20 text-blue-400 font-extrabold px-1.5 py-0.5 rounded text-[6px] animate-pulse">Call active</span>
                  </div>
                  {/* Calling Area */}
                  <div className="flex-1 p-2 bg-[#0b0f19] flex items-center justify-between gap-2 px-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-[#00a884]/15 border border-[#00a884]/30 flex items-center justify-center text-[#00a884] shadow-sm flex-shrink-0">
                        <Bot size={14} className="animate-bounce" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[8px] font-bold text-white leading-none">+1 (318) 506-9063</div>
                        <span className="text-[6px] text-slate-400 font-bold block mt-1">Speaker: John Doe</span>
                      </div>
                    </div>
                    {/* Live Waveform columns */}
                    <div className="flex gap-1 items-center h-6">
                      <span className="w-[3px] bg-[#00a884] rounded-full h-3 animate-pulse" />
                      <span className="w-[3px] bg-[#00a884] rounded-full h-5 animate-pulse" style={{ animationDelay: '0.2s' }} />
                      <span className="w-[3px] bg-[#00a884] rounded-full h-2 animate-pulse" style={{ animationDelay: '0.4s' }} />
                      <span className="w-[3px] bg-[#00a884] rounded-full h-4 animate-pulse" style={{ animationDelay: '0.1s' }} />
                    </div>
                  </div>
                  {/* Extracted badges */}
                  <div className="h-6 bg-[#1e2630]/60 border-t border-slate-800 px-3 flex items-center gap-2 text-[6px] font-bold text-slate-400">
                    <span>Parsed:</span>
                    <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded text-[5px]">Name: John</span>
                    <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded text-[5px]">Budget: $5K</span>
                  </div>
                </div>

                <h3 className="text-sm font-black text-white mb-2">Realtime AI calling agent</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed font-semibold">
                  Stream telephone audio directly to real-time AI speech models. Automatically extract customer variables during live voice chats and sync them to your contact database instantly.
                </p>
              </div>
            </div>

            {/* Feature 5 */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 hover:border-[#00a884]/30 hover:shadow-[0_0_20px_rgba(0,168,132,0.05)] transition-all duration-300 group flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-[#00a884] mb-5 group-hover:scale-110 transition-transform">
                  <Sparkles size={20} />
                </div>

                {/* Visual Mockup - High Fidelity RAG Crawler */}
                <div className="bg-[#0f1722] rounded-xl mb-5 border border-slate-800 flex flex-col h-32 overflow-hidden relative select-none">
                  {/* Mock App Header */}
                  <div className="h-7 bg-[#1e2630] border-b border-slate-800 px-3 flex items-center justify-between text-[7px] text-slate-400">
                    <span className="font-bold text-white">Sitemap Scraper RAG</span>
                    <span className="text-slate-400 text-[6px] font-bold">Crawling website...</span>
                  </div>
                  {/* RAG Area */}
                  <div className="flex-1 p-3 bg-[#0b0f19] flex flex-col gap-2 justify-center">
                    <div className="flex items-center justify-between text-[7px]">
                      <span className="text-slate-300 font-bold">helpdesk.com/sitemap.xml</span>
                      <span className="text-[#00a884] font-extrabold">85% Complete</span>
                    </div>
                    {/* Progress Bar */}
                    <div className="w-full h-1.5 bg-slate-850 rounded-full overflow-hidden">
                      <div className="bg-[#00a884] h-full rounded-full w-[85%] animate-pulse" />
                    </div>
                    <div className="flex items-center justify-between text-[6px] text-slate-400 bg-[#1e2630]/50 p-1.5 rounded border border-slate-800/80">
                      <span>✓ Crawled /refund-policy</span>
                      <span className="text-[#00a884] font-bold">Indexed</span>
                    </div>
                  </div>
                </div>

                <h3 className="text-sm font-black text-white mb-2">AI Copilot & Sitemap RAG</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed font-semibold">
                  Crawl site indices recursively to compile your customer support knowledge base. Instantly query and display matches in the operator chat interface.
                </p>
              </div>
            </div>

            {/* Feature 6 */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 hover:border-[#00a884]/30 hover:shadow-[0_0_20px_rgba(0,168,132,0.05)] transition-all duration-300 group flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-[#00a884] mb-5 group-hover:scale-110 transition-transform">
                  <Mail size={20} />
                </div>

                {/* Visual Mockup - High Fidelity Email Composer */}
                <div className="bg-[#0f1722] rounded-xl mb-5 border border-slate-800 flex flex-col h-32 overflow-hidden relative select-none">
                  {/* Mock App Header */}
                  <div className="h-7 bg-[#1e2630] border-b border-slate-800 px-3 flex items-center justify-between text-[7px] text-slate-400">
                    <span className="font-bold text-white">Email Editor</span>
                    <div className="flex gap-2 text-[6px] font-extrabold">
                      <span className="text-[#00a884] border-b border-b-[#00a884] pb-0.5">Visual</span>
                      <span className="text-slate-500">HTML Code</span>
                    </div>
                  </div>
                  {/* Email Composer Area */}
                  <div className="flex-1 p-2 bg-[#0b0f19] flex flex-col gap-2 justify-center">
                    {/* Fake text editor toolbar */}
                    <div className="flex gap-1.5 bg-[#1e2630] p-1.5 rounded border border-slate-800 text-[6px] font-bold text-slate-400">
                      <span className="px-1.5 bg-slate-800 text-white rounded">B</span>
                      <span className="px-1.5">I</span>
                      <span className="px-1.5">U</span>
                      <span className="px-1.5 border-l border-slate-800/80 pl-1.5">Align</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 rounded p-2 flex flex-col gap-1.5 text-slate-400">
                      <div className="h-1.5 w-14 bg-[#00a884]/20 rounded-md" />
                      <div className="h-1 bg-slate-800 rounded w-full" />
                      <div className="h-2 w-16 bg-[#00a884] rounded self-center mt-0.5 shadow-sm" />
                    </div>
                  </div>
                </div>

                <h3 className="text-sm font-black text-white mb-2">HTML Email Campaigns</h3>
                <p className="text-[11px] text-slate-400 leading-relaxed font-semibold">
                  Compose visual HTML messages with our rich text toolbar or paste developer templates. Preview designs safely inside isolated iframe sandboxes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ PRICING PLANS ━━━ */}
      <section id="pricing" className="py-20 md:py-24 border-t border-slate-900 bg-[#070a10]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-2xl sm:text-3xl font-black text-white mb-4">
              Flat Software Rates. Zero API Markups.
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed font-semibold">
              Bring your own API keys. Scale your team size and message volume without premium seat charges.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Starter Plan */}
            <div className="bg-slate-950 p-8 rounded-2xl border border-slate-850 flex flex-col justify-between shadow-sm relative">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-1">Starter</h4>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-black text-white">$29</span>
                  <span className="text-[11px] text-slate-500 font-bold">/ month</span>
                </div>
                <p className="text-[10px] text-slate-400 font-semibold mb-6 leading-relaxed">
                  Best for growing teams needing core chat systems and contact lists.
                </p>
                <div className="h-px bg-slate-850 w-full mb-6" />
                <ul className="space-y-3 mb-8 text-[11px] font-semibold text-slate-200">
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>3 Team Members</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>Single Gateway Account integration</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>Conversations Dashboard & Contacts</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>Dynamic Routing Webhooks</span></li>
                </ul>
              </div>
              <Link 
                href="/signup" 
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-sm text-center transition-colors block"
              >
                Start Trial
              </Link>
            </div>

            {/* Professional Plan */}
            <div className="bg-slate-950 p-8 rounded-2xl border-2 border-[#00a884] flex flex-col justify-between shadow-xl relative scale-105 z-10">
              <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#00a884] text-white text-[9px] font-bold px-3.5 py-1 rounded-full uppercase tracking-wider">Most Popular</span>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-[#00a884] mb-1">Professional</h4>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-black text-white">$79</span>
                  <span className="text-[11px] text-slate-500 font-bold">/ month</span>
                </div>
                <p className="text-[10px] text-slate-400 font-semibold mb-6 leading-relaxed">
                  Best for marketing teams needing automation, campaigns, and AI tools.
                </p>
                <div className="h-px bg-slate-850 w-full mb-6" />
                <ul className="space-y-3 mb-8 text-[11px] font-semibold text-slate-200">
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>15 Team Members</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>Excel Campaigns bulk dispatch</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>AI Copilot suggested replies</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>RAG Sitemap Crawling RAG</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>HTML Email Templates wizard</span></li>
                </ul>
              </div>
              <Link 
                href="/signup" 
                className="w-full py-2.5 bg-[#00a884] hover:bg-[#008069] text-white font-bold text-xs rounded-xl shadow-sm text-center transition-all block active:scale-[0.98]"
              >
                Start Trial
              </Link>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-slate-950 p-8 rounded-2xl border border-slate-850 flex flex-col justify-between shadow-sm relative">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-1">Enterprise</h4>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-black text-white">$199</span>
                  <span className="text-[11px] text-slate-500 font-bold">/ month</span>
                </div>
                <p className="text-[10px] text-slate-400 font-semibold mb-6 leading-relaxed">
                  Best for organizations running IVR workflows, realtime voice bots, and leaderboards.
                </p>
                <div className="h-px bg-slate-850 w-full mb-6" />
                <ul className="space-y-3 mb-8 text-[11px] font-semibold text-slate-200">
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>Unlimited Team Members</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>Voice IVR Call Trees Builder</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>Real-time AI voice streaming proxy</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>Sales Team performance leaderboard</span></li>
                  <li className="flex items-center gap-2"><Check size={14} className="text-[#00a884] flex-shrink-0" /> <span>Premium 24/7 Slack support</span></li>
                </ul>
              </div>
              <Link 
                href="/signup" 
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-sm text-center transition-colors block"
              >
                Start Trial
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ CONTACT SALES FORM ━━━ */}
      <section id="contact" className="py-20 md:py-28 border-t border-slate-900 bg-[#090d16]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 text-slate-400 px-3.5 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase mb-4">
                <HelpCircle size={12} />
                <span>Have questions?</span>
              </div>
              <h2 className="text-3xl font-black text-white mb-6 leading-tight">
                Connect with our CRM Platform Specialists
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed mb-6 font-semibold">
                Interested in dedicated database deployments, custom visual IVR steps, or large volume setups? Send a query and our solutions architects will respond in 2 hours.
              </p>

              {/* Reviews/Trust badge */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 flex items-center gap-4">
                <div className="flex text-amber-500">
                  <Star size={14} fill="currentColor" />
                  <Star size={14} fill="currentColor" />
                  <Star size={14} fill="currentColor" />
                  <Star size={14} fill="currentColor" />
                  <Star size={14} fill="currentColor" />
                </div>
                <div className="text-[10px] text-slate-400 font-bold">
                  "Decoupling token markup costs saved us over $14k last quarter!" – bls-canada Team
                </div>
              </div>
            </div>

            {/* Glassmorphic Contact Form */}
            <div className="bg-slate-950 p-6 sm:p-8 rounded-2xl border border-slate-850 shadow-lg relative">
              {formSuccess && (
                <div className="absolute inset-0 bg-[#0c1a17]/95 backdrop-blur-md rounded-2xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300 z-10 border border-[#00a884]/20">
                  <div className="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center text-white mb-4 shadow-sm">
                    <Check size={24} />
                  </div>
                  <h4 className="text-sm font-bold text-white mb-1">Message Sent Successfully!</h4>
                  <p className="text-[11px] text-slate-400 font-semibold leading-relaxed max-w-xs">
                    Thanks for reaching out! A solutions specialist will email you at your address shortly.
                  </p>
                </div>
              )}

              <form onSubmit={handleSubmitContact} className="space-y-4">
                <div>
                  <label htmlFor="name-input" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Your Name
                  </label>
                  <input
                    id="name-input"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full px-3 py-2.5 text-xs border border-slate-850 rounded-lg bg-[#0c121a] focus:outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] transition-all text-white"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="email-input" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                      Work Email
                    </label>
                    <input
                      id="email-input"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="john@company.com"
                      className="w-full px-3 py-2.5 text-xs border border-slate-850 rounded-lg bg-[#0c121a] focus:outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] transition-all text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="company-input" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                      Company Name
                    </label>
                    <input
                      id="company-input"
                      type="text"
                      required
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="Acme Corp"
                      className="w-full px-3 py-2.5 text-xs border border-slate-850 rounded-lg bg-[#0c121a] focus:outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] transition-all text-white"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="message-input" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    What features are you looking to test?
                  </label>
                  <textarea
                    id="message-input"
                    rows={4}
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Describe your use case..."
                    className="w-full px-3 py-2.5 text-xs border border-slate-850 rounded-lg bg-[#0c121a] focus:outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] transition-all text-white resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-[#00a884] hover:bg-[#008069] disabled:bg-[#a5e1d5] text-white text-xs font-bold py-3 rounded-xl shadow-lg shadow-[#00a884]/5 hover:shadow-[#00a884]/15 transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.98] mt-2 border border-[#00a884]/10"
                >
                  {isSubmitting ? (
                    <span>Submitting Inquiry...</span>
                  ) : (
                    <>
                      <span>Submit Inquiry</span>
                      <Send size={12} />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ FOOTER ━━━ */}
      <footer className="bg-[#05070a] text-slate-500 py-12 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-[#00a884] flex items-center justify-center text-white">
              <Key size={10} className="rotate-45" />
            </div>
            <span className="font-extrabold text-xs tracking-tight text-white">
              Byok<span className="text-[#00a884]">CRM</span>
            </span>
          </div>
          <p className="text-[10px] font-medium">&copy; {new Date().getFullYear()} ByokCRM Systems. All rights reserved.</p>
        </div>
      </footer>

    </div>
  )
}
