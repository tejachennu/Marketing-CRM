import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, BookOpen, FileJson, KeyRound } from 'lucide-react'
import { messageOrigin } from '@/lib/salon/jobs'
import { API_GROUPS, ERROR_CODES, RATE_LIMIT_PER_MINUTE, SCOPE_DOCS, type EndpointDoc, type ParamDoc } from '@/lib/public-api/spec'
import { CopyButton } from './copy-button'

export const metadata: Metadata = {
  title: 'API documentation · WAMA CRM',
  description: 'Connect your website, app or till to WAMA CRM: contacts, WhatsApp messages, bookings and bills.',
}

const METHOD_TONE: Record<string, string> = {
  GET: 'bg-[#e8f7f1] text-[#047857]',
  POST: 'bg-[#eef3fe] text-[#1D5BEA]',
  PATCH: 'bg-[#fff4e0] text-[#b45309]',
}

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div className="min-w-0">
      {label && <p className="text-[12.5px] font-bold uppercase tracking-wide text-[#6B7894] mb-1.5">{label}</p>}
      <div className="relative">
        <pre className="overflow-x-auto rounded-xl bg-[#0E1B3D] text-[#e6edf7] text-[12.5px] sm:text-[13px] leading-relaxed p-4 pr-12"><code>{children}</code></pre>
        <CopyButton text={children} />
      </div>
    </div>
  )
}

function Params({ title, params }: { title: string; params: ParamDoc[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] font-bold uppercase tracking-wide text-[#6B7894] mb-1.5">{title}</p>
      <ul className="rounded-xl border border-[#e3e8f2] divide-y divide-[#eef1f6] bg-white">
        {params.map((param) => (
          <li key={param.name} className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-baseline gap-x-3 gap-y-0.5">
            <span className="sm:w-56 shrink-0"><code className="text-[13px] font-bold text-[#0E1B3D] [overflow-wrap:anywhere]">{param.name}</code>{param.required && <span className="ml-1.5 text-[11.5px] font-bold text-[#b91c1c]">required</span>}<span className="block text-[12px] text-[#8a94a8]">{param.type}</span></span>
            {param.description && <span className="text-[13.5px] text-[#4a5672]">{param.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function curl(endpoint: EndpointDoc, base: string): string {
  const path = endpoint.path.replace('{id}', '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d') + (endpoint.exampleQuery || '')
  const lines = [`curl${endpoint.method === 'GET' ? '' : ` -X ${endpoint.method}`} "${base}${path}" \\`, '  -H "Authorization: Bearer $WAMA_API_KEY"']
  if (endpoint.requestExample) {
    lines[lines.length - 1] += ' \\'
    lines.push('  -H "Content-Type: application/json" \\', `  -d '${JSON.stringify(endpoint.requestExample, null, 2).replace(/\n/g, '\n  ')}'`)
  }
  return lines.join('\n')
}

function Endpoint({ endpoint, base }: { endpoint: EndpointDoc; base: string }) {
  return (
    <article id={endpoint.id} className="scroll-mt-24 rounded-2xl border border-[#e3e8f2] bg-white p-4 sm:p-6 space-y-4 min-w-0">
      <div className="space-y-2">
        <h3 className="text-[18px] font-extrabold text-[#0E1B3D]">{endpoint.title}</h3>
        <p className="flex flex-wrap items-center gap-2 min-w-0">
          <span className={`inline-flex items-center h-6 px-2 rounded-md text-[12px] font-extrabold ${METHOD_TONE[endpoint.method]}`}>{endpoint.method}</span>
          <code className="text-[14px] font-bold text-[#0E1B3D] [overflow-wrap:anywhere]">/api/v1{endpoint.path}</code>
          <span className="inline-flex items-center h-6 px-2 rounded-md bg-[#f4f6fa] text-[12px] font-semibold text-[#4a5672]">{endpoint.scope ? `Permission: ${endpoint.scope}` : 'Any key'}</span>
        </p>
        {endpoint.description && <p className="text-[14.5px] leading-relaxed text-[#4a5672]">{endpoint.description}</p>}
      </div>
      {endpoint.pathParams && <Params title="Path" params={endpoint.pathParams} />}
      {endpoint.query && <Params title="Query" params={endpoint.query} />}
      {endpoint.body && <Params title="Body (JSON)" params={endpoint.body} />}
      <Code label="Example request">{curl(endpoint, base)}</Code>
      <Code label={`Response · ${endpoint.status}`}>{JSON.stringify(endpoint.responseExample, null, 2)}</Code>
      {endpoint.errors && <p className="text-[13px] text-[#6B7894]">Errors: {endpoint.errors.map((code, i) => <span key={code}>{i > 0 && ', '}<a href="#errors" className="font-semibold text-[#1D5BEA] hover:underline"><code>{code}</code></a></span>)}</p>}
    </article>
  )
}

const H2 = ({ id, children }: { id: string; children: React.ReactNode }) => <h2 id={id} className="scroll-mt-24 text-[24px] sm:text-[28px] font-extrabold tracking-tight text-[#0E1B3D]">{children}</h2>
const P = ({ children }: { children: React.ReactNode }) => <p className="text-[15px] leading-relaxed text-[#4a5672]">{children}</p>

export default function DevelopersPage() {
  const origin = messageOrigin()
  const base = `${origin}/api/v1`
  const nav = [
    { id: 'quick-start', title: 'Quick start' }, { id: 'authentication', title: 'Authentication' }, { id: 'conventions', title: 'Requests and responses' },
    { id: 'errors', title: 'Errors' }, { id: 'rate-limits', title: 'Rate limits' },
    ...API_GROUPS.map((g) => ({ id: g.id, title: g.title })), { id: 'openapi', title: 'OpenAPI and Postman' },
  ]
  return (
    <div className="min-h-screen bg-[#f6f8fc] text-[#0E1B3D]">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[#e3e8f2]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <span className="h-9 w-9 shrink-0 rounded-xl bg-[#0E1B3D] text-white flex items-center justify-center"><BookOpen size={18} /></span>
            <span className="min-w-0"><span className="block text-[16px] font-extrabold leading-tight truncate">WAMA CRM API</span><span className="block text-[12px] text-[#6B7894] leading-tight">Version 1</span></span>
          </Link>
          <div className="flex items-center gap-2">
            <a href="/api/v1/openapi.json" className="hidden sm:inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-[#d5ddeb] text-[14px] font-semibold hover:bg-[#f4f6fa]"><FileJson size={16} /> OpenAPI</a>
            <Link href="/dashboard/settings?tab=api" className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-[#1D5BEA] hover:bg-[#174bc4] text-white text-[14px] font-bold"><KeyRound size={16} /> <span className="hidden min-[400px]:inline">Get an API key</span><span className="min-[400px]:hidden">API key</span></Link>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="On this page" className="hidden lg:block sticky top-24 self-start">
          <p className="text-[12px] font-bold uppercase tracking-wide text-[#8a94a8] mb-2">On this page</p>
          <ul className="space-y-0.5">
            {nav.map((item) => <li key={item.id}><a href={`#${item.id}`} className="block px-2.5 py-1.5 rounded-lg text-[14px] font-medium text-[#4a5672] hover:bg-white hover:text-[#0E1B3D]">{item.title}</a></li>)}
          </ul>
        </nav>

        <main className="min-w-0 space-y-12">
          <section className="space-y-4">
            <p className="inline-flex items-center h-7 px-2.5 rounded-full bg-[#eef3fe] text-[#1D5BEA] text-[12.5px] font-bold">REST · JSON · HTTPS</p>
            <h1 className="text-[32px] sm:text-[42px] font-extrabold tracking-tight leading-tight">Connect your systems to WAMA CRM</h1>
            <P>Add contacts and enquiries from your website, send WhatsApp messages from your own software, take bookings from your app, and create bills from your till. Everything you do through the API shows up in WAMA CRM at once: contacts in Contacts, messages in the inbox, deals on the Sales Pipeline board, bookings and bills on the Front Desk counter.</P>
            <div className="rounded-2xl border border-[#e3e8f2] bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
              <span className="text-[13px] font-bold uppercase tracking-wide text-[#6B7894] shrink-0">Base URL</span>
              <code className="text-[14.5px] font-bold [overflow-wrap:anywhere]">{base}</code>
            </div>
            <details className="lg:hidden rounded-2xl border border-[#e3e8f2] bg-white">
              <summary className="px-4 py-3 text-[14.5px] font-bold cursor-pointer">On this page</summary>
              <ul className="px-2 pb-3 grid grid-cols-1 min-[420px]:grid-cols-2 gap-0.5">
                {nav.map((item) => <li key={item.id}><a href={`#${item.id}`} className="block px-2.5 py-2 rounded-lg text-[14px] text-[#4a5672] hover:bg-[#f4f6fa]">{item.title}</a></li>)}
              </ul>
            </details>
          </section>

          <section className="space-y-4">
            <H2 id="quick-start">Quick start</H2>
            <ol className="space-y-5">
              <li className="space-y-2">
                <p className="text-[15.5px] font-bold">1. Create an API key</p>
                <P>An admin creates keys in <Link href="/dashboard/settings?tab=api" className="font-semibold text-[#1D5BEA] hover:underline">Settings → API</Link>. Name it after what will use it, and choose what it may do. The key is shown once: keep it somewhere safe, on your server only.</P>
              </li>
              <li className="space-y-2">
                <p className="text-[15.5px] font-bold">2. Check that it works</p>
                <Code>{`export WAMA_API_KEY="wama_live_…"\n\ncurl "${base}/me" \\\n  -H "Authorization: Bearer $WAMA_API_KEY"`}</Code>
              </li>
              <li className="space-y-2">
                <p className="text-[15.5px] font-bold">3. Add a contact from your website (Node.js)</p>
                <Code>{`const response = await fetch('${base}/contacts', {\n  method: 'POST',\n  headers: {\n    Authorization: \`Bearer \${process.env.WAMA_API_KEY}\`,\n    'Content-Type': 'application/json',\n  },\n  body: JSON.stringify({ name: 'Priya Sharma', phone: '+919876543210', tags: ['Website'] }),\n})\nconst { data, error } = await response.json()\nif (error) throw new Error(error.message)\nconsole.log('Saved contact', data.id)`}</Code>
              </li>
            </ol>
          </section>

          <section className="space-y-4">
            <H2 id="authentication">Authentication</H2>
            <P>Send the key with every request, in the Authorization header. Each key belongs to one workspace and can only reach that workspace&apos;s data.</P>
            <Code>{'Authorization: Bearer wama_live_AbCdEf…'}</Code>
            <P>Never put a key in a web page or mobile app, where anyone can read it: call the API from your server. If a key leaks, revoke it in Settings → API and create a new one. Revoked keys stop working at once.</P>
            <p className="text-[15.5px] font-bold pt-2">Permissions</p>
            <ul className="rounded-2xl border border-[#e3e8f2] divide-y divide-[#eef1f6] bg-white">
              {SCOPE_DOCS.map((s) => <li key={s.scope} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-0.5"><code className="sm:w-44 shrink-0 text-[13.5px] font-bold">{s.scope}</code><span className="text-[14px] text-[#4a5672]">{s.meaning}</span></li>)}
            </ul>
          </section>

          <section className="space-y-4">
            <H2 id="conventions">Requests and responses</H2>
            <ul className="space-y-3 text-[15px] leading-relaxed text-[#4a5672] list-disc pl-5">
              <li>Send and receive JSON. Send <code className="font-semibold text-[#0E1B3D]">Content-Type: application/json</code> with a body.</li>
              <li>One record comes back as <code className="font-semibold text-[#0E1B3D]">{'{ "data": { … } }'}</code>. A list comes back as <code className="font-semibold text-[#0E1B3D]">{'{ "data": [ … ], "pagination": { "limit", "offset", "has_more" } }'}</code>: while <code className="font-semibold text-[#0E1B3D]">has_more</code> is true, ask again with <code className="font-semibold text-[#0E1B3D]">offset</code> increased by <code className="font-semibold text-[#0E1B3D]">limit</code>.</li>
              <li>Times are ISO 8601 (<code className="font-semibold text-[#0E1B3D]">2026-11-08T17:00:00+05:30</code>); answers are in UTC. Days (<code className="font-semibold text-[#0E1B3D]">2026-11-08</code>) and clock times (<code className="font-semibold text-[#0E1B3D]">17:00</code>) are India time.</li>
              <li>Phone numbers include the country code: <code className="font-semibold text-[#0E1B3D]">+919876543210</code>. A 10-digit Indian mobile number is also accepted.</li>
              <li>Amounts are in rupees, with paise as decimals.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <H2 id="errors">Errors</H2>
            <P>Errors use the HTTP status and always have the same shape. <code className="font-semibold text-[#0E1B3D]">message</code> is written to show to a person; <code className="font-semibold text-[#0E1B3D]">field</code> names the value that is wrong, when there is one.</P>
            <Code>{JSON.stringify({ error: { code: 'invalid_request', message: 'Give the phone number with its country code, like +919876543210.', field: 'phone' } }, null, 2)}</Code>
            <ul className="rounded-2xl border border-[#e3e8f2] divide-y divide-[#eef1f6] bg-white">
              {ERROR_CODES.map((e) => <li key={e.code} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-0.5"><span className="sm:w-60 shrink-0 flex items-center gap-2"><span className="inline-flex items-center justify-center w-10 h-6 rounded-md bg-[#f4f6fa] text-[12px] font-bold text-[#4a5672]">{e.status}</span><code className="text-[13.5px] font-bold">{e.code}</code></span><span className="text-[14px] text-[#4a5672]">{e.meaning}</span></li>)}
            </ul>
          </section>

          <section className="space-y-4">
            <H2 id="rate-limits">Rate limits</H2>
            <P>Each key can make {RATE_LIMIT_PER_MINUTE} requests a minute, and send at most 60 WhatsApp messages a minute (for bulk sending, use Campaigns). Over the limit, the answer is 429 with a <code className="font-semibold text-[#0E1B3D]">Retry-After</code> header: wait that many seconds and try again.</P>
          </section>

          {API_GROUPS.map((group) => (
            <section key={group.id} className="space-y-4">
              <H2 id={group.id}>{group.title}</H2>
              <P>{group.description}</P>
              <div className="space-y-5">{group.endpoints.map((endpoint) => <Endpoint key={endpoint.id} endpoint={endpoint} base={base} />)}</div>
            </section>
          ))}

          <section className="space-y-4">
            <H2 id="openapi">OpenAPI and Postman</H2>
            <P>The whole API is described in an OpenAPI 3.1 file. Import it into Postman or Insomnia to try every endpoint, or generate a client for your language.</P>
            <a href="/api/v1/openapi.json" className="inline-flex max-w-full items-center gap-2 min-h-11 py-2 px-4 rounded-xl bg-[#0E1B3D] text-white text-[15px] font-bold [overflow-wrap:anywhere]"><FileJson size={17} /> {`${base}/openapi.json`.replace(/^https?:\/\//, '')} <ArrowRight size={16} /></a>
          </section>
        </main>
      </div>
    </div>
  )
}
