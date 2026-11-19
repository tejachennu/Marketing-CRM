require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const T = require('../lib/ai/knowledge-text.ts')
const KS = require('../lib/ai/knowledge-sources.ts')
const R = require('../lib/ai/knowledge-rules.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const ORG = '11111111-1111-4111-8111-111111111111'

test('a web page becomes readable text with its headings, without menus and scripts', () => {
  const html = `<html><head><title>Glow Salon &amp; Spa</title><script>var x = "hidden"</script><style>.a{}</style></head><body>
<nav><a href="/about">About</a></nav><main><h1>Our services</h1><p>Hair cut costs &#8377;300. Open 10 am to 9 pm.</p>
<ul><li>Facial</li><li>Pedicure</li></ul><h2>Parking</h2><p>Free parking behind the shop for every customer who visits.</p>
<a href="/prices#top">Prices</a><a href="https://other.com/x">x</a><a href="/menu.pdf">menu</a><a href="/cart">cart</a></main><footer>© 2026 Glow</footer></body></html>`
  const page = T.htmlToText(html, 'https://glow.in/')
  assert.equal(page.title, 'Glow Salon & Spa')
  assert.match(page.text, /^# Our services/)
  assert.match(page.text, /Hair cut costs ₹300\./)
  assert.match(page.text, /• Facial/)
  assert.doesNotMatch(page.text, /hidden|© 2026|About/)
  assert.deepEqual(T.sameSiteLinks(page.links, 'https://www.glow.in/'), ['https://glow.in/about', 'https://glow.in/prices'], 'menu links are followed; other sites, files and the cart are not')
})

test('robots.txt and sitemaps', () => {
  const rules = T.readRobots('User-agent: Googlebot\nDisallow: /only-google\n\nUser-agent: *\nDisallow: /private\nDisallow: /*.php$\nSitemap: https://glow.in/sitemap.xml')
  assert.deepEqual(rules, { disallow: ['/private', '/*.php$'], sitemaps: ['https://glow.in/sitemap.xml'] })
  assert.equal(T.robotsAllow('https://glow.in/private/x', rules.disallow), false)
  assert.equal(T.robotsAllow('https://glow.in/old.php', rules.disallow), false)
  assert.equal(T.robotsAllow('https://glow.in/only-google', rules.disallow), true)
  assert.deepEqual(T.sitemapLinks('<urlset><url><loc>https://glow.in/a</loc></url><url><loc> https://glow.in/b?x=1&amp;y=2 </loc></url></urlset>').pages, ['https://glow.in/a', 'https://glow.in/b?x=1&y=2'])
  assert.deepEqual(T.sitemapLinks('<sitemapindex><sitemap><loc>https://glow.in/s1.xml</loc></sitemap></sitemapindex>'), { pages: [], sitemaps: ['https://glow.in/s1.xml'] })
})

test('long text is split into parts that keep their heading, with a little overlap', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} explains the return and refund policy in some detail.`).join(' ')
  const parts = T.chunkText(`# Returns\n\n${long}\n\n# Delivery\n\nWe deliver in 3 days.`, { size: 500, overlap: 100 })
  assert.ok(parts.length >= 5)
  assert.ok(parts.every((p) => p.text.length <= 750), 'never more than 1.5 × the size')
  assert.deepEqual([...new Set(parts.map((p) => p.heading))], ['Returns', 'Delivery'])
  assert.equal(parts.at(-1).text, 'We deliver in 3 days.')
  // Overlap: a part starts with the end of the one before
  const firstEnd = parts[0].text.slice(-40)
  assert.ok(parts[1].text.includes(firstEnd.slice(firstEnd.indexOf(' ') + 1, firstEnd.indexOf(' ') + 15)))
  assert.deepEqual(T.chunkText(''), [])
  assert.equal(T.chunkTitle('Menu', { heading: 'Prices', text: 'x', page: 2 }), 'Menu — Prices — page 2')
})

test('FAQ attachments: kinds, WhatsApp limits, https only', () => {
  assert.equal(T.mediaTypeOf('price-list.JPG'), 'image')
  assert.equal(T.mediaTypeOf('tour.mp4'), 'video')
  assert.equal(T.mediaTypeOf('brochure.pdf'), 'document')
  assert.equal(T.mediaTypeOf('song.mp3'), null)
  const media = T.cleanMedia([
    { type: 'image', url: 'https://cdn.x/a.jpg', name: 'Price list' },
    { type: 'image', url: 'https://cdn.x/a.jpg' },
    { type: 'link', url: 'http://insecure.x' },
    { type: 'video', url: 'javascript:alert(1)' },
    { type: 'pdf', url: 'https://cdn.x/b.pdf' },
    { type: 'link', url: 'https://glow.in/book', name: 'Book online' },
  ])
  assert.deepEqual(media, [{ type: 'image', url: 'https://cdn.x/a.jpg', name: 'Price list' }, { type: 'link', url: 'https://glow.in/book', name: 'Book online' }])
  assert.equal(T.cleanMedia(Array.from({ length: 9 }, (_, i) => ({ type: 'link', url: `https://x.in/${i}` }))).length, T.MAX_MEDIA)
})

test('only public websites are read', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '100.64.0.1']) assert.equal(T.isPrivateAddress(ip), true, ip)
  for (const ip of ['8.8.8.8', '103.21.244.1', '2606:4700::1111']) assert.equal(T.isPrivateAddress(ip), false, ip)
  assert.deepEqual(T.cleanWebsiteUrl('www.glow.in/services'), { url: 'https://www.glow.in/services' })
  for (const bad of ['', 'localhost:3000', 'http://169.254.169.254/latest', 'ftp://glow.in', 'https://user:pw@glow.in', 'intranet', 'http://printer.local']) assert.ok('error' in T.cleanWebsiteUrl(bad), bad)
})

test('PDFs (page by page) and Word files (with headings) are read', async () => {
  const pdf = await KS.readFileText(fs.readFileSync(path.join(__dirname, 'fixtures/knowledge-sample.pdf')), 'menu.pdf')
  assert.equal(pdf.pageCount, 2)
  assert.deepEqual(pdf.pages.map((p) => p.page), [1, 2])
  assert.match(pdf.pages[0].text, /Hair cut costs 300 rupees/)
  const docx = await KS.readFileText(fs.readFileSync(path.join(__dirname, 'fixtures/knowledge-sample.docx')), 'Policy.DOCX')
  assert.equal(docx.pages[0].text, '# Returns\n\nYou can return any item within 7 days of delivery.')
  assert.equal((await KS.readFileText(Buffer.from('Line one\nLine two'), 'notes.txt')).pages[0].text, 'Line one\nLine two')
  await assert.rejects(() => KS.readFileText(Buffer.from('x'), 'virus.exe'), /cannot be read/)
})

const page = (body, type = 'text/html') => new Response(body, { status: 200, headers: { 'content-type': type } })
const publicDns = async () => [{ address: '93.184.216.34' }]

test('a whole website is read through its sitemap and links, keeping out of robots.txt', async () => {
  const site = {
    'https://glow.in/robots.txt': page('User-agent: *\nDisallow: /secret\nSitemap: https://glow.in/sitemap.xml', 'text/plain'),
    'https://glow.in/sitemap.xml': page('<urlset><url><loc>https://glow.in/services</loc></url><url><loc>https://glow.in/secret</loc></url></urlset>', 'application/xml'),
    'https://glow.in/': page('<html><body><h1>Welcome</h1><p>Glow Salon in Hyderabad, open every day from 10 am.</p><a href="/contact">Contact</a></body></html>'),
    'https://glow.in/services': page('<html><body><h1>Services</h1><p>Hair cut 300 rupees, facial 900 rupees, pedicure 600.</p></body></html>'),
    'https://glow.in/contact': page('<html><body><h1>Contact</h1><p>Call us on 90000 00000 or visit Road No 1, Banjara Hills.</p></body></html>'),
    'https://glow.in/secret': page('<html><body><p>Staff only page that must never be read by the robot.</p></body></html>'),
  }
  const asked = []
  const fetcher = async (url) => { asked.push(url); return site[url] ? site[url].clone() : new Response('no', { status: 404 }) }
  const pages = await KS.readWebsite('https://glow.in/', true, { fetcher, resolve: publicDns })
  assert.deepEqual(pages.map((p) => p.url).sort(), ['https://glow.in/', 'https://glow.in/contact', 'https://glow.in/services'])
  assert.ok(!asked.includes('https://glow.in/secret'))
  const one = await KS.readWebsite('https://glow.in/services', false, { fetcher, resolve: publicDns })
  assert.equal(one.length, 1)
})

test('a website that points to a private address is never read', async () => {
  const fetcher = async () => page('<p>internal</p>')
  await assert.rejects(() => KS.fetchPublic('https://glow.in/', { fetcher, resolve: async () => [{ address: '10.0.0.5' }] }), /not a public website/)
  // A redirect to a private address is refused too
  const hop = async (url) => (url.startsWith('https://glow.in') ? new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest' } }) : page('secret'))
  await assert.rejects(() => KS.fetchPublic('https://glow.in/', { fetcher: hop, resolve: publicDns }), /cannot be read/)
  // Too big
  await assert.rejects(() => KS.fetchPublic('https://glow.in/', { fetcher: async () => page('x'.repeat(5000)), resolve: publicDns, maxBytes: 1000 }), /too big/)
})

test('a source is read into parts; reading again replaces them; nothing to read says why', async () => {
  const db = salonDb({ knowledge_sources: [{ id: 's1', organization_id: ORG, kind: 'text', title: 'Return policy', status: 'processing' }], knowledge_base: [] })
  const source = { id: 's1', organization_id: ORG, kind: 'text', title: 'Return policy' }
  const text = '# Returns\n\nYou can return any item within 7 days of delivery. Refunds reach your bank in 5 working days.\n\n# Exchanges\n\nSizes can be exchanged once, free of charge, at the shop.'
  const first = await KS.ingestSource(db, null, source, { text })
  assert.deepEqual(first, { ok: true, parts: 2 })
  assert.equal(db.tables.knowledge_base.length, 2)
  assert.deepEqual(db.tables.knowledge_base.map((r) => [r.kind, r.source_id, r.title]), [['part', 's1', 'Return policy — Returns'], ['part', 's1', 'Return policy — Exchanges']])
  assert.equal(db.tables.knowledge_sources[0].status, 'ready')
  assert.equal(db.tables.knowledge_sources[0].chunk_count, 2)
  await KS.ingestSource(db, null, source, { text: '# Returns\n\nReturns are now within 10 days of delivery, with the bill.' })
  assert.equal(db.tables.knowledge_base.length, 1, 'the old parts are gone')
  assert.match(db.tables.knowledge_base[0].content, /10 days/)
  const empty = await KS.ingestSource(db, null, { ...source, kind: 'pdf', file_path: 'x.pdf', file_name: 'scan.pdf' }, { download: async () => fs.readFileSync(path.join(__dirname, 'fixtures/knowledge-sample.docx')).subarray(0, 10) })
  assert.equal(empty.ok, false)
  assert.equal(db.tables.knowledge_sources[0].status, 'failed')
})

test('answers send the used FAQs\' files and links, never on a hand-off', () => {
  const hits = [
    { title: 'Price list', content: 'See the photo', media: [{ type: 'image', url: 'https://cdn/p.jpg', name: 'Prices' }, { type: 'link', url: 'https://glow.in/book', name: 'Book online' }] },
    { title: 'Brochure', content: 'PDF', media: [{ type: 'document', url: 'https://cdn/b.pdf', name: 'Brochure.pdf' }] },
  ]
  assert.deepEqual(R.answerExtras(hits, [1], false), { attachments: [{ type: 'image', url: 'https://cdn/p.jpg', name: 'Prices' }], links: ['Book online: https://glow.in/book'] })
  assert.equal(R.answerExtras(hits, [1, 2], false).attachments.length, 2)
  assert.deepEqual(R.answerExtras(hits, [1], true), { attachments: [], links: [] })
  assert.deepEqual(R.answerExtras(hits, [], false), { attachments: [], links: [] })
  assert.equal(R.withLinks('Hair cut is ₹300.', ['Book online: https://glow.in/book']), 'Hair cut is ₹300.\n\nBook online: https://glow.in/book')
  assert.equal(R.withLinks('Book at https://glow.in/book', ['Book online: https://glow.in/book']), 'Book at https://glow.in/book')
  assert.deepEqual(R.parseAnswer('{"reply":"x","status":"answered","used":[1,"2",99,-1]}').used, [1, 2])
  const text = R.knowledgeText([{ title: 'Menu — Prices — page 2', content: 'Hair cut 300', kind: 'part', sourceTitle: 'Menu' }, hits[0]])
  assert.match(text, /From the business's "Menu"/)
  assert.match(text, /Sent with this answer: image "Prices", link "Book online"/)
})

test('the migration file is the SQL the app runs; parts are deleted with their source', () => {
  assert.equal(read('supabase/migrations/20261207_knowledge_sources.sql'), KS.SOURCES_SQL)
  assert.equal(KS.SOURCES_LOCK, 724519033)
  assert.match(KS.SOURCES_SQL, /source_id UUID REFERENCES knowledge_sources\(id\) ON DELETE CASCADE/)
  assert.match(KS.SOURCES_SQL, /FUNCTION set_knowledge_embeddings/)
  const route = read('app/api/knowledge/sources/route.ts')
  assert.match(route, /after\(async/)
  assert.match(route, /startsWith\(`knowledge\/\$\{organizationId\}\/sources\/`\)/, 'a file path must be the business\'s own upload')
  assert.match(read('app/api/knowledge/route.ts'), /\.eq\('kind', 'faq'\)/, 'the FAQ list does not show document parts')
  const hook = read('app/api/webhooks/facebook/[orgIdAndSlug]/route.ts')
  assert.match(hook, /for \(const file of sendError \? \[\] : answer\.attachments\)/)
})
