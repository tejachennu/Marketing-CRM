'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  Bot, Zap, Sparkles, ArrowRight, Check, Send, Star, 
  Coins, CheckCircle2, ChevronRight, TrendingUp, Users, Clock, 
  Flame, FileSpreadsheet, CheckCheck, Play, Calendar,
  ChevronDown, Globe, ShieldCheck, ShoppingBag, Target,
  Database, Lock, Menu, X, Smartphone, ArrowUpRight,
  Shield, MessageCircle, BarChart3, HelpCircle, Mail,
  Layers, Sliders, ExternalLink, RefreshCw, Ticket, 
  UserCheck, Tag, Upload, Download, Kanban, Phone,
  Headphones, Settings, Key, Palette, BookOpen, Workflow
} from 'lucide-react'

export default function LandingPage() {
  // Enforce light mode on homepage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  // Mobile navigation state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Interactive WhatsApp Chatbot Simulator State
  const [simulatorStep, setSimulatorStep] = useState<'intro' | 'meta' | 'bulk' | 'demo'>('intro')
  const [isTyping, setIsTyping] = useState(false)

  const handleSelectPrompt = (step: 'meta' | 'bulk' | 'demo') => {
    if (isTyping) return
    setIsTyping(true)
    setSimulatorStep(step)
    setTimeout(() => {
      setIsTyping(false)
    }, 550)
  }

  // FAQ Accordion State
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const faqs = [
    {
      q: "How does the WhatsApp AI Chatbot help increase sales?",
      a: "Most customers message when your team is offline. If you don't reply within 2 minutes, they buy elsewhere. Our AI Chatbot connects to your store catalog, answers product questions in under 2 seconds, qualifies buyer intent, and sends 1-tap checkout or appointment links 24/7."
    },
    {
      q: "How does WhatsApp Bulk Marketing beat traditional email?",
      a: "Email open rates have collapsed to 18%, with most lost in spam. WhatsApp delivers a massive 98.4% open rate, with 80% read within 5 minutes. You upload your Excel customer list, personalize names and offers, and send interactive messages with 1-tap action buttons."
    },
    {
      q: "How does the direct Meta WhatsApp Cloud API benefit my business?",
      a: "Traditional tools mark up message costs and charge per agent. WAMA connects directly to your official Meta Cloud API with zero markup, direct deliverability, pre-approved templates, and full enterprise security."
    },
    {
      q: "Will my WhatsApp number get banned during bulk broadcasts?",
      a: "No. We connect exclusively through the official Meta WhatsApp Cloud API using pre-approved verified templates and intelligent anti-ban safe pacing algorithms to protect your green badge and phone health."
    },
    {
      q: "Can my human sales team take over high-value conversations?",
      a: "Yes! Whenever a prospect reaches a high qualification score or asks to speak with an agent, the AI instantly routes the conversation to your shared team inbox with full chat history."
    }
  ]

  // Demo Form State
  const [demoSubmitted, setDemoSubmitted] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoForm, setDemoForm] = useState({
    name: '',
    email: '',
    phone: '',
    objective: 'Both AI Chatbot & Bulk Marketing'
  })

  const handleDemoSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setDemoLoading(true)
    setTimeout(() => {
      setDemoLoading(false)
      setDemoSubmitted(true)
      setTimeout(() => setDemoSubmitted(false), 5000)
    }, 800)
  }

  return (
    <div className="min-h-screen bg-[#fafbfa] text-[#141c18] font-sans antialiased selection:bg-[#27d34b] selection:text-[#0c2014]">
      
      {/* ━━━ TOP ANNOUNCEMENT PILL ━━━ */}
      <div className="bg-[#0c2014] text-white py-2.5 px-4 text-center text-xs font-medium border-b border-emerald-950/50 relative z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 flex-wrap">
          <span className="bg-[#27d34b]/20 text-[#27d34b] text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border border-[#27d34b]/30">
            2026 Meta Cloud Direct Tier
          </span>
          <span className="text-white/90">
            First 1,000 monthly WhatsApp conversations 100% free with 0% token markup.
          </span>
          <a href="#demo" className="text-[#27d34b] font-bold hover:underline inline-flex items-center gap-1 ml-1">
            Request Demo Access <ArrowRight size={12} />
          </a>
        </div>
      </div>

      {/* ━━━ HEADER NAVIGATION (AUTHENTIC OMNIENGAGE STYLE) ━━━ */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/90 border-b border-[#e9eeeb] transition-all">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3">
            <img 
              src="/wamacrm-logo.png" 
              alt="WAMACRM Logo" 
              className="h-10 w-10 rounded-xl object-contain shadow-sm border border-slate-100 bg-white" 
            />
            <div className="flex flex-col">
              <span className="font-extrabold text-base tracking-tight text-[#0c2014] leading-tight flex items-center gap-1.5">
                WAMACRM <span className="text-[#008069] text-xs font-bold px-1.5 py-0.5 bg-[#e8f5e9] rounded-md">AI</span>
              </span>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                WhatsApp Marketing Agent CRM
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden lg:flex items-center gap-6 text-[13.5px] font-semibold text-[#4a5852]">
            <a href="#showcase" className="hover:text-[#008069] transition flex items-center gap-1.5">
              <Zap size={14} className="text-[#008069]" />
              <span>Broadcasts</span>
            </a>
            <a href="#features-pipeline" className="hover:text-[#008069] transition flex items-center gap-1.5">
              <Kanban size={14} className="text-[#008069]" />
              <span>Sales Pipeline</span>
            </a>
            <a href="#features-ai" className="hover:text-[#008069] transition flex items-center gap-1.5">
              <Bot size={14} className="text-[#008069]" />
              <span>AI Chatbot</span>
            </a>
            <a href="#features-ticketing" className="hover:text-[#008069] transition flex items-center gap-1.5">
              <Ticket size={14} className="text-[#008069]" />
              <span>Ticketing</span>
            </a>
            <a href="#features-team" className="hover:text-[#008069] transition flex items-center gap-1.5">
              <Users size={14} className="text-[#008069]" />
              <span>Team Inbox</span>
            </a>
            <a href="#why-whatsapp" className="hover:text-[#008069] transition">
              Why WhatsApp?
            </a>
            <a href="#faq" className="hover:text-[#008069] transition">
              FAQ
            </a>
          </nav>

          {/* Header Action Buttons */}
          <div className="hidden sm:flex items-center gap-3">
            <Link 
              href="/login" 
              className="text-xs sm:text-sm font-semibold text-[#4a5852] hover:text-[#0c2014] px-3.5 py-2 transition"
            >
              Sign In
            </Link>
            <a 
              href="#demo" 
              className="rounded-full border-2 border-slate-300 px-4 py-1.5 text-xs sm:text-sm font-semibold text-[#0c2014] hover:bg-slate-50 transition"
            >
              Book a demo
            </a>
            <Link 
              href="/signup" 
              className="rounded-full bg-[#27d34b] hover:bg-[#20bf41] text-[#0c2014] text-xs sm:text-sm font-bold px-5 py-2.5 shadow-[0_8px_20px_-6px_rgba(39,211,75,0.45)] hover:shadow-[0_12px_24px_-6px_rgba(39,211,75,0.6)] transition-all active:scale-[0.98]"
            >
              Start free →
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 text-slate-700 hover:text-slate-900 rounded-lg"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {/* Mobile Dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white border-b border-slate-200 px-6 py-5 space-y-3.5 shadow-xl">
            <a 
              href="#showcase" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-800"
            >
              ⚡ Bulk WhatsApp Broadcasts
            </a>
            <a 
              href="#features-pipeline" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-800"
            >
              📊 Sales Pipeline &amp; Deals
            </a>
            <a 
              href="#features-ai" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-800"
            >
              🤖 24/7 AI Chatbot &amp; Agent
            </a>
            <a 
              href="#features-ticketing" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-800"
            >
              🎫 Customer Support Ticketing &amp; SLAs
            </a>
            <a 
              href="#features-team" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-800"
            >
              👥 Team Management &amp; Shared Inbox
            </a>
            <a 
              href="#why-whatsapp" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-800"
            >
              📈 Why WhatsApp vs Email
            </a>
            <a 
              href="#faq" 
              onClick={() => setMobileMenuOpen(false)}
              className="block text-sm font-semibold text-slate-800"
            >
              ❓ FAQ
            </a>
            <div className="pt-3 border-t border-slate-100 flex flex-col gap-2.5">
              <Link 
                href="/login" 
                className="w-full text-center py-2 text-sm font-semibold border border-slate-300 rounded-full"
              >
                Sign In
              </Link>
              <Link 
                href="/signup" 
                className="w-full text-center py-2 text-sm font-bold bg-[#27d34b] text-[#0c2014] rounded-full shadow-sm"
              >
                Start free trial →
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* ━━━ HERO SECTION (SPACIOUS, MODERN OMNIENGAGE STYLE) ━━━ */}
      <section className="relative pt-12 pb-20 md:pt-20 md:pb-28 overflow-hidden bg-white">
        
        {/* Ambient Top Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[450px] bg-gradient-to-b from-[#eaf6ec]/90 to-transparent blur-[120px] -z-10 pointer-events-none" />
        
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            
            {/* Left Hero Copy */}
            <div className="lg:col-span-6 text-center lg:text-left">
              
              {/* Eyebrow Pill */}
              <div className="inline-flex items-center gap-2 rounded-full bg-[#e7f6ea] px-4 py-1.5 text-xs font-bold text-[#107038] mb-6 border border-[#bfe3c8]">
                <span className="h-2 w-2 rounded-full bg-[#27d34b] animate-pulse" />
                <span>WhatsApp Cloud API Integration • Zero Token Markup</span>
              </div>

              {/* Main Headline */}
              <h1 className="text-4xl sm:text-5xl lg:text-[62px] font-extrabold text-[#0c2014] leading-[1.06] tracking-[-0.03em] mb-6">
                Turn every chat <br className="hidden sm:inline" />
                <span className="bg-gradient-to-r from-[#008069] to-[#27d34b] bg-clip-text text-transparent">
                  into revenue.
                </span>
              </h1>

              {/* Punchy Subheadline (Less Content, Clear Meaning) */}
              <p className="text-base sm:text-lg text-[#52635b] max-w-xl mx-auto lg:mx-0 mb-8 leading-relaxed font-normal">
                Deploy a <strong className="text-[#0c2014]">24/7 WhatsApp AI Chatbot</strong> that qualifies buyers and closes sales, and blast <strong className="text-[#0c2014]">personalized bulk broadcasts</strong> from Excel with <span className="text-[#008069] font-bold underline decoration-[#27d34b] decoration-2">98% open rates</span> at wholesale Meta rates.
              </p>

              {/* CTA Pill Buttons */}
              <div className="flex flex-col sm:flex-row gap-3.5 justify-center lg:justify-start items-center mb-10">
                <Link 
                  href="/signup" 
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-[15px] font-bold text-[#0c2014] transition hover:-translate-y-0.5 bg-[#27d34b] shadow-[0_12px_30px_-10px_rgba(39,211,75,0.5)] hover:shadow-[0_16px_32px_-8px_rgba(39,211,75,0.65)] active:scale-[0.98]"
                >
                  <span>Start Free 14-Day Trial</span>
                  <ArrowRight size={16} />
                </Link>
                <a 
                  href="#showcase" 
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border-2 border-slate-300 px-6 py-3 text-[15px] font-semibold text-[#0c2014] hover:bg-slate-50 transition"
                >
                  <span>Explore Stacked Studio</span>
                </a>
              </div>

              {/* Conversion Metric Ticker */}
              <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto lg:mx-0 pt-6 border-t border-slate-100 text-left">
                <div>
                  <div className="text-2xl font-black text-[#0c2014] tracking-tight">98.4%</div>
                  <div className="text-[12px] font-medium text-[#7b8a83]">WhatsApp Open Rate</div>
                </div>
                <div>
                  <div className="text-2xl font-black text-[#008069] tracking-tight">&lt; 1.8s</div>
                  <div className="text-[12px] font-medium text-[#7b8a83]">AI Reply Speed</div>
                </div>
                <div>
                  <div className="text-2xl font-black text-[#0c2014] tracking-tight">0% Markup</div>
                  <div className="text-[12px] font-medium text-[#7b8a83]">Direct Meta Wholesale</div>
                </div>
              </div>

            </div>

            {/* Right Hero: WhatsApp Chatbot Simulator Card */}
            <div className="lg:col-span-6">
              <div className="relative mx-auto max-w-md bg-white rounded-[28px] border border-slate-200 shadow-[0_20px_50px_-20px_rgba(12,32,20,0.12)] overflow-hidden">
                
                {/* Header Bar */}
                <div className="bg-[#008069] px-4 py-3.5 text-white flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center font-bold text-white text-sm">
                      <Bot size={20} />
                    </div>
                    <div>
                      <div className="text-sm font-bold flex items-center gap-1.5">
                        <span>Apex Store AI Sales Assistant</span>
                        <CheckCircle2 size={13} className="text-[#27d34b]" />
                      </div>
                      <span className="text-[11px] text-emerald-100 flex items-center gap-1 font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#27d34b] animate-pulse" />
                        Online 24/7 • Sub-2s AI Replies
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] bg-white/20 font-semibold px-2 py-0.5 rounded-full">
                    Official Cloud API
                  </span>
                </div>

                {/* Simulated Chat Feed */}
                <div className="bg-[#efeae2] p-4 min-h-[300px] max-h-[340px] overflow-y-auto space-y-3 wa-chat-wallpaper text-xs">
                  
                  {/* Inbound Question */}
                  <div className="flex justify-end">
                    <div className="bg-[#d9fdd3] text-[#111b21] p-3 rounded-2xl rounded-tr-none max-w-[85%] shadow-xs">
                      <p className="font-medium">
                        {simulatorStep === 'intro' && "Hi! Do you have the Black Edition Headphones in stock?"}
                        {simulatorStep === 'meta' && "Can I connect my official Meta WhatsApp Business API?"}
                        {simulatorStep === 'bulk' && "Can I send 20,000 promo WhatsApps from an Excel list?"}
                        {simulatorStep === 'demo' && "Can the AI qualify buyers and book a calendar call?"}
                      </p>
                      <div className="text-[9px] text-slate-400 text-right mt-1 flex items-center justify-end gap-1">
                        <span>10:30 AM</span>
                        <CheckCheck size={12} className="text-teal-600" />
                      </div>
                    </div>
                  </div>

                  {/* AI Bot Response */}
                  {isTyping ? (
                    <div className="flex justify-start">
                      <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-200 text-slate-500 font-medium flex items-center gap-2 shadow-xs">
                        <Bot size={13} className="text-[#008069] animate-spin" />
                        <span>AI Assistant is replying...</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-start">
                      <div className="bg-white text-[#111b21] p-3.5 rounded-2xl rounded-tl-none border border-slate-200/80 max-w-[88%] shadow-xs space-y-2">
                        {simulatorStep === 'intro' && (
                          <>
                            <p className="font-medium leading-relaxed">
                              👋 Yes Alex! We have <strong>8 units</strong> left in Black. Since you are a VIP customer, you can claim <strong>20% off</strong> today only.
                            </p>
                            <div className="bg-[#e7f6ea] text-[#107038] p-2 rounded-xl text-[11px] font-bold text-center border border-[#bfe3c8]">
                              👉 [ 🛍️ Order with 20% Off ($149) ]
                            </div>
                          </>
                        )}

                        {simulatorStep === 'meta' && (
                          <>
                            <p className="font-medium leading-relaxed">
                              ⚡ Yes! We connect directly to your official <strong>Meta Cloud API</strong> via Embedded Signup. Zero middleman fees, verified deliverability, and 98% open rates!
                            </p>
                            <div className="bg-[#e7f6ea] text-[#107038] p-2 rounded-xl text-[11px] font-bold text-center border border-[#bfe3c8]">
                              👉 [ ⚡ Direct Meta Cloud API Setup ]
                            </div>
                          </>
                        )}

                        {simulatorStep === 'bulk' && (
                          <>
                            <p className="font-medium leading-relaxed">
                              🚀 Yes! Upload your <code>.xlsx</code> or <code>.csv</code> file, map tags like <code>{`{{name}}`}</code>, and dispatch with official anti-ban safe pacing at <strong>98.4% open rate</strong>.
                            </p>
                            <div className="bg-[#e7f6ea] text-[#107038] p-2 rounded-xl text-[11px] font-bold text-center border border-[#bfe3c8]">
                              👉 [ ⚡ Preview Broadcast Studio ]
                            </div>
                          </>
                        )}

                        {simulatorStep === 'demo' && (
                          <>
                            <p className="font-medium leading-relaxed">
                              🤖 Absolutely! The AI qualifies budget &amp; timeline, assigns a Lead Score, and lets buyers select a time slot right inside WhatsApp.
                            </p>
                            <div className="bg-[#e7f6ea] text-[#107038] p-2 rounded-xl text-[11px] font-bold text-center border border-[#bfe3c8]">
                              👉 [ 📅 Book Priority 1-on-1 Walkthrough ]
                            </div>
                          </>
                        )}

                        <div className="text-[9px] text-slate-400 text-right mt-1">
                          <span>10:30 AM</span>
                        </div>
                      </div>
                    </div>
                  )}

                </div>

                {/* Interactive Click Chips */}
                <div className="p-3 bg-[#f6f8f7] border-t border-slate-200">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Click to test instant simulated AI replies:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => handleSelectPrompt('meta')}
                      className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition ${
                        simulatorStep === 'meta' 
                          ? 'bg-[#008069] text-white border-[#008069]' 
                          : 'bg-white text-slate-700 hover:bg-emerald-50 border-slate-200'
                      }`}
                    >
                      ⚡ Meta Cloud API?
                    </button>
                    <button
                      onClick={() => handleSelectPrompt('bulk')}
                      className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition ${
                        simulatorStep === 'bulk' 
                          ? 'bg-[#008069] text-white border-[#008069]' 
                          : 'bg-white text-slate-700 hover:bg-emerald-50 border-slate-200'
                      }`}
                    >
                      🚀 20k Excel Broadcasts?
                    </button>
                    <button
                      onClick={() => handleSelectPrompt('demo')}
                      className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition ${
                        simulatorStep === 'demo' 
                          ? 'bg-[#008069] text-white border-[#008069]' 
                          : 'bg-white text-slate-700 hover:bg-emerald-50 border-slate-200'
                      }`}
                    >
                      🤖 Book Live Demo?
                    </button>
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ━━━ INTEGRATION LOGO BAR ━━━ */}
      <section className="py-8 bg-[#fafbfa] border-y border-[#e9eeeb]">
        <div className="max-w-[1400px] mx-auto px-4 text-center">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-4">
            Connects natively with your existing e-commerce &amp; marketing stack
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-14 text-slate-600 font-bold text-xs sm:text-sm">
            <span className="flex items-center gap-2"><ShoppingBag size={16} className="text-[#27d34b]" /> Shopify</span>
            <span className="flex items-center gap-2"><FileSpreadsheet size={16} className="text-[#008069]" /> Excel &amp; CSV</span>
            <span className="flex items-center gap-2"><Globe size={16} className="text-blue-500" /> WooCommerce</span>
            <span className="flex items-center gap-2"><Zap size={16} className="text-amber-500" /> Meta Cloud API</span>
            <span className="flex items-center gap-2"><Database size={16} className="text-teal-600" /> Google Sheets</span>
            <span className="flex items-center gap-2"><Lock size={16} className="text-indigo-600" /> Stripe Invoicing</span>
          </div>
        </div>
      </section>

      {/* ━━━ SIGNATURE OMNIENGAGE STACKED BENTO CARDS SHOWCASE (AS IN USER SCREENSHOTS) ━━━ */}
      <section id="showcase" className="py-20 md:py-28 bg-[#f3f4f5]">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-3xl sm:text-4xl lg:text-[48px] font-extrabold text-[#0c2014] tracking-[-0.02em] leading-[1.12] mb-4">
              Everything you need to turn conversations into revenue.
            </h2>
            <p className="text-base sm:text-lg text-[#5d6b67] font-normal leading-relaxed">
              One platform to run broadcasts, automate journeys, and support customers across WhatsApp.
            </p>
          </div>

          {/* STACKED CARDS CONTAINER */}
          <div className="space-y-8 max-w-6xl mx-auto">
            
            {/* ━━━ CARD 1: BULK WHATSAPP CAMPAIGNS (WITH TRACKING & REPLY) ━━━ */}
            <article className="rounded-[32px] bg-[#F8EAC6] p-8 lg:p-12 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.08)] border border-amber-200/50 transition-all">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                
                {/* Left Text Column */}
                <div className="lg:col-span-5">
                  <div className="inline-flex items-center gap-2.5 mb-5 text-[13px] font-bold text-[#141c18]">
                    <span className="h-7 w-7 rounded-lg bg-[#E9A50E] flex items-center justify-center text-white shadow-xs">
                      <Mail size={15} />
                    </span>
                    <span>Bulk WhatsApp Campaigns</span>
                  </div>

                  <h3 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold text-[#0c2014] leading-[1.14] tracking-tight mb-4">
                    Send, track & reply — all by campaign.
                  </h3>

                  <p className="text-[15px] sm:text-[16px] text-[#5d6b67] leading-relaxed mb-6">
                    Launch bulk WhatsApp campaigns from Excel or CSV. Track every message by campaign — delivery, read receipts, and replies — and respond to customers directly from the campaign view.
                  </p>

                  <ul className="space-y-2.5 text-[13px] text-[#3d4a44] font-medium mb-8">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#E9A50E] mt-0.5 flex-shrink-0" />
                      <span>Upload <code className="bg-amber-50 px-1 rounded text-[12px]">.xlsx</code> or <code className="bg-amber-50 px-1 rounded text-[12px]">.csv</code> with personalized <code className="bg-amber-50 px-1 rounded text-[12px]">{`{{variables}}`}</code></span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#E9A50E] mt-0.5 flex-shrink-0" />
                      <span>Per-campaign message tracking — Sent, Delivered, Read, Failed</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#E9A50E] mt-0.5 flex-shrink-0" />
                      <span>View & reply to campaign responses in real-time chat view</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#E9A50E] mt-0.5 flex-shrink-0" />
                      <span>Recipient audit log with delivery status per contact</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#E9A50E] mt-0.5 flex-shrink-0" />
                      <span>Anti-ban safe pacing via official Meta Cloud API</span>
                    </li>
                  </ul>

                  <Link 
                    href="/signup" 
                    className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[14px] font-bold text-[#0c2014] transition hover:-translate-y-0.5 bg-[#27d34b] shadow-[0_10px_25px_-8px_rgba(39,211,75,0.6)] hover:shadow-[0_14px_28px_-6px_rgba(39,211,75,0.7)]"
                  >
                    <span>Get Started</span>
                    <ArrowRight size={15} />
                  </Link>
                </div>

                {/* Right Visual Column */}
                <div className="lg:col-span-7">
                  <div className="rounded-[24px] bg-[#F2DBA3]/80 p-6 sm:p-8 flex items-center justify-center">
                    
                    <div className="w-full bg-white rounded-[20px] shadow-[0_16px_36px_-12px_rgba(0,0,0,0.1)] p-5 sm:p-6 space-y-4">
                      
                      {/* Campaign Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                          <span className="ml-2 font-bold text-xs text-slate-800">Campaign: Diwali Sale 2026</span>
                        </div>
                        <span className="text-[11px] font-bold text-[#107038] bg-[#e7f6ea] px-2.5 py-1 rounded-md border border-[#bfe3c8]">
                          ✓ Completed
                        </span>
                      </div>

                      {/* Campaign Stats Row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <div className="text-[10px] text-slate-500 font-medium">Sent</div>
                          <div className="text-sm font-black text-slate-900 mt-0.5">12,845</div>
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <div className="text-[10px] text-slate-500 font-medium">Delivered</div>
                          <div className="text-sm font-black text-[#008069] mt-0.5">12,641</div>
                          <div className="text-[9px] font-bold text-emerald-600">98.4%</div>
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <div className="text-[10px] text-slate-500 font-medium">Read</div>
                          <div className="text-sm font-black text-[#008069] mt-0.5">11,890</div>
                          <div className="text-[9px] font-bold text-emerald-600">94.1%</div>
                        </div>
                        <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                          <div className="text-[10px] text-amber-700 font-medium">Replied</div>
                          <div className="text-sm font-black text-amber-700 mt-0.5">1,248</div>
                          <div className="text-[9px] font-bold text-amber-600">9.7%</div>
                        </div>
                      </div>

                      {/* Campaign Reply Chat Preview */}
                      <div className="bg-[#efeae2] p-3 rounded-xl border border-slate-200/70 text-xs wa-chat-wallpaper">
                        <div className="text-[10px] font-bold text-[#008069] flex items-center justify-between mb-2">
                          <span className="flex items-center gap-1.5">
                            <MessageCircle size={11} />
                            Campaign Replies (1,248)
                          </span>
                          <span className="text-slate-400 font-normal">Live</span>
                        </div>

                        {/* Reply Thread */}
                        <div className="space-y-1.5">
                          <div className="flex items-start gap-2">
                            <div className="h-6 w-6 rounded-full bg-[#008069] text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5">PS</div>
                            <div className="bg-white p-2 rounded-xl rounded-tl-none text-[11px] text-slate-800 shadow-2xs flex-1">
                              <div className="font-bold text-[10px] text-[#008069] mb-0.5">Priya Sharma</div>
                              Yes! I want to order. What sizes are available? 🛒
                              <div className="text-[9px] text-slate-400 text-right mt-0.5">2:31 PM</div>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <div className="h-6 w-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5">RK</div>
                            <div className="bg-white p-2 rounded-xl rounded-tl-none text-[11px] text-slate-800 shadow-2xs flex-1">
                              <div className="font-bold text-[10px] text-amber-600 mb-0.5">Ravi Kumar</div>
                              Can I get this with COD? 📦
                              <div className="text-[9px] text-slate-400 text-right mt-0.5">2:33 PM</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Recipient Audit Row */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Recipient Dispatch Audit</div>
                        <div className="flex items-center justify-between bg-slate-50/70 p-2 rounded-lg border border-slate-100 text-[10px]">
                          <div className="flex items-center gap-2">
                            <span>🇮🇳</span>
                            <span className="font-bold text-slate-800">Priya Sharma</span>
                            <span className="text-slate-400">+91 98765 43210</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="bg-emerald-50 text-emerald-700 text-[9px] font-bold px-1.5 py-0.5 rounded">Read ✓✓</span>
                            <span className="bg-amber-50 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded">Replied</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between bg-slate-50/70 p-2 rounded-lg border border-slate-100 text-[10px]">
                          <div className="flex items-center gap-2">
                            <span>🇺🇸</span>
                            <span className="font-bold text-slate-800">Alex Morgan</span>
                            <span className="text-slate-400">+1 (555) 019-2834</span>
                          </div>
                          <span className="bg-emerald-50 text-emerald-700 text-[9px] font-bold px-1.5 py-0.5 rounded">Delivered ✓</span>
                        </div>
                        <div className="flex items-center justify-between bg-slate-50/70 p-2 rounded-lg border border-slate-100 text-[10px]">
                          <div className="flex items-center gap-2">
                            <span>🇬🇧</span>
                            <span className="font-bold text-slate-800">James Wilson</span>
                            <span className="text-slate-400">+44 7911 123456</span>
                          </div>
                          <span className="bg-rose-50 text-rose-600 text-[9px] font-bold px-1.5 py-0.5 rounded">Failed ✗</span>
                        </div>
                      </div>

                    </div>

                  </div>
                </div>

              </div>
            </article>

            {/* ━━━ CARD 2: 24/7 AUTONOMOUS AI CHATBOT ━━━ */}
            <article id="features-ai" className="rounded-[32px] bg-[#DBF2E1] p-8 lg:p-12 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.08)] border border-emerald-200/50 transition-all">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                
                {/* Left Text Column */}
                <div className="lg:col-span-5">
                  <div className="inline-flex items-center gap-2.5 mb-5 text-[13px] font-bold text-[#141c18]">
                    <span className="h-7 w-7 rounded-lg bg-[#2FA85A] flex items-center justify-center text-white shadow-xs">
                      <Bot size={15} />
                    </span>
                    <span>24/7 Autonomous AI Chatbot</span>
                  </div>

                  <h3 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold text-[#0c2014] leading-[1.14] tracking-tight mb-4">
                    Instant AI qualification &amp; sales at 2 AM.
                  </h3>

                  <p className="text-[15px] sm:text-[16px] text-[#5d6b67] leading-relaxed mb-6">
                    Train your AI agent on your product catalog, website URLs, and PDFs. It resolves 80% of customer questions in 2 seconds, recommends items, qualifies buyers, and schedules meetings without human delays.
                  </p>

                  <ul className="space-y-2.5 text-[13px] text-[#3d4a44] font-medium mb-8">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#2FA85A] mt-0.5 flex-shrink-0" />
                      <span>Knowledge Base RAG: Trains on company PDFs, pricing &amp; FAQs</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#2FA85A] mt-0.5 flex-shrink-0" />
                      <span>Smart lead scoring &amp; automated calendar demo scheduling</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#2FA85A] mt-0.5 flex-shrink-0" />
                      <span>Multi-language understanding across 50+ regional languages</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#2FA85A] mt-0.5 flex-shrink-0" />
                      <span>Smooth instant handoff to sales reps for high-value deals</span>
                    </li>
                  </ul>

                  <Link 
                    href="/signup" 
                    className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[14px] font-bold text-[#0c2014] transition hover:-translate-y-0.5 bg-[#27d34b] shadow-[0_10px_25px_-8px_rgba(39,211,75,0.6)] hover:shadow-[0_14px_28px_-6px_rgba(39,211,75,0.7)]"
                  >
                    <span>Test AI Chatbot Free</span>
                    <ArrowRight size={15} />
                  </Link>
                </div>

                {/* Right Visual Column */}
                <div className="lg:col-span-7">
                  <div className="rounded-[24px] bg-[#C4EACF]/80 p-6 sm:p-8 flex items-center justify-center">
                    
                    <div className="w-full bg-white rounded-[20px] shadow-[0_16px_36px_-12px_rgba(0,0,0,0.1)] p-5 sm:p-6 space-y-4">
                      
                      {/* Chat Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-full bg-[#008069] text-white flex items-center justify-center text-xs font-bold shadow-xs">
                            <Bot size={16} />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                              WAMACRM AI Sales Agent
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            </div>
                            <div className="text-[10px] text-slate-400">Autonomous Assistant • Online 24/7</div>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                          ⚡ 1.6s Reply Speed
                        </span>
                      </div>

                      {/* WhatsApp Simulation Bubbles */}
                      <div className="space-y-3 py-1">
                        <div className="flex justify-end">
                          <div className="bg-[#d9fdd3] text-slate-800 text-xs p-3 rounded-2xl rounded-tr-xs max-w-[85%] shadow-2xs leading-relaxed">
                            Do you offer wholesale bulk discounts for orders over 500 units?
                            <div className="text-[9px] text-slate-400 text-right mt-1 font-medium">10:14 PM ✓✓</div>
                          </div>
                        </div>

                        <div className="flex justify-start">
                          <div className="bg-slate-50 text-slate-800 text-xs p-3 rounded-2xl rounded-tl-xs max-w-[90%] shadow-2xs space-y-2 leading-relaxed border border-slate-100">
                            <p>
                              Yes! For 500+ units we provide Tier-1 Wholesale pricing (<strong>25% off</strong> at $18/unit). Official GST invoice &amp; express priority logistics included.
                            </p>
                            <div className="bg-[#e7f6ea] text-[#107038] p-2 rounded-xl text-xs font-bold text-center border border-[#bfe3c8]">
                              👉 [ 📅 Book Priority Wholesale Call ]
                            </div>
                            <div className="text-[9px] text-slate-400 text-right">10:14 PM</div>
                          </div>
                        </div>
                      </div>

                      {/* Resolution Metric Footer */}
                      <div className="bg-gradient-to-r from-[#008069] to-[#27d34b] p-3 rounded-xl text-white flex items-center justify-between text-xs">
                        <span className="font-bold">84% Queries Resolved Autonomously</span>
                        <span className="bg-white/20 text-white font-black text-[10px] px-2 py-0.5 rounded-full">
                          Zero Delays
                        </span>
                      </div>

                    </div>

                  </div>
                </div>

              </div>
            </article>

            {/* ━━━ CARD 3: VISUAL SALES PIPELINE ━━━ */}
            <article id="features-pipeline" className="rounded-[32px] bg-[#EFE8FD] p-8 lg:p-12 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.08)] border border-purple-200/50 transition-all">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                
                {/* Left Text Column */}
                <div className="lg:col-span-5">
                  <div className="inline-flex items-center gap-2.5 mb-5 text-[13px] font-bold text-[#141c18]">
                    <span className="h-7 w-7 rounded-lg bg-[#7C3AED] flex items-center justify-center text-white shadow-xs">
                      <Kanban size={15} />
                    </span>
                    <span>Visual Sales Pipeline</span>
                  </div>

                  <h3 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold text-[#0c2014] leading-[1.14] tracking-tight mb-4">
                    Turn WhatsApp replies into closed deals.
                  </h3>

                  <p className="text-[15px] sm:text-[16px] text-[#5d6b67] leading-relaxed mb-6">
                    Never lose track of high-intent buyers. Drag &amp; drop deals through customizable pipeline stages, track deal sizes in real-time, and attribute closed revenue directly to your WhatsApp campaigns.
                  </p>

                  <ul className="space-y-2.5 text-[13px] text-[#3d4a44] font-medium mb-8">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#7C3AED] mt-0.5 flex-shrink-0" />
                      <span>Visual Kanban board with drag-and-drop deal stages</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#7C3AED] mt-0.5 flex-shrink-0" />
                      <span>1-Click deal creation directly from any WhatsApp thread</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#7C3AED] mt-0.5 flex-shrink-0" />
                      <span>Direct deal values, currency support (₹ / $) &amp; stage probabilities</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#7C3AED] mt-0.5 flex-shrink-0" />
                      <span>Campaign ROI attribution: see revenue generated per broadcast</span>
                    </li>
                  </ul>

                  <Link 
                    href="/signup" 
                    className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[14px] font-bold text-[#0c2014] transition hover:-translate-y-0.5 bg-[#27d34b] shadow-[0_10px_25px_-8px_rgba(39,211,75,0.6)] hover:shadow-[0_14px_28px_-6px_rgba(39,211,75,0.7)]"
                  >
                    <span>Open Sales Pipeline</span>
                    <ArrowRight size={15} />
                  </Link>
                </div>

                {/* Right Visual Column */}
                <div className="lg:col-span-7">
                  <div className="rounded-[24px] bg-[#DBCBF9]/80 p-6 sm:p-8 flex items-center justify-center">
                    
                    <div className="w-full bg-white rounded-[20px] shadow-[0_16px_36px_-12px_rgba(0,0,0,0.1)] p-5 sm:p-6 space-y-4">
                      
                      {/* Pipeline Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full bg-purple-500 animate-pulse" />
                          <span className="text-xs font-bold text-slate-800">Q3 Active Sales Pipeline</span>
                        </div>
                        <span className="text-[11px] font-black text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md border border-purple-200">
                          ₹18,40,000 Pipeline Value
                        </span>
                      </div>

                      {/* 3 Mini Stages */}
                      <div className="grid grid-cols-3 gap-2 text-left">
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/70 space-y-2">
                          <div className="text-[10px] font-bold text-slate-500 uppercase">Qualified (3)</div>
                          <div className="bg-white p-2.5 rounded-lg shadow-2xs border border-slate-100 space-y-1">
                            <div className="text-xs font-bold text-slate-900 truncate">Acme Retails</div>
                            <div className="text-xs font-black text-purple-700">₹1,20,000</div>
                            <div className="text-[9px] text-slate-400">Broadcast Lead</div>
                          </div>
                        </div>

                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/70 space-y-2">
                          <div className="text-[10px] font-bold text-slate-500 uppercase">Proposal (2)</div>
                          <div className="bg-white p-2.5 rounded-lg shadow-2xs border border-slate-100 space-y-1">
                            <div className="text-xs font-bold text-slate-900 truncate">Apex Global</div>
                            <div className="text-xs font-black text-purple-700">₹3,50,000</div>
                            <div className="text-[9px] text-emerald-600 font-bold">Hot Deal 🔥</div>
                          </div>
                        </div>

                        <div className="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-200/70 space-y-2">
                          <div className="text-[10px] font-bold text-emerald-700 uppercase">Won (14)</div>
                          <div className="bg-white p-2.5 rounded-lg shadow-2xs border border-emerald-100 space-y-1">
                            <div className="text-xs font-bold text-slate-900 truncate">TrendKart D2C</div>
                            <div className="text-xs font-black text-emerald-600">₹4,80,000</div>
                            <div className="text-[9px] text-emerald-600 font-bold">✓ Closed in Chat</div>
                          </div>
                        </div>
                      </div>

                      {/* Summary Banner */}
                      <div className="bg-[#0c2014] text-white p-3.5 rounded-xl flex items-center justify-between text-xs">
                        <div>
                          <div className="text-[10px] text-[#27d34b] font-bold uppercase">Direct Campaign Attribution</div>
                          <div className="font-extrabold text-white text-sm">34.2% Win Rate from WhatsApp Campaigns</div>
                        </div>
                        <span className="bg-[#27d34b] text-[#0c2014] font-black text-xs px-2.5 py-1 rounded-full">
                          +42% Growth
                        </span>
                      </div>

                    </div>

                  </div>
                </div>

              </div>
            </article>

            {/* ━━━ CARD 4: SMART TICKETING SYSTEM & SLAS ━━━ */}
            <article id="features-ticketing" className="rounded-[32px] bg-[#FFE8DE] p-8 lg:p-12 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.08)] border border-rose-200/50 transition-all">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                
                {/* Left Text Column */}
                <div className="lg:col-span-5">
                  <div className="inline-flex items-center gap-2.5 mb-5 text-[13px] font-bold text-[#141c18]">
                    <span className="h-7 w-7 rounded-lg bg-[#EA580C] flex items-center justify-center text-white shadow-xs">
                      <Ticket size={15} />
                    </span>
                    <span>Ticketing System &amp; SLAs</span>
                  </div>

                  <h3 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold text-[#0c2014] leading-[1.14] tracking-tight mb-4">
                    Track, escalate &amp; resolve support without chaos.
                  </h3>

                  <p className="text-[15px] sm:text-[16px] text-[#5d6b67] leading-relaxed mb-6">
                    Convert complex customer support inquiries into tracked tickets straight from WhatsApp. Enforce response SLA timers, route to departments, and automatically send status updates to customers on WhatsApp.
                  </p>

                  <ul className="space-y-2.5 text-[13px] text-[#3d4a44] font-medium mb-8">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#EA580C] mt-0.5 flex-shrink-0" />
                      <span>1-Click ticket creation directly from WhatsApp conversation view</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#EA580C] mt-0.5 flex-shrink-0" />
                      <span>SLA countdown timers with automated escalation alerts</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#EA580C] mt-0.5 flex-shrink-0" />
                      <span>Department queues: Billing, Logistics, Technical Support &amp; Sales</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#EA580C] mt-0.5 flex-shrink-0" />
                      <span>Automated WhatsApp notifications to customer on ticket updates</span>
                    </li>
                  </ul>

                  <Link 
                    href="/signup" 
                    className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[14px] font-bold text-[#0c2014] transition hover:-translate-y-0.5 bg-[#27d34b] shadow-[0_10px_25px_-8px_rgba(39,211,75,0.6)] hover:shadow-[0_14px_28px_-6px_rgba(39,211,75,0.7)]"
                  >
                    <span>Explore Ticketing</span>
                    <ArrowRight size={15} />
                  </Link>
                </div>

                {/* Right Visual Column */}
                <div className="lg:col-span-7">
                  <div className="rounded-[24px] bg-[#FDD0C0]/80 p-6 sm:p-8 flex items-center justify-center">
                    
                    <div className="w-full bg-white rounded-[20px] shadow-[0_16px_36px_-12px_rgba(0,0,0,0.1)] p-5 sm:p-6 space-y-4">
                      
                      {/* Ticket Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-900">#TK-1082</span>
                          <span className="bg-rose-100 text-rose-700 text-[10px] font-black px-2.5 py-0.5 rounded-full border border-rose-200">
                            Urgent Priority
                          </span>
                        </div>
                        <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                          <Clock size={12} /> 14m SLA remaining
                        </span>
                      </div>

                      {/* Ticket Details */}
                      <div className="space-y-1.5">
                        <div className="text-xs font-bold text-slate-800">Shipment delayed &amp; tracking link requested</div>
                        <div className="text-[11px] text-slate-500">Customer: Vikram Malhotra (+91 9845... ) • Order #8491</div>
                      </div>

                      <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs">
                        <div>
                          <span className="text-slate-400">Assigned: </span>
                          <span className="font-bold text-slate-800">Logistics Desk • Sneha Patel</span>
                        </div>
                        <span className="bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded text-[11px]">In Progress</span>
                      </div>

                      {/* WhatsApp Auto notification */}
                      <div className="bg-[#e7f6ea] text-[#107038] p-3 rounded-xl text-xs font-semibold border border-[#bfe3c8] flex items-center justify-between">
                        <span>✓ WhatsApp Notification: &quot;Tracking link dispatched to buyer&quot;</span>
                        <span className="font-bold bg-[#107038] text-white px-2 py-0.5 rounded text-[10px]">Delivered</span>
                      </div>

                      {/* Footer Stats */}
                      <div className="flex items-center justify-between text-xs text-slate-500 font-bold pt-1">
                        <span>Avg Resolution: 18 mins</span>
                        <span className="text-[#008069] font-black">99.2% SLA Compliance</span>
                      </div>

                    </div>

                  </div>
                </div>

              </div>
            </article>

            {/* ━━━ CARD 5: TEAM MANAGEMENT & SHARED INBOX ━━━ */}
            <article id="features-team" className="rounded-[32px] bg-[#E0F2FE] p-8 lg:p-12 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.08)] border border-sky-200/50 transition-all">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                
                {/* Left Text Column */}
                <div className="lg:col-span-5">
                  <div className="inline-flex items-center gap-2.5 mb-5 text-[13px] font-bold text-[#141c18]">
                    <span className="h-7 w-7 rounded-lg bg-[#0284C7] flex items-center justify-center text-white shadow-xs">
                      <Users size={15} />
                    </span>
                    <span>Team Management &amp; Shared Inbox</span>
                  </div>

                  <h3 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold text-[#0c2014] leading-[1.14] tracking-tight mb-4">
                    One WhatsApp number for your entire company.
                  </h3>

                  <p className="text-[15px] sm:text-[16px] text-[#5d6b67] leading-relaxed mb-6">
                    No more passing around a single office phone. Give your entire sales and support team simultaneous access to your official WhatsApp number with smart auto-routing, private internal notes, and supervisor real-time monitoring.
                  </p>

                  <ul className="space-y-2.5 text-[13px] text-[#3d4a44] font-medium mb-8">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#0284C7] mt-0.5 flex-shrink-0" />
                      <span>Multi-agent concurrent access to official WhatsApp Cloud API</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#0284C7] mt-0.5 flex-shrink-0" />
                      <span>Private internal team notes (invisible to customers)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#0284C7] mt-0.5 flex-shrink-0" />
                      <span>Smart round-robin or workload-based conversation distribution</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 size={15} className="text-[#0284C7] mt-0.5 flex-shrink-0" />
                      <span>Supervisor dashboard: Agent response time, chats handled &amp; CSAT</span>
                    </li>
                  </ul>

                  <Link 
                    href="/signup" 
                    className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[14px] font-bold text-[#0c2014] transition hover:-translate-y-0.5 bg-[#27d34b] shadow-[0_10px_25px_-8px_rgba(39,211,75,0.6)] hover:shadow-[0_14px_28px_-6px_rgba(39,211,75,0.7)]"
                  >
                    <span>Add Your Team Free</span>
                    <ArrowRight size={15} />
                  </Link>
                </div>

                {/* Right Visual Column */}
                <div className="lg:col-span-7">
                  <div className="rounded-[24px] bg-[#C5E4FD]/80 p-6 sm:p-8 flex items-center justify-center">
                    
                    <div className="w-full bg-white rounded-[20px] shadow-[0_16px_36px_-12px_rgba(0,0,0,0.1)] p-5 sm:p-6 space-y-4">
                      
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <span className="text-xs font-bold text-slate-800">Team Presence &amp; Active Chats</span>
                        <span className="text-[10px] font-bold text-sky-800 bg-sky-50 px-2.5 py-1 rounded-md border border-sky-200">
                          3 Agents Online • Zero Collisions
                        </span>
                      </div>

                      {/* Agent Chips */}
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                          <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-800">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Rahul V.
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">4 active chats</div>
                        </div>
                        <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                          <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-800">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Priya S.
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">2 active chats</div>
                        </div>
                        <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                          <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-800">
                            <span className="h-2 w-2 rounded-full bg-amber-500" /> Vikram M.
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">In Call</div>
                        </div>
                      </div>

                      {/* Private Internal Note */}
                      <div className="bg-amber-50/90 border border-amber-200/80 p-3 rounded-xl text-xs text-amber-950 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-amber-800">
                          <Lock size={12} /> Private Internal Team Note (Hidden from Customer)
                        </div>
                        <p className="italic text-[11px] leading-relaxed">
                          &quot;Customer approved 10% annual billing discount. Contract sent to Alex for signature.&quot;
                        </p>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-500 font-bold pt-1">
                        <span>Assigned: Priya S. (Sales)</span>
                        <span className="text-sky-600 font-black">&lt; 2 min reply SLA</span>
                      </div>

                    </div>

                  </div>
                </div>

              </div>
            </article>

            {/* ━━━ CARD 6: REPORTS & AI ANALYTICS (EXACT SCREENSHOT 2 LOOK) ━━━ */}
            <article className="rounded-[32px] bg-[#DBF2E1] p-8 lg:p-12 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.08)] border border-emerald-200/50 transition-all">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                
                {/* Left Text Column */}
                <div className="lg:col-span-5">
                  <div className="inline-flex items-center gap-2.5 mb-5 text-[13px] font-bold text-[#141c18]">
                    <span className="h-7 w-7 rounded-lg bg-[#2FA85A] flex items-center justify-center text-white shadow-xs">
                      <BarChart3 size={15} />
                    </span>
                    <span>Reports &amp; analytics</span>
                  </div>

                  <h3 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold text-[#0c2014] leading-[1.14] tracking-tight mb-4">
                    See what's working, instantly.
                  </h3>

                  <p className="text-[15px] sm:text-[16px] text-[#5d6b67] leading-relaxed mb-8">
                    Track open rates, conversions, and revenue recovered in one live dashboard, while your 24/7 AI chatbot closes deals and qualifies buyers.
                  </p>

                  <Link 
                    href="/signup" 
                    className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[14px] font-bold text-[#0c2014] transition hover:-translate-y-0.5 bg-[#27d34b] shadow-[0_10px_25px_-8px_rgba(39,211,75,0.6)] hover:shadow-[0_14px_28px_-6px_rgba(39,211,75,0.7)]"
                  >
                    <span>Get Started</span>
                    <ArrowRight size={15} />
                  </Link>
                </div>

                {/* Right Visual Column (Darker Mint Background with Floating Dashboard Mockup) */}
                <div className="lg:col-span-7">
                  <div className="rounded-[24px] bg-[#C4EACF]/80 p-6 sm:p-8 flex items-center justify-center">
                    
                    {/* White Floating Dashboard Mockup */}
                    <div className="w-full bg-white rounded-[20px] shadow-[0_16px_36px_-12px_rgba(0,0,0,0.1)] p-5 sm:p-6 space-y-4">
                      
                      {/* Window Dots & Filter Dropdown */}
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                          <span className="ml-2 font-bold text-xs text-slate-800">Live Overview</span>
                        </div>
                        <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
                          Last 30 Days ▾
                        </span>
                      </div>

                      {/* 4 Stats Cards Row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="bg-[#fafbfa] p-2.5 rounded-xl border border-slate-100">
                          <span className="text-[10px] text-slate-500 font-medium">Total Contacts</span>
                          <div className="text-sm sm:text-base font-extrabold text-slate-900 mt-0.5">30,737</div>
                          <span className="text-[10px] font-bold text-emerald-600">↑ 16%</span>
                        </div>
                        <div className="bg-[#fafbfa] p-2.5 rounded-xl border border-slate-100">
                          <span className="text-[10px] text-slate-500 font-medium">Messages Sent</span>
                          <div className="text-sm sm:text-base font-extrabold text-slate-900 mt-0.5">189k</div>
                          <span className="text-[10px] font-bold text-emerald-600">↑ 12%</span>
                        </div>
                        <div className="bg-[#fafbfa] p-2.5 rounded-xl border border-slate-100">
                          <span className="text-[10px] text-slate-500 font-medium">Delivery Rate</span>
                          <div className="text-sm sm:text-base font-extrabold text-[#008069] mt-0.5">98.4%</div>
                          <span className="text-[10px] font-bold text-emerald-600">↑ 8%</span>
                        </div>
                        <div className="bg-[#fafbfa] p-2.5 rounded-xl border border-slate-100">
                          <span className="text-[10px] text-slate-500 font-medium">Read Rate</span>
                          <div className="text-sm sm:text-base font-extrabold text-[#008069] mt-0.5">94%</div>
                          <span className="text-[10px] font-bold text-emerald-600">↑ 9%</span>
                        </div>
                      </div>

                      {/* Line Chart Preview */}
                      <div className="bg-[#fafbfa] p-3 rounded-xl border border-slate-100">
                        <div className="flex justify-between items-center text-[10px] text-slate-500 font-bold mb-2">
                          <span>Message Volume &amp; Sales Conversion Over Time</span>
                          <span className="text-[#008069] flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#008069]" /> WhatsApp Active
                          </span>
                        </div>
                        
                        {/* Responsive SVG Curve */}
                        <div className="h-20 w-full">
                          <svg className="w-full h-full" viewBox="0 0 400 80" preserveAspectRatio="none">
                            <defs>
                              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#27d34b" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#27d34b" stopOpacity="0.0" />
                              </linearGradient>
                            </defs>
                            <path 
                              d="M0,60 Q50,45 100,50 T200,30 T300,15 T400,8 L400,80 L0,80 Z" 
                              fill="url(#chartGradient)" 
                            />
                            <path 
                              d="M0,60 Q50,45 100,50 T200,30 T300,15 T400,8" 
                              fill="none" 
                              stroke="#008069" 
                              strokeWidth="3" 
                              strokeLinecap="round" 
                            />
                            <path 
                              d="M0,70 Q50,65 100,68 T200,60 T300,55 T400,50" 
                              fill="none" 
                              stroke="#cbd5e1" 
                              strokeWidth="2" 
                              strokeDasharray="4 4" 
                            />
                          </svg>
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-400 mt-1 font-semibold">
                          <span>Week 1</span>
                          <span>Week 2</span>
                          <span>Week 3</span>
                          <span>Week 4</span>
                        </div>
                      </div>

                      {/* Bottom Banner */}
                      <div className="bg-gradient-to-r from-[#008069] to-[#27d34b] p-3 rounded-xl text-white flex items-center justify-between text-xs">
                        <span className="font-bold">Smarter Decisions, Better Results</span>
                        <span className="bg-white/20 text-white font-black text-[10px] px-2 py-0.5 rounded-full">
                          24/7 AI Active
                        </span>
                      </div>

                    </div>

                  </div>
                </div>

              </div>
            </article>

            {/* ━━━ CARD 3: ZERO MARKUP WHOLESALE (THE TOOL ADVANTAGE) ━━━ */}
            <article className="rounded-[32px] bg-[#DCE8FF] p-8 lg:p-12 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.08)] border border-blue-200/50 transition-all">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                
                {/* Left Text Column */}
                <div className="lg:col-span-5">
                  <div className="inline-flex items-center gap-2.5 mb-5 text-[13px] font-bold text-[#141c18]">
                    <span className="h-7 w-7 rounded-lg bg-[#2F6BFF] flex items-center justify-center text-white shadow-xs">
                      <Coins size={15} />
                    </span>
                    <span>Direct Meta Wholesale</span>
                  </div>

                  <h3 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold text-[#0c2014] leading-[1.14] tracking-tight mb-4">
                    Stop paying 300% markup. Save 75%.
                  </h3>

                  <p className="text-[15px] sm:text-[16px] text-[#5d6b67] leading-relaxed mb-8">
                    Connect your direct Meta Cloud API and OpenAI keys. You pay raw provider rates (~$0.005/msg) directly to Meta with zero token markup.
                  </p>

                  <a 
                    href="#demo" 
                    className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[14px] font-bold text-[#0c2014] transition hover:-translate-y-0.5 bg-[#27d34b] shadow-[0_10px_25px_-8px_rgba(39,211,75,0.6)] hover:shadow-[0_14px_28px_-6px_rgba(39,211,75,0.7)]"
                  >
                    <span>Request Free Demo Access</span>
                    <ArrowRight size={15} />
                  </a>
                </div>

                {/* Right Visual Column (Darker Blue Container with Cost Comparison Card) */}
                <div className="lg:col-span-7">
                  <div className="rounded-[24px] bg-[#C2D6FF]/80 p-6 sm:p-8 flex items-center justify-center">
                    
                    {/* White Floating Comparison Card */}
                    <div className="w-full bg-white rounded-[20px] shadow-[0_16px_36px_-12px_rgba(0,0,0,0.1)] p-5 sm:p-6 space-y-4">
                      
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="text-xs font-bold text-slate-700">Monthly Bill Breakdown (35,000 WhatsApps)</span>
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                          BYOK Transparent
                        </span>
                      </div>

                      {/* Comparison Columns */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-rose-50/70 border border-rose-200/80 p-4 rounded-xl text-left">
                          <span className="text-[10px] font-bold uppercase text-rose-700">Other WhatsApp CRMs</span>
                          <div className="text-2xl font-black text-rose-600 mt-1">
                            $1,025<span className="text-xs font-normal text-slate-500">/mo</span>
                          </div>
                          <p className="text-[10px] text-slate-600 mt-1">
                            $150/agent + 300% markup on every message.
                          </p>
                        </div>

                        <div className="bg-[#e7f6ea] border border-[#bfe3c8] p-4 rounded-xl text-left">
                          <span className="text-[10px] font-bold uppercase text-[#107038]">WAMA CRM</span>
                          <div className="text-2xl font-black text-[#008069] mt-1">
                            $240<span className="text-xs font-normal text-slate-500">/mo</span>
                          </div>
                          <p className="text-[10px] text-slate-600 mt-1">
                            Flat software fee + wholesale Meta rates.
                          </p>
                        </div>
                      </div>

                      {/* Direct Savings Callout */}
                      <div className="bg-[#0c2014] text-white p-3.5 rounded-xl flex items-center justify-between text-xs">
                        <div>
                          <div className="text-[10px] text-[#27d34b] font-bold uppercase">Direct Monthly Savings</div>
                          <div className="font-extrabold text-white text-sm">Save $785 / month ($9,420 / year)</div>
                        </div>
                        <span className="bg-[#27d34b] text-[#0c2014] font-black text-xs px-2.5 py-1 rounded-full">
                          77% Saved
                        </span>
                      </div>

                    </div>

                  </div>
                </div>

              </div>
            </article>

            {/* ━━━ CARD 4: HOW IT ALL WORKS — COMPLETE MARKETING WORKFLOW ━━━ */}
            <article className="rounded-[32px] bg-gradient-to-br from-[#0c2014] to-[#1a4a2e] p-8 lg:p-12 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.2)] border border-emerald-900/30 transition-all">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
                
                {/* Left Text Column */}
                <div className="lg:col-span-5">
                  <div className="inline-flex items-center gap-2.5 mb-5 text-[13px] font-bold text-white/90">
                    <span className="h-7 w-7 rounded-lg bg-[#27d34b] flex items-center justify-center text-[#0c2014] shadow-xs">
                      <Zap size={15} />
                    </span>
                    <span>The Complete Marketing Engine</span>
                  </div>

                  <h3 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold text-white leading-[1.14] tracking-tight mb-4">
                    How every feature drives your sales.
                  </h3>

                  <p className="text-[15px] sm:text-[16px] text-emerald-100/80 leading-relaxed mb-8">
                    WAMACRM is not just a messaging tool — it&apos;s a full WhatsApp marketing engine. Every feature is designed to work together so you go from importing your first contact to closing deals on autopilot.
                  </p>

                  <div className="space-y-4 mb-8">
                    <div className="flex items-start gap-3">
                      <span className="h-7 w-7 rounded-full bg-[#27d34b]/20 border border-[#27d34b]/40 text-[#27d34b] flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5">1</span>
                      <div>
                        <div className="text-sm font-bold text-white">Import & Organize Your Audience</div>
                        <p className="text-[13px] text-emerald-200/70 mt-0.5">Upload your customer list from Excel/CSV. Tag contacts by segment — VIP, New Lead, Wholesale — for targeted campaigns.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="h-7 w-7 rounded-full bg-[#27d34b]/20 border border-[#27d34b]/40 text-[#27d34b] flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5">2</span>
                      <div>
                        <div className="text-sm font-bold text-white">Launch Personalized Bulk Campaigns</div>
                        <p className="text-[13px] text-emerald-200/70 mt-0.5">Create WhatsApp broadcasts with {`{{name}}`}, {`{{offer}}`} variables. Send to thousands with anti-ban safe pacing via Meta Cloud API.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="h-7 w-7 rounded-full bg-[#27d34b]/20 border border-[#27d34b]/40 text-[#27d34b] flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5">3</span>
                      <div>
                        <div className="text-sm font-bold text-white">Track Everything by Campaign</div>
                        <p className="text-[13px] text-emerald-200/70 mt-0.5">Monitor Sent → Delivered → Read → Replied per campaign. See recipient-level audit logs. Know exactly which messages converted.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="h-7 w-7 rounded-full bg-[#27d34b]/20 border border-[#27d34b]/40 text-[#27d34b] flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5">4</span>
                      <div>
                        <div className="text-sm font-bold text-white">Reply & Close — AI + Human Team</div>
                        <p className="text-[13px] text-emerald-200/70 mt-0.5">When customers reply to your campaign, your AI chatbot handles routine queries 24/7. High-value leads get routed to your sales team&apos;s shared inbox instantly.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="h-7 w-7 rounded-full bg-[#27d34b]/20 border border-[#27d34b]/40 text-[#27d34b] flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5">5</span>
                      <div>
                        <div className="text-sm font-bold text-white">Convert Replies into Pipeline Deals</div>
                        <p className="text-[13px] text-emerald-200/70 mt-0.5">Interested buyers become leads in your Sales Pipeline. Track deal values, move through stages, and measure revenue from every campaign.</p>
                      </div>
                    </div>
                  </div>

                  <Link 
                    href="/signup" 
                    className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-[14px] font-bold text-[#0c2014] transition hover:-translate-y-0.5 bg-[#27d34b] shadow-[0_12px_30px_-8px_rgba(39,211,75,0.5)] hover:shadow-[0_16px_32px_-6px_rgba(39,211,75,0.65)]"
                  >
                    <span>Start Free 14-Day Trial</span>
                    <ArrowRight size={15} />
                  </Link>
                </div>

                {/* Right Visual Column — Marketing Flow Diagram */}
                <div className="lg:col-span-7">
                  <div className="rounded-[24px] bg-white/5 backdrop-blur-sm border border-white/10 p-6 sm:p-8">
                    <div className="w-full space-y-3">

                      {/* Flow Step 1 */}
                      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="h-8 w-8 rounded-lg bg-[#27d34b]/20 flex items-center justify-center">
                            <FileSpreadsheet size={16} className="text-[#27d34b]" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white">Upload Contacts</div>
                            <div className="text-[10px] text-emerald-300/60">customers_diwali.xlsx • 12,845 contacts</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 ml-11">
                          <span className="text-[9px] font-bold bg-[#27d34b]/20 text-[#27d34b] px-2 py-0.5 rounded-full border border-[#27d34b]/30">VIP: 2,400</span>
                          <span className="text-[9px] font-bold bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30">Leads: 5,200</span>
                          <span className="text-[9px] font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">Wholesale: 3,100</span>
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex justify-center">
                        <ChevronDown size={18} className="text-[#27d34b]/50" />
                      </div>

                      {/* Flow Step 2 */}
                      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="h-8 w-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                            <Send size={16} className="text-amber-400" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white">Bulk Campaign Dispatched</div>
                            <div className="text-[10px] text-emerald-300/60">&quot;Diwali Sale 2026&quot; • Personalized with {`{{name}}`}</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5 ml-11">
                          <div className="bg-white/5 rounded-lg p-1.5 text-center border border-white/10">
                            <div className="text-[9px] text-emerald-300/50">Sent</div>
                            <div className="text-xs font-black text-white">12,845</div>
                          </div>
                          <div className="bg-white/5 rounded-lg p-1.5 text-center border border-white/10">
                            <div className="text-[9px] text-emerald-300/50">Delivered</div>
                            <div className="text-xs font-black text-[#27d34b]">98.4%</div>
                          </div>
                          <div className="bg-white/5 rounded-lg p-1.5 text-center border border-white/10">
                            <div className="text-[9px] text-emerald-300/50">Read</div>
                            <div className="text-xs font-black text-[#27d34b]">94.1%</div>
                          </div>
                          <div className="bg-white/5 rounded-lg p-1.5 text-center border border-white/10">
                            <div className="text-[9px] text-amber-300/70">Replied</div>
                            <div className="text-xs font-black text-amber-400">1,248</div>
                          </div>
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex justify-center">
                        <ChevronDown size={18} className="text-[#27d34b]/50" />
                      </div>

                      {/* Flow Step 3 */}
                      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="h-8 w-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                            <Bot size={16} className="text-purple-400" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white">AI + Team Handle Replies</div>
                            <div className="text-[10px] text-emerald-300/60">AI handles FAQs • High-value leads → Team inbox</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-11">
                          <span className="text-[9px] font-bold bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30">🤖 AI: 890 auto-replied</span>
                          <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">👤 Team: 358 handoffs</span>
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex justify-center">
                        <ChevronDown size={18} className="text-[#27d34b]/50" />
                      </div>

                      {/* Flow Step 4 — Revenue */}
                      <div className="bg-gradient-to-r from-[#27d34b]/20 to-[#008069]/20 rounded-2xl p-4 border border-[#27d34b]/30">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-[#27d34b]/30 flex items-center justify-center">
                              <TrendingUp size={16} className="text-[#27d34b]" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white">Sales Pipeline Result</div>
                              <div className="text-[10px] text-emerald-300/70">320 deals created • 89 closed won</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-black text-[#27d34b]">₹24.5L</div>
                            <div className="text-[9px] font-bold text-emerald-400/70">Revenue from 1 campaign</div>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>

              </div>
            </article>

          </div>

        </div>
      </section>

      {/* ━━━ SECTION: WHY WHATSAPP BEATS EMAIL (DIRECT MARKETING ROI) ━━━ */}
      <section id="why-whatsapp" className="py-20 md:py-28 bg-white border-b border-[#e9eeeb]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="max-w-3xl mx-auto text-center mb-16">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f6ea] px-3.5 py-1 text-xs font-semibold text-[#107038] border border-[#bfe3c8] mb-4">
              <TrendingUp size={13} />
              <span>Direct Marketing ROI</span>
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-[46px] font-extrabold text-[#0c2014] tracking-[-0.02em] mb-4">
              Why WhatsApp generates 27x more sales than email.
            </h2>
            <p className="text-base text-[#52635b] font-medium leading-relaxed">
              Your buyers check WhatsApp 23 times a day while emails get lost in Spam tabs. Here is the math comparing 10,000 customer contacts:
            </p>
          </div>

          {/* Clean Funnel Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
            
            {/* The Email Funnel */}
            <div className="bg-rose-50/60 border border-rose-200/80 p-8 rounded-[28px] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-rose-700">Traditional Email Marketing</span>
                  <span className="text-xs font-semibold bg-rose-200/60 text-rose-800 px-2.5 py-0.5 rounded-full">Low Conversion</span>
                </div>
                <h3 className="text-2xl font-bold text-[#0c2014] mb-6">Lost in Spam &amp; Promo Tabs</h3>

                <div className="space-y-4 text-xs sm:text-sm font-medium">
                  <div>
                    <div className="flex justify-between text-slate-700 mb-1">
                      <span>1. Delivered to Inboxes:</span>
                      <span className="font-bold">10,000 emails</span>
                    </div>
                    <div className="w-full h-2.5 bg-rose-200/70 rounded-full overflow-hidden">
                      <div className="bg-rose-500 h-full w-full rounded-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-700 mb-1">
                      <span>2. Opens (18% Average):</span>
                      <span className="font-bold">1,800 opens</span>
                    </div>
                    <div className="w-full h-2.5 bg-rose-200/70 rounded-full overflow-hidden">
                      <div className="bg-rose-500 h-full w-[18%] rounded-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-700 mb-1">
                      <span>3. Click-Throughs (2% CTR):</span>
                      <span className="font-bold">200 clicks</span>
                    </div>
                    <div className="w-full h-2.5 bg-rose-200/70 rounded-full overflow-hidden">
                      <div className="bg-rose-500 h-full w-[2%] rounded-full" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-rose-200 text-rose-900 font-bold text-xs mt-6">
                Result: Only <strong>~25 closed sales</strong> from 10,000 emails sent.
              </div>
            </div>

            {/* The WhatsApp Funnel */}
            <div className="bg-[#e7f6ea]/60 border-2 border-[#bfe3c8] p-8 rounded-[28px] flex flex-col justify-between shadow-xs">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#107038]">WhatsApp AI CRM Marketing</span>
                  <span className="text-xs font-bold bg-[#27d34b] text-[#0c2014] px-2.5 py-0.5 rounded-full">27x More Revenue</span>
                </div>
                <h3 className="text-2xl font-bold text-[#0c2014] mb-6">Direct Attention &amp; Instant Reads</h3>

                <div className="space-y-4 text-xs sm:text-sm font-medium">
                  <div>
                    <div className="flex justify-between text-slate-800 mb-1">
                      <span>1. Delivered to WhatsApp:</span>
                      <span className="font-bold">10,000 messages</span>
                    </div>
                    <div className="w-full h-2.5 bg-[#bfe3c8] rounded-full overflow-hidden">
                      <div className="bg-[#008069] h-full w-full rounded-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-800 mb-1">
                      <span>2. Opens (98.4% Verified):</span>
                      <span className="font-black text-[#008069]">9,840 opens 🔥</span>
                    </div>
                    <div className="w-full h-2.5 bg-[#bfe3c8] rounded-full overflow-hidden">
                      <div className="bg-[#008069] h-full w-[98.4%] rounded-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-800 mb-1">
                      <span>3. Replies &amp; 1-Tap Clicks (34.2%):</span>
                      <span className="font-black text-[#008069]">3,420 interactions</span>
                    </div>
                    <div className="w-full h-2.5 bg-[#bfe3c8] rounded-full overflow-hidden">
                      <div className="bg-[#27d34b] h-full w-[34.2%] rounded-full" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-[#bfe3c8] text-[#0e6331] font-bold text-xs mt-6">
                Result: <strong>~680 closed sales</strong> from the exact same 10,000 customers!
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* ━━━ SECTION: SOCIAL PROOF TESTIMONIALS (OMNIENGAGE STYLE) ━━━ */}
      <section className="py-20 md:py-28 bg-white border-b border-[#e9eeeb]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 text-center">
          
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0c2014] tracking-[-0.02em] mb-4">
            Trusted by fast-growing commerce brands.
          </h2>
          <p className="text-base text-[#52635b] font-medium mb-14">
            Real founders seeing real ROI from our WhatsApp AI Chatbot &amp; Bulk Broadcasts.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto text-left">
            
            <div className="bg-[#fafbfa] p-7 rounded-[28px] border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex text-amber-400">
                {[...Array(5)].map((_, i) => <Star key={i} size={15} fill="currentColor" />)}
              </div>
              <p className="text-xs sm:text-sm text-slate-700 font-medium leading-relaxed">
                “WhatsApp went from an afterthought to our #1 revenue channel. The AI Chatbot qualifies buyers at 2 AM and books consultations automatically.”
              </p>
              <div className="pt-3 border-t border-slate-100 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-[#008069] text-white font-bold text-xs flex items-center justify-center">
                  RC
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">Ravi Chennu</div>
                  <div className="text-[10px] text-slate-500">Founder, TrendKart D2C</div>
                </div>
              </div>
            </div>

            <div className="bg-[#fafbfa] p-7 rounded-[28px] border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex text-amber-400">
                {[...Array(5)].map((_, i) => <Star key={i} size={15} fill="currentColor" />)}
              </div>
              <p className="text-xs sm:text-sm text-slate-700 font-medium leading-relaxed">
                “Our bulk campaigns from Excel achieve 98% open rates in minutes. Eliminating per-message markup saved us over $2,400 on our very first campaign!”
              </p>
              <div className="pt-3 border-t border-slate-100 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-[#00a884] text-white font-bold text-xs flex items-center justify-center">
                  SK
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">Dr. Sarah Klein</div>
                  <div className="text-[10px] text-slate-500">Growth Lead, MedCare Global</div>
                </div>
              </div>
            </div>

            <div className="bg-[#fafbfa] p-7 rounded-[28px] border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex text-amber-400">
                {[...Array(5)].map((_, i) => <Star key={i} size={15} fill="currentColor" />)}
              </div>
              <p className="text-xs sm:text-sm text-slate-700 font-medium leading-relaxed">
                “The shared team inbox means our support team never steps on each other's toes. When the AI hands off a deal, we close it immediately.”
              </p>
              <div className="pt-3 border-t border-slate-100 flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-[#107038] text-white font-bold text-xs flex items-center justify-center">
                  AJ
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">Ananya Joshi</div>
                  <div className="text-[10px] text-slate-500">Operations Director, Apex Retail</div>
                </div>
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* ━━━ SECTION: FAQ ACCORDION ━━━ */}
      <section id="faq" className="py-20 md:py-28 bg-[#fafbfa] border-b border-[#e9eeeb]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-xl mx-auto mb-14">
            <h2 className="text-3xl font-extrabold text-[#0c2014] tracking-tight mb-2">
              Frequently asked questions
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 font-medium">
              Everything you need to know about setting up your WhatsApp AI Chatbot and Bulk Broadcasts.
            </p>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, index) => {
              const isOpen = openFaq === index
              return (
                <div 
                  key={index} 
                  className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden transition shadow-2xs"
                >
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    className="w-full px-6 py-4.5 text-left flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 transition"
                  >
                    <span className="text-sm sm:text-base font-bold text-[#0c2014]">{faq.q}</span>
                    <ChevronDown 
                      size={17} 
                      className={`text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[#008069]' : ''}`} 
                    />
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 text-xs sm:text-sm text-[#52635b] leading-relaxed font-normal border-t border-slate-100 bg-[#fafbfa]">
                      {faq.a}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

        </div>
      </section>

      {/* ━━━ SECTION: BOOK A DEMO FORM ━━━ */}
      <section id="demo" className="py-20 bg-white border-b border-[#e9eeeb]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            
            {/* Left Pitch */}
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f6ea] px-3.5 py-1 text-xs font-semibold text-[#107038] border border-[#bfe3c8] mb-4">
                <HelpCircle size={13} />
                <span>Ready to accelerate your revenue?</span>
              </span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#0c2014] mb-4 tracking-[-0.02em] leading-tight">
                Schedule a 1-on-1 setup walkthrough.
              </h2>
              <p className="text-xs sm:text-sm text-[#52635b] mb-6 leading-relaxed font-normal">
                Connect with our WhatsApp platform specialists to link your Meta Cloud API, train your AI chatbot on your catalog, and test your first broadcast.
              </p>

              <div className="space-y-3 text-xs sm:text-sm font-semibold text-slate-700">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 size={16} className="text-[#008069]" />
                  <span>Free 20-minute tailored WhatsApp setup consultation</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 size={16} className="text-[#008069]" />
                  <span>14-day free access to the WhatsApp AI Chatbot sandbox</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 size={16} className="text-[#008069]" />
                  <span>Zero setup fees &amp; free contact list migration assistance</span>
                </div>
              </div>
            </div>

            {/* Right Form Card */}
            <div className="bg-[#fafbfa] p-6 sm:p-8 rounded-[28px] border border-slate-200/90 shadow-sm">
              {demoSubmitted ? (
                <div className="p-8 text-center bg-[#e7f6ea] rounded-2xl border border-[#bfe3c8]">
                  <div className="h-10 w-10 rounded-full bg-[#008069] text-white flex items-center justify-center mx-auto mb-3">
                    <Check size={20} />
                  </div>
                  <h4 className="text-base font-bold text-[#0c2014] mb-1">Demo Request Received!</h4>
                  <p className="text-xs text-slate-600">
                    A WhatsApp platform specialist will contact you with your private demo link within 2 business hours.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleDemoSubmit} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Full Name
                    </label>
                    <input 
                      type="text"
                      required
                      value={demoForm.name}
                      onChange={(e) => setDemoForm({ ...demoForm, name: e.target.value })}
                      placeholder="Alex Morgan"
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-[#008069] bg-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Work Email
                      </label>
                      <input 
                        type="email"
                        required
                        value={demoForm.email}
                        onChange={(e) => setDemoForm({ ...demoForm, email: e.target.value })}
                        placeholder="alex@company.com"
                        className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-[#008069] bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        WhatsApp Phone
                      </label>
                      <input 
                        type="tel"
                        required
                        value={demoForm.phone}
                        onChange={(e) => setDemoForm({ ...demoForm, phone: e.target.value })}
                        placeholder="+1 (555) 019-2834"
                        className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-[#008069] bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Primary Goal
                    </label>
                    <select
                      value={demoForm.objective}
                      onChange={(e) => setDemoForm({ ...demoForm, objective: e.target.value })}
                      className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-[#008069] bg-white font-medium text-slate-800"
                    >
                      <option>WhatsApp AI Chatbot (24/7 Autonomous Sales)</option>
                      <option>WhatsApp Bulk Marketing (Excel/CSV Broadcasts)</option>
                      <option>Both AI Chatbot &amp; Bulk Marketing</option>
                      <option>Wholesale Cost Savings Migration</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={demoLoading}
                    className="w-full rounded-full bg-[#27d34b] hover:bg-[#20bf41] text-[#0c2014] text-xs font-bold py-3 shadow-sm hover:shadow-md transition active:scale-[0.98] cursor-pointer"
                  >
                    {demoLoading ? 'Submitting...' : 'Get Instant Demo Access →'}
                  </button>
                </form>
              )}
            </div>

          </div>
        </div>
      </section>

      {/* ━━━ FOOTER (OMNIENGAGE STYLE DEEP FOREST GREEN) ━━━ */}
      <footer className="bg-[#0c2014] text-slate-400 py-12 border-t border-[#1a3826]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-8 border-b border-white/10">
            
            <div className="flex items-center gap-3">
              <img 
                src="/wamacrm-logo.png" 
                alt="WAMACRM Logo" 
                className="h-10 w-10 rounded-xl object-contain shadow-sm border border-white/10 bg-white" 
              />
              <div className="flex flex-col text-left">
                <span className="font-bold text-sm text-white tracking-tight leading-none flex items-center gap-1.5">
                  WAMACRM <span className="text-[#27d34b] text-xs font-semibold px-1.5 py-0.5 bg-white/10 rounded">AI</span>
                </span>
                <span className="text-[10px] text-slate-400 mt-1 font-medium">
                  WhatsApp Marketing Agent CRM by Magnetora AI
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs font-semibold text-slate-300">
              <a href="#showcase" className="hover:text-white transition">Broadcasts</a>
              <a href="#features-pipeline" className="hover:text-white transition">Sales Pipeline</a>
              <a href="#features-ai" className="hover:text-white transition">24/7 AI Chatbot</a>
              <a href="#features-ticketing" className="hover:text-white transition">Ticketing &amp; SLAs</a>
              <a href="#features-team" className="hover:text-white transition">Team Management</a>
              <a href="#why-whatsapp" className="hover:text-white transition">Why WhatsApp?</a>
              <a href="#faq" className="hover:text-white transition">FAQ</a>
              <Link href="/privacy" className="hover:text-[#27d34b] transition">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-[#27d34b] transition">Terms of Service</Link>
              <Link href="/data-deletion" className="hover:text-[#27d34b] transition">Data Deletion</Link>
            </div>

          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between pt-6 text-[11px] text-slate-500 gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span>&copy; {new Date().getFullYear()} WAMA - WhatsApp Marketing Agent CRM by Magnetora AI. Built for high-growth commerce brands.</span>
              <span className="hidden sm:inline">•</span>
              <Link href="/privacy" className="hover:text-slate-300 underline underline-offset-2 transition">Privacy Policy</Link>
              <span>•</span>
              <Link href="/terms" className="hover:text-slate-300 underline underline-offset-2 transition">Terms &amp; Conditions</Link>
              <span>•</span>
              <Link href="/data-deletion" className="hover:text-slate-300 underline underline-offset-2 transition">User Data Deletion</Link>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[#27d34b] font-medium">WhatsApp Cloud API Integration</span>
              <span>•</span>
              <span>Enterprise Grade Security</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  )
}
