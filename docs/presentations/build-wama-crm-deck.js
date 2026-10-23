// WAMA CRM client deck: problem, cost, Magnetora, solution, features, gains, customers, next steps
const pptxgen = require('pptxgenjs')
const React = require('react')
const ReactDOMServer = require('react-dom/server')
const sharp = require('sharp')
const fa = require('react-icons/fa6')
const { applyTheme } = require('/root/.claude/skills/synced/40a41ad8-7d77-4f49-bda0-60b289fe1788_d9efe8c6-d673-4fda-8451-7974a56dbd98/pptx/scripts/apply_theme.js')

const BRAND = '/home/user/Marketing-CRM/docs/brand/'
const MAGNETORA_LOGO = '/home/user/Marketing-CRM/public/logo.png'
const OUT = process.argv[2] || 'WAMA-CRM-Client-Presentation.pptx'

const THEME = {
  name: 'WAMA CRM',
  headFontFace: 'Arial',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '0E1B3D', lt1: 'FFFFFF', dk2: '4A5874', lt2: 'F2F6FD',
    accent1: '1D5BEA', accent2: '00A884', accent3: '19C6F5', accent4: 'F59E0B', accent5: 'E5484D', accent6: '8A96B0',
    hlink: '1D5BEA', folHlink: '4A5874',
  },
}
const HEX = THEME.colors

async function icon(Component, color = '#FFFFFF') {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Component, { color, size: 256 }))
  const png = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer()
  return 'image/png;base64,' + png.toString('base64')
}

;(async () => {
  const pres = new pptxgen()
  pres.layout = 'LAYOUT_WIDE' // 13.33 x 7.5
  pres.author = 'Magnetora AI Solutions'
  pres.company = 'Magnetora AI Solutions'
  pres.title = 'WAMA CRM: WhatsApp AI CRM for Indian businesses'
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace }
  const C = pres.SchemeColor

  const I = {}
  const want = {
    whatsapp: fa.FaWhatsapp, clock: fa.FaClock, phone: fa.FaMobileScreenButton, forgot: fa.FaUserClock, repeat: fa.FaRepeat, ban: fa.FaBan,
    chart: fa.FaChartLine, robot: fa.FaRobot, inbox: fa.FaInbox, language: fa.FaLanguage, cart: fa.FaCartShopping, bullhorn: fa.FaBullhorn,
    ticket: fa.FaTicket, funnel: fa.FaFilter, flow: fa.FaDiagramProject, shield: fa.FaShieldHalved, rupee: fa.FaIndianRupeeSign, bolt: fa.FaBolt,
    heart: fa.FaHeartPulse, headset: fa.FaHeadset, check: fa.FaCheck, users: fa.FaUsers, handshake: fa.FaHandshake, store: fa.FaStore,
    truck: fa.FaTruckFast, card: fa.FaCreditCard, list: fa.FaListCheck, file: fa.FaFileExcel, calendar: fa.FaCalendarCheck, badge: fa.FaCircleCheck,
    globe: fa.FaGlobe, rocket: fa.FaRocket, plug: fa.FaPlug, user: fa.FaUser, brain: fa.FaBrain, lock: fa.FaLock,
  }
  for (const [key, Component] of Object.entries(want)) I[key] = await icon(Component)

  // ── Layouts ────────────────────────────────────────────────────────────────
  pres.defineSlideMaster({
    title: 'DARK',
    background: { color: C.text1 },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 2.2, w: 7.4, h: 2.0, fontSize: 44, bold: true, color: C.background1, valign: 'bottom', align: 'left', margin: 0 }, text: '' } },
      { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 4.4, w: 7.4, h: 1.3, fontSize: 18, color: 'C9D6F2', valign: 'top', align: 'left', margin: 0 }, text: '' } },
    ],
  })
  pres.defineSlideMaster({
    title: 'CONTENT',
    background: { color: C.background1 },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.4, w: 12.1, h: 0.85, fontSize: 32, bold: true, color: C.text1, valign: 'middle', align: 'left', margin: 0 }, text: '' } },
      { image: { path: BRAND + 'wamacrm-logo-horizontal.png', x: 0.6, y: 6.98, w: 1.4, h: 0.4 } },
      { text: { text: 'WAMA CRM · by Magnetora AI Solutions', options: { x: 2.1, y: 7.0, w: 5, h: 0.35, fontSize: 10, color: C.accent6, margin: 0, valign: 'middle' } } },
    ],
    slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.35, fontSize: 10, color: '8A96B0', align: 'right' },
  })

  const shadow = () => ({ type: 'outer', color: '0E1B3D', opacity: 0.12, blur: 10, offset: 3, angle: 90 })
  const card = (slide, x, y, w, h, fill = C.background1, name = 'card') =>
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: 'E1E7F2', width: 1 }, shadow: shadow(), objectName: name })
  const dot = (slide, img, x, y, d = 0.62, fill = C.accent1, name = 'icon') => {
    slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { type: 'none' }, objectName: name + ' circle' })
    slide.addImage({ data: img, x: x + d * 0.24, y: y + d * 0.24, w: d * 0.52, h: d * 0.52, objectName: name })
  }
  const text = (slide, value, opts) => slide.addText(value, { isTextBox: true, margin: 0, valign: 'top', fontSize: 15, color: C.text2, ...opts })

  // ── 1. Title ───────────────────────────────────────────────────────────────
  pres.addSection({ title: 'Introduction' })
  let s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Introduction' })
  s.addImage({ path: BRAND + 'wamacrm-logo-horizontal-light.png', x: 0.7, y: 0.6, w: 3.5, h: 1.0, objectName: 'WAMA CRM logo' })
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 1.72, w: 3.55, h: 0.42, rectRadius: 0.21, fill: { color: '1D3A8A' }, line: { color: '3B6BE8', width: 1 }, objectName: 'Meta badge' })
  s.addImage({ data: I.badge, x: 0.84, y: 1.82, w: 0.22, h: 0.22 })
  text(s, 'Official Meta Tech Provider', { x: 1.14, y: 1.72, w: 3.0, h: 0.42, fontSize: 13, bold: true, color: C.background1, valign: 'middle' })
  s.addText('Turn every WhatsApp chat into a sale', { placeholder: 'title' })
  s.addText('WAMA CRM is the WhatsApp AI CRM for Indian businesses: reply in seconds, sell in the chat, send campaigns and support customers, all from one place.', { placeholder: 'body' })
  card(s, 8.75, 1.15, 3.9, 3.9, C.background1, 'icon card')
  s.addImage({ path: BRAND + 'wamacrm-icon.png', x: 9.05, y: 1.45, w: 3.3, h: 3.3, objectName: 'WAMA CRM icon' })
  text(s, 'Presented by Magnetora AI Solutions', { x: 0.7, y: 6.3, w: 6, h: 0.35, fontSize: 14, color: '9FB0D6' })
  text(s, 'wamacrm.magnetora.in', { x: 8.75, y: 6.3, w: 3.9, h: 0.35, fontSize: 14, bold: true, color: '5FB4FF', align: 'right' })
  s.addNotes('Namaste. Today we will show how WAMA CRM helps your business reply faster, sell more and support customers on WhatsApp. WAMA CRM is built by Magnetora AI Solutions, an official Meta Tech Provider.')

  // ── 2. Problem ─────────────────────────────────────────────────────────────
  pres.addSection({ title: 'The problem' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'The problem' })
  s.addText('Your customers are on WhatsApp. Are you ready?', { placeholder: 'title' })
  const problems = [
    [I.clock, 'Late replies', 'Customers message at night and on Sundays. If nobody replies fast, they buy from someone else.'],
    [I.phone, 'Chats stuck in phones', 'Leads sit in different staff phones. When a staff member leaves, their customers go too.'],
    [I.forgot, 'No follow-up', 'Interested customers are forgotten. Nobody knows whom to call back, or when.'],
    [I.repeat, 'Same questions daily', 'Price? Timing? Address? The team answers the same things 100 times a day.'],
    [I.ban, 'Risky bulk messages', 'Copy-paste broadcasts and unofficial tools can get your WhatsApp number blocked.'],
    [I.chart, 'No numbers to check', 'You cannot see how many leads came, who replied, or which offer worked.'],
  ]
  problems.forEach(([img, head, body], i) => {
    const x = 0.6 + (i % 3) * 4.1, y = 1.55 + Math.floor(i / 3) * 2.6
    card(s, x, y, 3.85, 2.35, C.background1, `problem ${i + 1}`)
    dot(s, img, x + 0.3, y + 0.3, 0.62, C.accent5, `problem ${i + 1} icon`)
    text(s, head, { x: x + 1.08, y: y + 0.36, w: 2.6, h: 0.5, fontSize: 19, bold: true, color: C.text1, valign: 'middle' })
    text(s, body, { x: x + 0.3, y: y + 1.08, w: 3.3, h: 1.15, fontSize: 15 })
  })
  s.addNotes('These are the problems we hear from almost every business owner. Ask the client which of these six they face today.')

  // ── 3. Cost ────────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'The problem' })
  s.addText('How much is this costing you every month?', { placeholder: 'title' })
  card(s, 0.6, 1.5, 5.4, 5.2, C.background2, 'example box')
  text(s, 'Example: 300 WhatsApp enquiries a month, average sale ₹2,000', { x: 0.9, y: 1.75, w: 4.8, h: 0.7, fontSize: 15, bold: true, color: C.text1 })
  const losses = [
    ['Late or missed replies', '90 enquiries (30%) get no quick reply. 1 in 5 would have bought.', '₹36,000'],
    ['No follow-up', '60 interested leads are never called back. 1 in 10 would have bought.', '₹12,000'],
    ['Staff time on repeat questions', '2 hours a day × ₹150 per hour × 26 working days.', '₹7,800'],
  ]
  losses.forEach(([head, body, amount], i) => {
    const y = 2.6 + i * 1.25
    text(s, head, { x: 0.9, y, w: 3.3, h: 0.4, fontSize: 16, bold: true, color: C.text1 })
    text(s, amount, { x: 4.2, y, w: 1.5, h: 0.4, fontSize: 17, bold: true, color: C.accent5, align: 'right' })
    text(s, body, { x: 0.9, y: y + 0.42, w: 4.8, h: 0.75, fontSize: 14 })
  })
  text(s, 'Example only. In the demo we will work out your own numbers.', { x: 0.9, y: 6.25, w: 4.8, h: 0.35, fontSize: 11, italic: true, color: C.accent6 })
  text(s, '₹55,800', { x: 6.5, y: 1.55, w: 6.2, h: 0.95, fontSize: 60, bold: true, color: C.accent5 })
  text(s, 'lost every month, about ₹6.7 lakh a year', { x: 6.5, y: 2.5, w: 6.2, h: 0.45, fontSize: 18, bold: true, color: C.text1 })
  s.addChart(pres.charts.BAR, [{ name: 'Monthly loss (₹)', labels: ['Missed replies', 'No follow-up', 'Staff time'], values: [36000, 12000, 7800] }], {
    x: 6.4, y: 3.15, w: 6.3, h: 3.55, barDir: 'bar', chartColors: [HEX.accent5],
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '₹#,##0', dataLabelColor: HEX.dk1, dataLabelFontSize: 13, dataLabelFontFace: '+mn-lt',
    catAxisLabelColor: HEX.dk2, catAxisLabelFontSize: 14, catAxisLabelFontFace: '+mn-lt', valAxisHidden: true,
    valGridLine: { style: 'none' }, catGridLine: { style: 'none' }, showLegend: false, barGapWidthPct: 60, catAxisOrientation: 'maxMin',
    showTitle: false, objectName: 'monthly loss chart',
  })
  s.addNotes('Walk through the example slowly. These are conservative numbers. Then ask: how many enquiries do you get in a month, and what is your average sale? Replace the example with their numbers.')

  // ── 4. About Magnetora ─────────────────────────────────────────────────────
  pres.addSection({ title: 'Who we are' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Who we are' })
  s.addText('About Magnetora AI Solutions', { placeholder: 'title' })
  card(s, 0.6, 1.5, 4.6, 5.2, C.background1, 'Magnetora logo card')
  s.addImage({ path: MAGNETORA_LOGO, x: 0.9, y: 1.75, w: 4.0, h: 4.0, objectName: 'Magnetora AI Solutions logo' })
  text(s, 'People · Business · A smarter tomorrow', { x: 0.9, y: 5.95, w: 4.0, h: 0.4, fontSize: 14, italic: true, color: C.accent1, align: 'center' })
  text(s, 'We build simple, practical AI tools that help Indian businesses talk to customers, sell more and save time.', { x: 5.7, y: 1.55, w: 7.0, h: 0.95, fontSize: 19, bold: true, color: C.text1 })
  const about = [
    [I.whatsapp, C.accent2, 'WhatsApp automation and CRM', 'WAMA CRM: our WhatsApp AI CRM for sales, marketing and support.'],
    [I.robot, C.accent1, 'AI chatbots and assistants', 'Assistants that answer customers in their own language, 24 hours a day.'],
    [I.brain, C.accent3, 'Custom AI solutions', 'AI built around your process: lead scoring, document reading, reports and more.'],
    [I.badge, C.accent1, 'Official Meta Tech Provider', 'We connect businesses to the official WhatsApp Business Platform.'],
  ]
  about.forEach(([img, fill, head, body], i) => {
    const y = 2.75 + i * 1.0
    dot(s, img, 5.7, y, 0.62, fill, `about ${i + 1}`)
    text(s, head, { x: 6.55, y: y - 0.02, w: 6.1, h: 0.4, fontSize: 17, bold: true, color: C.text1 })
    text(s, body, { x: 6.55, y: y + 0.38, w: 6.1, h: 0.5, fontSize: 14 })
  })
  s.addNotes('Introduce Magnetora AI Solutions: we are an AI company and an official Meta Tech Provider. WAMA CRM is our main product for WhatsApp.')

  // ── 5. Meet WAMA CRM ───────────────────────────────────────────────────────
  pres.addSection({ title: 'The solution' })
  s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'The solution' })
  s.addImage({ path: BRAND + 'wamacrm-logo-horizontal-light.png', x: 0.7, y: 0.6, w: 3.5, h: 1.0, objectName: 'WAMA CRM logo' })
  s.addText('Meet WAMA CRM', { placeholder: 'title' })
  s.addText('One place to reply, sell, market and support, all on WhatsApp, with AI doing the heavy work.', { placeholder: 'body' })
  const pillars = [
    [I.robot, C.accent1, 'Reply 24/7', 'AI answers in seconds'],
    [I.cart, C.accent2, 'Sell in the chat', 'Catalog, cart and payment'],
    [I.bullhorn, C.accent4, 'Market at scale', 'Campaigns people read'],
    [I.headset, C.accent3, 'Support and track', 'Tickets, pipeline, reports'],
  ]
  pillars.forEach(([img, fill, head, body], i) => {
    const x = 8.55 + (i % 2) * 2.2, y = 1.6 + Math.floor(i / 2) * 2.3
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 2.0, h: 2.05, rectRadius: 0.12, fill: { color: '1B2A55' }, line: { color: '2E4380', width: 1 }, objectName: `pillar ${i + 1}` })
    dot(s, img, x + 0.69, y + 0.25, 0.62, fill, `pillar ${i + 1} icon`)
    text(s, head, { x: x + 0.1, y: y + 1.0, w: 1.8, h: 0.4, fontSize: 15, bold: true, color: C.background1, align: 'center' })
    text(s, body, { x: x + 0.1, y: y + 1.4, w: 1.8, h: 0.5, fontSize: 12, color: '9FB0D6', align: 'center' })
  })
  s.addNotes('WAMA CRM brings four jobs into one tool: replying, selling, marketing and support. Everything works on the official WhatsApp Business Platform.')

  // ── 6. How it works ────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'The solution' })
  s.addText('How it works for your customer', { placeholder: 'title' })
  const steps = [
    [I.whatsapp, C.accent2, 'Customer messages', 'From your ad, website, QR code or a campaign.'],
    [I.robot, C.accent1, 'AI replies instantly', 'In English, Telugu, Hindi, Tenglish or Hinglish.'],
    [I.user, C.accent3, 'Lead saved in CRM', 'Name, number, interest and chat history, automatically.'],
    [I.cart, C.accent4, 'Order and payment', 'Your team takes over, or the customer buys in the chat.'],
    [I.calendar, C.accent1, 'Follow-up and repeat', 'Reminders and offers bring the customer back.'],
  ]
  steps.forEach(([img, fill, head, body], i) => {
    const x = 0.6 + i * 2.5
    card(s, x, 2.0, 2.2, 3.6, C.background1, `step ${i + 1}`)
    text(s, String(i + 1), { x: x + 0.2, y: 2.15, w: 0.5, h: 0.4, fontSize: 14, bold: true, color: C.accent6 })
    dot(s, img, x + 0.75, 2.45, 0.7, fill, `step ${i + 1} icon`)
    text(s, head, { x: x + 0.15, y: 3.4, w: 1.9, h: 0.75, fontSize: 17, bold: true, color: C.text1, align: 'center', valign: 'middle' })
    text(s, body, { x: x + 0.15, y: 4.2, w: 1.9, h: 1.2, fontSize: 14, align: 'center' })
    if (i < steps.length - 1) s.addShape(pres.shapes.RIGHT_ARROW, { x: x + 2.24, y: 3.65, w: 0.24, h: 0.3, fill: { color: C.accent6 }, line: { type: 'none' }, objectName: `arrow ${i + 1}` })
  })
  text(s, 'The same customer profile is used for every chat, order, ticket and campaign, so nothing is lost.', { x: 0.6, y: 6.0, w: 12.1, h: 0.45, fontSize: 15, italic: true, color: C.accent1 })
  s.addNotes('Explain the journey with one real example from the client’s business.')

  // ── 7. Conversations and AI ────────────────────────────────────────────────
  pres.addSection({ title: 'Features' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Features' })
  s.addText('Reply to every customer in seconds, even at 2 AM', { placeholder: 'title' })
  const chatFeatures = [
    [I.robot, C.accent1, 'AI chatbot trained on your business', 'Learns from your FAQs, website and product list.'],
    [I.language, C.accent2, 'Speaks your customer’s language', 'English, తెలుగు, हिंदी, Tenglish and Hinglish.'],
    [I.inbox, C.accent3, 'Shared team inbox', 'All chats on one number, many agents, nothing missed.'],
    [I.handshake, C.accent4, 'Smooth hand-over to your team', 'AI passes hot leads and tough questions to a person.'],
  ]
  chatFeatures.forEach(([img, fill, head, body], i) => {
    const y = 1.6 + i * 1.25
    dot(s, img, 0.6, y, 0.7, fill, `chat feature ${i + 1}`)
    text(s, head, { x: 1.55, y: y + 0.0, w: 5.6, h: 0.4, fontSize: 18, bold: true, color: C.text1 })
    text(s, body, { x: 1.55, y: y + 0.42, w: 5.6, h: 0.45, fontSize: 15 })
  })
  // Phone-style chat sample
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.9, y: 1.45, w: 4.8, h: 5.25, rectRadius: 0.2, fill: { color: 'EFEAE2' }, line: { color: 'D9D2C6', width: 1 }, objectName: 'chat sample' })
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.9, y: 1.45, w: 4.8, h: 0.7, rectRadius: 0.2, fill: { color: '008069' }, line: { type: 'none' }, objectName: 'chat header' })
  text(s, 'BooksStore · AI assistant', { x: 8.2, y: 1.45, w: 4.2, h: 0.7, fontSize: 15, bold: true, color: C.background1, valign: 'middle' })
  const bubble = (y, value, mine, h = 0.75) => {
    const x = mine ? 9.6 : 8.15
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 2.85, h, rectRadius: 0.08, fill: { color: mine ? 'D9FDD3' : 'FFFFFF' }, line: { type: 'none' }, shadow: shadow(), objectName: mine ? 'customer message' : 'AI reply' })
    text(s, value, { x: x + 0.15, y: y + 0.08, w: 2.6, h: h - 0.12, fontSize: 13, color: C.text1, valign: 'middle' })
  }
  bubble(2.4, 'Me degara Radhakrishnan books unnaya?', true)
  bubble(3.3, 'Unnayi andi! “The Hindu View of Life” ₹299. Order cheyyala?', false, 0.95)
  bubble(4.45, 'Haan, 2 copies chahiye', true, 0.6)
  bubble(5.25, 'Done! 2 copies added. Pay by UPI or Cash on Delivery?', false, 0.95)
  s.addNotes('Show that the AI understands mixed-language messages exactly how Indian customers type.')

  // ── 8. Commerce ────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Features' })
  s.addText('Sell inside WhatsApp, from product to payment', { placeholder: 'title' })
  const shop = [
    [I.store, C.accent1, 'Catalog', 'Products and prices from your Meta catalog'],
    [I.cart, C.accent2, 'Cart order', 'Customer picks items and sends the order'],
    [I.list, C.accent3, 'Address form', 'Delivery details in a simple WhatsApp form'],
    [I.card, C.accent4, 'Payment', 'WhatsApp Pay with Razorpay, PayU and more, or COD'],
    [I.truck, C.accent1, 'Updates', 'Receipt, thank-you and shipping updates'],
  ]
  shop.forEach(([img, fill, head, body], i) => {
    const x = 0.6 + i * 2.5
    card(s, x, 1.65, 2.2, 2.75, C.background1, `commerce step ${i + 1}`)
    dot(s, img, x + 0.75, 1.9, 0.7, fill, `commerce step ${i + 1} icon`)
    text(s, head, { x: x + 0.15, y: 2.78, w: 1.9, h: 0.4, fontSize: 17, bold: true, color: C.text1, align: 'center' })
    text(s, body, { x: x + 0.15, y: 3.2, w: 1.9, h: 1.0, fontSize: 13, align: 'center' })
  })
  card(s, 0.6, 4.75, 12.1, 1.85, C.background2, 'commerce extras')
  const extras = [
    [I.robot, 'AI shopping assistant', 'Finds products and answers “where is my order?”'],
    [I.chart, 'Orders in your CRM', 'See, update and ship every order in one screen'],
    [I.check, 'Go-live checklist', 'Shows exactly what is left to connect'],
  ]
  extras.forEach(([img, head, body], i) => {
    const x = 0.95 + i * 4.0
    dot(s, img, x, 5.2, 0.62, C.accent1, `commerce extra ${i + 1}`)
    text(s, head, { x: x + 0.8, y: 5.12, w: 3.0, h: 0.4, fontSize: 16, bold: true, color: C.text1 })
    text(s, body, { x: x + 0.8, y: 5.52, w: 3.0, h: 0.8, fontSize: 13 })
  })
  s.addNotes('For shops and D2C brands: customers can browse, order and pay without leaving WhatsApp. No website or app needed.')

  // ── 9. Campaigns ───────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Features' })
  s.addText('Send campaigns that people actually read', { placeholder: 'title' })
  const campaign = [
    [I.file, C.accent2, 'Upload your Excel list', 'Add names, offers and any detail as {{variables}}.'],
    [I.bullhorn, C.accent4, 'Every Meta template type', 'Images, videos, carousels, offers, coupon codes, catalog and forms.'],
    [I.badge, C.accent1, 'Approved by Meta, safe for your number', 'Create templates and see approval live, like WhatsApp Manager.'],
    [I.calendar, C.accent3, 'Schedule and reply', 'Send now or later, and reply to responses from the same screen.'],
  ]
  campaign.forEach(([img, fill, head, body], i) => {
    const y = 1.6 + i * 1.25
    dot(s, img, 0.6, y, 0.7, fill, `campaign feature ${i + 1}`)
    text(s, head, { x: 1.55, y, w: 5.4, h: 0.4, fontSize: 18, bold: true, color: C.text1 })
    text(s, body, { x: 1.55, y: y + 0.42, w: 5.4, h: 0.6, fontSize: 15 })
  })
  card(s, 7.5, 1.5, 5.2, 5.2, C.background1, 'campaign report')
  text(s, 'Track every message', { x: 7.85, y: 1.75, w: 4.5, h: 0.45, fontSize: 18, bold: true, color: C.text1 })
  text(s, 'Each campaign shows these stages for every contact', { x: 7.85, y: 2.2, w: 4.5, h: 0.4, fontSize: 13, color: C.text2 })
  const stages = [['Sent', C.accent6, 4.3], ['Delivered', C.accent3, 3.9], ['Read', C.accent1, 3.2], ['Replied', C.accent2, 2.0], ['Converted', C.accent4, 1.2]]
  stages.forEach(([label, fill, w], i) => {
    const y = 2.85 + i * 0.72
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.85, y, w, h: 0.5, rectRadius: 0.08, fill: { color: fill }, line: { type: 'none' }, objectName: `${label} stage` })
    text(s, label, { x: 8.0, y, w: 2.5, h: 0.5, fontSize: 14, bold: true, color: C.background1, valign: 'middle' })
  })
  text(s, 'Illustration of the report, not real data', { x: 7.85, y: 6.3, w: 4.5, h: 0.3, fontSize: 10, italic: true, color: C.accent6 })
  s.addNotes('Campaigns use Meta-approved templates, so the number stays safe. Every message is tracked from sent to replied.')

  // ── 10. Support and sales ──────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Features' })
  s.addText('Support customers and close more deals', { placeholder: 'title' })
  const grid = [
    [I.ticket, C.accent5, 'Tickets with SLA', 'Every complaint gets a ticket, an owner and a time limit. Nothing is forgotten.'],
    [I.funnel, C.accent1, 'Sales pipeline', 'Hot, warm and cold leads in clear stages, with AI lead scores and reminders.'],
    [I.flow, C.accent2, 'Flow builder and WhatsApp forms', 'Build menus, questions and forms with drag and drop. No coding needed.'],
    [I.chart, C.accent4, 'Reports and insights', 'Leads, replies, sales and team performance on one dashboard.'],
  ]
  grid.forEach(([img, fill, head, body], i) => {
    const x = 0.6 + (i % 2) * 6.15, y = 1.55 + Math.floor(i / 2) * 2.6
    card(s, x, y, 5.95, 2.35, C.background1, `support feature ${i + 1}`)
    dot(s, img, x + 0.35, y + 0.4, 0.75, fill, `support feature ${i + 1} icon`)
    text(s, head, { x: x + 1.35, y: y + 0.42, w: 4.4, h: 0.5, fontSize: 19, bold: true, color: C.text1 })
    text(s, body, { x: x + 1.35, y: y + 0.95, w: 4.4, h: 1.2, fontSize: 15 })
  })
  s.addNotes('These features help teams that handle support, admissions, bookings or sales follow-ups.')

  // ── 11. Gains ──────────────────────────────────────────────────────────────
  pres.addSection({ title: 'Your gain' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Your gain' })
  s.addText('What changes for your business', { placeholder: 'title' })
  const rows = [
    ['Reply time', 'Hours, or next day', 'Seconds, 24 hours a day'],
    ['Leads', 'Lost in staff phones', 'Every lead saved in the CRM'],
    ['Team', 'One phone, one person', 'Whole team on one number'],
    ['Selling', 'Send to website or call back', 'Order and pay inside the chat'],
    ['Marketing', 'Copy-paste, risk of block', 'Official, tracked campaigns'],
    ['Decisions', 'Guesswork', 'Live reports'],
  ]
  const tableRows = [[
    { text: '', options: { fill: { color: C.background1 } } },
    { text: 'Before', options: { bold: true, color: C.background1, fill: { color: C.accent5 }, align: 'center' } },
    { text: 'With WAMA CRM', options: { bold: true, color: C.background1, fill: { color: C.accent2 }, align: 'center' } },
  ], ...rows.map(([label, before, after]) => [
    { text: label, options: { bold: true, color: C.text1 } },
    { text: before, options: { color: C.text2 } },
    { text: after, options: { color: C.text1, bold: true } },
  ])]
  s.addTable(tableRows, { x: 0.6, y: 1.5, w: 7.6, colW: [1.7, 2.8, 3.1], rowH: 0.62, fontSize: 15, fontFace: 'Calibri', valign: 'middle', border: { type: 'solid', color: 'E1E7F2', pt: 1 }, margin: 0.08, objectName: 'before and after table' })
  card(s, 8.6, 1.5, 4.1, 4.35, C.text1, 'gain callout')
  text(s, 'In our example', { x: 8.95, y: 1.8, w: 3.4, h: 0.4, fontSize: 15, color: '9FB0D6' })
  text(s, '₹3.3 lakh', { x: 8.95, y: 2.25, w: 3.4, h: 0.9, fontSize: 48, bold: true, color: '3BE07A' })
  text(s, 'extra a year by saving just half of the lost sales and staff time', { x: 8.95, y: 3.2, w: 3.4, h: 1.0, fontSize: 16, color: C.background1 })
  text(s, 'Half of ₹6.7 lakh. Most businesses save more.', { x: 8.95, y: 4.55, w: 3.4, h: 0.9, fontSize: 13, italic: true, color: '9FB0D6' })
  s.addNotes('Connect this back to the cost slide. Even if WAMA CRM recovers only half of the loss, the gain is about 3.3 lakh rupees a year in this example.')

  // ── 12. Customers ──────────────────────────────────────────────────────────
  pres.addSection({ title: 'Trusted by' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Trusted by' })
  s.addText('Trusted by organisations that serve people', { placeholder: 'title' })
  const customers = [
    ['DEEP INDIA', 'deepindia.org', I.heart, C.accent5, 'Health screening campaigns and support',
      'Uses WAMA CRM to run WhatsApp campaigns for health screening, and to answer and support people who reach out.',
      ['Bulk campaigns', 'Meta templates', 'Team inbox', 'Contacts']],
    ['CONSULAR HELPDESK', 'consularhelpdesk.com', I.headset, C.accent1, 'AI chat support with ticketing',
      'Uses WAMA CRM for AI-powered chat support on WhatsApp, with tickets so every request is tracked till it is solved.',
      ['AI chatbot', 'Tickets and SLA', 'Team inbox', 'Hand-over to agents']],
  ]
  customers.forEach(([name, site, img, fill, use, body, chips], i) => {
    const x = 0.6 + i * 6.15
    card(s, x, 1.5, 5.95, 5.2, C.background1, `${name} card`)
    // Logo area: replace with the organisation's official logo file
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.35, y: 1.8, w: 5.25, h: 1.25, rectRadius: 0.1, fill: { color: C.background2 }, line: { color: 'E1E7F2', width: 1 }, objectName: `${name} logo area` })
    text(s, name, { x: x + 0.55, y: 1.85, w: 4.85, h: 0.75, fontSize: 26, bold: true, color: C.text1, align: 'center', valign: 'middle', objectName: `${name} logo` })
    text(s, site, { x: x + 0.55, y: 2.55, w: 4.85, h: 0.4, fontSize: 14, color: C.accent1, align: 'center' })
    dot(s, img, x + 0.35, 3.35, 0.62, fill, `${name} use icon`)
    text(s, use, { x: x + 1.15, y: 3.35, w: 4.5, h: 0.62, fontSize: 18, bold: true, color: C.text1, valign: 'middle' })
    text(s, body, { x: x + 0.35, y: 4.15, w: 5.25, h: 1.2, fontSize: 15 })
    chips.forEach((chip, j) => {
      const cx = x + 0.35 + (j % 2) * 2.65, cy = 5.45 + Math.floor(j / 2) * 0.5
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx, y: cy, w: 2.5, h: 0.4, rectRadius: 0.2, fill: { color: 'E8F7EF' }, line: { type: 'none' }, objectName: `${name} feature ${j + 1}` })
      text(s, chip, { x: cx, y: cy, w: 2.5, h: 0.4, fontSize: 12, bold: true, color: C.accent2, align: 'center', valign: 'middle' })
    })
  })
  s.addNotes('Replace the name boxes with the official Deep India and Consular Helpdesk logos before presenting. Share how each organisation uses WAMA CRM in their own work.')

  // ── 13. Why us ─────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Trusted by' })
  s.addText('Why businesses choose WAMA CRM', { placeholder: 'title' })
  const why = [
    [I.badge, C.accent1, 'Official Meta Tech Provider', 'Built on the official WhatsApp Business Platform.'],
    [I.rupee, C.accent2, '0% markup on Meta charges', 'You pay Meta’s message rates directly. No hidden extras.'],
    [I.globe, C.accent3, 'Made for India', 'Indian languages, ₹ pricing, UPI and Cash on Delivery.'],
    [I.bolt, C.accent4, 'Quick setup', 'Connect your WhatsApp number in minutes, no coding.'],
    [I.lock, C.accent1, 'Your data is safe', 'Separate workspace for each business, with role-based access.'],
    [I.users, C.accent2, 'Local support', 'The Magnetora team helps you set up and grow.'],
  ]
  why.forEach(([img, fill, head, body], i) => {
    const x = 0.6 + (i % 3) * 4.1, y = 1.55 + Math.floor(i / 3) * 2.6
    card(s, x, y, 3.85, 2.35, C.background1, `reason ${i + 1}`)
    dot(s, img, x + 0.3, y + 0.3, 0.62, fill, `reason ${i + 1} icon`)
    text(s, head, { x: x + 1.08, y: y + 0.3, w: 2.65, h: 0.62, fontSize: 16, bold: true, color: C.text1, valign: 'middle' })
    text(s, body, { x: x + 0.3, y: y + 1.12, w: 3.3, h: 1.05, fontSize: 15 })
  })
  s.addNotes('Stress the 0% markup and the official Meta connection. These are the two biggest worries clients have.')

  // ── 14. Get started ────────────────────────────────────────────────────────
  pres.addSection({ title: 'Next steps' })
  s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Next steps' })
  s.addImage({ path: BRAND + 'wamacrm-logo-horizontal-light.png', x: 0.7, y: 0.6, w: 3.5, h: 1.0, objectName: 'WAMA CRM logo' })
  s.addText('Start in 3 simple steps', { placeholder: 'title' })
  s.addText('Free 14-day trial. Visit wamacrm.magnetora.in or talk to the Magnetora team today.', { placeholder: 'body' })
  const next = [
    [I.calendar, C.accent2, 'Free demo', 'We show WAMA CRM with your own business example.'],
    [I.plug, C.accent1, 'Connect WhatsApp', 'Link your number through Meta’s official signup in minutes.'],
    [I.rocket, C.accent4, 'Go live', 'Turn on the AI, import contacts and start your first campaign.'],
  ]
  next.forEach(([img, fill, head, body], i) => {
    const y = 1.2 + i * 1.75
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.4, y, w: 4.3, h: 1.5, rectRadius: 0.12, fill: { color: '1B2A55' }, line: { color: '2E4380', width: 1 }, objectName: `next step ${i + 1}` })
    dot(s, img, 8.65, y + 0.42, 0.66, fill, `next step ${i + 1} icon`)
    text(s, `${i + 1}. ${head}`, { x: 9.5, y: y + 0.22, w: 3.05, h: 0.4, fontSize: 17, bold: true, color: C.background1 })
    text(s, body, { x: 9.5, y: y + 0.65, w: 3.05, h: 0.7, fontSize: 13, color: '9FB0D6' })
  })
  text(s, 'Thank you · Dhanyavaadalu · Dhanyavaad', { x: 0.7, y: 6.3, w: 7.4, h: 0.4, fontSize: 16, bold: true, color: '3BE07A' })
  s.addNotes('Close by booking the demo date. Offer to set up the WhatsApp connection together on a call.')

  await pres.writeFile({ fileName: OUT })
  await applyTheme(OUT, THEME)
  console.log('wrote', OUT)
})().catch(error => { console.error(error); process.exit(1) })
