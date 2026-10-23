// WAMA CRM client deck: calm palette (navy, blue, WhatsApp green), few words, phone mock-ups,
// launches and offers to the customer base, e-commerce, and real customer logos
const pptxgen = require('pptxgenjs')
const React = require('react')
const ReactDOMServer = require('react-dom/server')
const sharp = require('sharp')
const fa = require('react-icons/fa6')
const { applyTheme } = require('/root/.claude/skills/synced/40a41ad8-7d77-4f49-bda0-60b289fe1788_d9efe8c6-d673-4fda-8451-7974a56dbd98/pptx/scripts/apply_theme.js')

const BRAND = '/home/user/Marketing-CRM/docs/brand/'
const IMG = __dirname + '/assets/'
const MAGNETORA_LOGO = '/home/user/Marketing-CRM/public/logo.png'
const OUT = process.argv[2] || 'WAMA-CRM-Client-Presentation.pptx'

const THEME = {
  name: 'WAMA CRM',
  headFontFace: 'Arial',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '0E1B3D', lt1: 'FFFFFF', dk2: '4A5874', lt2: 'F4F6FA',
    accent1: '1D5BEA', accent2: '00A884', accent3: '0E1B3D', accent4: 'F59E0B', accent5: '6B7894', accent6: 'E5484D',
    hlink: '1D5BEA', folHlink: '4A5874',
  },
}
// Soft tints for tiles
const BLUE_TINT = 'EEF3FE', GREEN_TINT = 'E8F7F1', RED_TINT = 'FDF0F0', LINE = 'E3E8F2'

async function icon(Component, color = '#FFFFFF') {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Component, { color, size: 256 }))
  return 'image/png;base64,' + (await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer()).toString('base64')
}
const ratio = async path => { const m = await sharp(path).metadata(); return m.width / m.height }

;(async () => {
  const pres = new pptxgen()
  pres.layout = 'LAYOUT_WIDE' // 13.33 x 7.5
  pres.author = 'Magnetora AI Solutions'
  pres.company = 'Magnetora AI Solutions'
  pres.title = 'WAMA CRM: turn WhatsApp chats into sales'
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace }
  const C = pres.SchemeColor

  const I = {}
  const want = {
    whatsapp: fa.FaWhatsapp, clock: fa.FaClock, phone: fa.FaMobileScreenButton, forgot: fa.FaUserClock, repeat: fa.FaRepeat,
    robot: fa.FaRobot, cart: fa.FaCartShopping, bullhorn: fa.FaBullhorn, headset: fa.FaHeadset, store: fa.FaStore, pin: fa.FaLocationDot,
    card: fa.FaCreditCard, truck: fa.FaTruckFast, sync: fa.FaArrowsRotate, chart: fa.FaChartLine, gift: fa.FaGift, ticket: fa.FaTicket,
    hand: fa.FaHandshake, stopwatch: fa.FaStopwatch, file: fa.FaFileExcel, badge: fa.FaCircleCheck, rupee: fa.FaIndianRupeeSign,
    language: fa.FaLanguage, bolt: fa.FaBolt, xmark: fa.FaXmark, check: fa.FaCheck, calendar: fa.FaCalendarCheck, plug: fa.FaPlug, rocket: fa.FaRocket,
    brain: fa.FaBrain, star: fa.FaStar, users: fa.FaUsers, tags: fa.FaTags, eye: fa.FaEye, sparkle: fa.FaWandMagicSparkles, tag: fa.FaTag,
    filter: fa.FaFilter, paper: fa.FaPaperPlane, bell: fa.FaBell, box: fa.FaBoxOpen,
  }
  for (const [key, Component] of Object.entries(want)) I[key] = await icon(Component)
  const phoneRatio = await ratio(IMG + 'phone-ai.png')
  const dashRatio = await ratio(IMG + 'dashboard.png')
  const deepRatio = await ratio(BRAND + 'customers/deep-trust-logo.png')

  // ── Layouts ────────────────────────────────────────────────────────────────
  pres.defineSlideMaster({
    title: 'DARK',
    background: { path: IMG + 'bg-section.png' },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 1.9, w: 6.6, h: 2.1, fontSize: 46, bold: true, color: C.background1, valign: 'bottom', align: 'left', margin: 0 }, text: '' } },
      { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 4.15, w: 6.6, h: 0.9, fontSize: 20, color: 'DCE6FF', valign: 'top', align: 'left', margin: 0 }, text: '' } },
    ],
  })
  pres.defineSlideMaster({
    title: 'CONTENT',
    background: { color: C.background1 },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 36, bold: true, color: C.text1, valign: 'middle', align: 'left', margin: 0 }, text: '' } },
      { image: { path: BRAND + 'wamacrm-logo-horizontal.png', x: 0.6, y: 6.98, w: 1.5, h: 0.4 } },
    ],
    slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.35, fontSize: 10, color: '8A96B0', align: 'right' },
  })

  const shadow = () => ({ type: 'outer', color: '0E1B3D', opacity: 0.08, blur: 10, offset: 3, angle: 90 })
  const tile = (slide, x, y, w, h, fill, name, opts = {}) =>
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.16, fill: { color: fill }, line: opts.line || { type: 'none' }, ...(opts.shadow ? { shadow: shadow() } : {}), objectName: name })
  const circleIcon = (slide, img, x, y, d, fill, name) => {
    slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { type: 'none' }, objectName: name + ' circle' })
    slide.addImage({ data: img, x: x + d * 0.25, y: y + d * 0.25, w: d * 0.5, h: d * 0.5, objectName: name })
  }
  const say = (slide, value, opts) => slide.addText(value, { isTextBox: true, margin: 0, valign: 'top', fontSize: 16, color: C.text2, ...opts })
  const phone = (slide, file, x, y, h, name) => slide.addImage({ path: IMG + file, x, y, w: h * phoneRatio, h, objectName: name })
  const halo = (slide, x, y, d, fill) => slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { type: 'none' }, objectName: 'phone halo' })
  const chip = (slide, value, x, y, w, fill, color, h = 0.48, fontSize = 15) => {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: h / 2, fill: { color: fill }, line: { type: 'none' }, objectName: `${value.trim()} chip` })
    say(slide, value, { x, y, w, h, fontSize, bold: true, color, align: 'center', valign: 'middle' })
  }
  const badge = (slide, x, y, w, fill, color) => {
    chip(slide, '     Official Meta Tech Provider', x, y, w, fill, color)
    slide.addImage({ data: I.badge, x: x + 0.22, y: y + 0.11, w: 0.26, h: 0.26, objectName: 'badge icon' })
  }
  // A point: icon circle, bold line, short line under it
  const point = (slide, img, fill, head, body, x, y, w = 5.4) => {
    circleIcon(slide, img, x, y, 0.8, fill, head)
    say(slide, head, { x: x + 1.0, y: y - 0.02, w, h: 0.44, fontSize: 21, bold: true, color: C.text1 })
    say(slide, body, { x: x + 1.0, y: y + 0.42, w, h: 0.4, fontSize: 16 })
  }

  // ── 1. Cover ───────────────────────────────────────────────────────────────
  pres.addSection({ title: 'Introduction' })
  let s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Introduction' })
  s.background = { path: IMG + 'bg-cover.png' }
  s.addImage({ path: BRAND + 'wamacrm-logo-horizontal-light.png', x: 0.7, y: 0.55, w: 4.125, h: 1.1, objectName: 'WAMA CRM logo' })
  s.addText('Turn WhatsApp chats into sales', { placeholder: 'title' })
  s.addText('AI replies · Launches and offers · Shop in chat · Support', { placeholder: 'body' })
  badge(s, 0.7, 5.35, 3.8, C.accent2, C.background1)
  say(s, 'by Magnetora AI Solutions', { x: 0.7, y: 6.55, w: 5, h: 0.4, fontSize: 15, color: 'B9C7EC' })
  phone(s, 'phone-ai.png', 7.55, 0.55, 6.5, 'AI chat phone')
  phone(s, 'phone-launch.png', 9.95, 1.0, 6.2, 'launch phone')
  s.addNotes('Namaste! WAMA CRM turns WhatsApp chats into sales: AI replies, product launches and offers to all your customers, a shop inside WhatsApp, and support. Built by Magnetora AI Solutions, an official Meta Tech Provider.')

  // ── 2. Problems ────────────────────────────────────────────────────────────
  pres.addSection({ title: 'The problem' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'The problem' })
  s.addText('Where businesses lose customers', { placeholder: 'title' })
  halo(s, 0.45, 1.4, 4.6, RED_TINT)
  phone(s, 'phone-problem.png', 0.75, 1.3, 5.6, 'unread chats phone')
  const pains = [
    [I.clock, 'Late replies', 'They buy from someone else'],
    [I.phone, 'Leads lost', 'Chats stuck in staff phones'],
    [I.forgot, 'No follow-up', 'Interested buyers forgotten'],
    [I.repeat, 'Same questions', '“Price? Timing? Address?”'],
    [I.box, 'Launches missed', 'Customers never find out'],
    [I.tag, 'Offers unseen', 'Posts and SMS get ignored'],
  ]
  pains.forEach(([img, head, body], i) => {
    const x = 5.7 + (i % 2) * 3.55, y = 1.6 + Math.floor(i / 2) * 1.68
    const growth = i >= 4
    tile(s, x, y, 3.35, 1.45, growth ? 'FFF7E8' : RED_TINT, `problem ${i + 1}`)
    circleIcon(s, img, x + 0.22, y + 0.36, 0.72, growth ? C.accent4 : C.accent6, `problem ${i + 1} icon`)
    say(s, head, { x: x + 1.08, y: y + 0.28, w: 2.17, h: 0.45, fontSize: 18, bold: true, color: C.text1 })
    say(s, body, { x: x + 1.08, y: y + 0.74, w: 2.17, h: 0.5, fontSize: 14 })
  })
  s.addNotes('This is what most business WhatsApp numbers look like: 128 unread messages, customers asking price and timing late at night, and one saying they will buy from another shop. Ask: does your WhatsApp look like this? The last two problems are about growth: new launches and offers never reach existing customers.')

  // ── 4. Magnetora ───────────────────────────────────────────────────────────
  pres.addSection({ title: 'Who we are' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Who we are' })
  s.addText('Magnetora AI Solutions', { placeholder: 'title' })
  tile(s, 0.6, 1.55, 4.9, 4.95, C.background1, 'Magnetora logo card', { line: { color: LINE, width: 1 } })
  s.addImage({ path: MAGNETORA_LOGO, x: 0.85, y: 1.75, w: 4.4, h: 4.4, objectName: 'Magnetora AI Solutions logo' })
  say(s, 'We make AI simple for Indian businesses', { x: 6.0, y: 1.6, w: 6.7, h: 1.1, fontSize: 28, bold: true, color: C.text1 })
  const does = [[I.robot, C.accent1, 'AI chatbots'], [I.whatsapp, C.accent2, 'WhatsApp CRM'], [I.brain, C.accent1, 'Custom AI tools']]
  does.forEach(([img, fill, label], i) => {
    const x = 6.0 + i * 2.25
    tile(s, x, 3.0, 2.05, 2.0, i === 1 ? GREEN_TINT : BLUE_TINT, `service ${i + 1}`)
    circleIcon(s, img, x + 0.6, 3.25, 0.85, fill, `service ${i + 1}`)
    say(s, label, { x: x + 0.1, y: 4.25, w: 1.85, h: 0.55, fontSize: 18, bold: true, color: C.text1, align: 'center' })
  })
  badge(s, 6.0, 5.55, 4.2, C.text1, C.background1)
  s.addNotes('Magnetora AI Solutions builds AI products for Indian businesses. We are an official Meta Tech Provider, so we connect you to WhatsApp the official way.')

  // ── 5. Meet WAMA CRM ───────────────────────────────────────────────────────
  pres.addSection({ title: 'The solution' })
  s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'The solution' })
  s.addImage({ path: BRAND + 'wamacrm-logo-horizontal-light.png', x: 0.7, y: 0.55, w: 4.125, h: 1.1, objectName: 'WAMA CRM logo' })
  s.addText('One app for every WhatsApp customer', { placeholder: 'title' })
  const four = [[I.robot, 'Reply'], [I.bullhorn, 'Launch'], [I.cart, 'Sell'], [I.headset, 'Support']]
  four.forEach(([img, label], i) => {
    const x = 0.7 + i * 1.62
    circleIcon(s, img, x + 0.2, 4.35, 1.0, i % 2 ? C.accent2 : C.accent1, `${label} icon`)
    say(s, label, { x, y: 5.45, w: 1.4, h: 0.45, fontSize: 18, bold: true, color: C.background1, align: 'center' })
  })
  s.addImage({ path: IMG + 'dashboard.png', x: 7.0, y: 1.9, w: 6.1, h: 6.1 / dashRatio, objectName: 'WAMA CRM dashboard' })
  s.addNotes('WAMA CRM does four jobs in one app: replying, launching products and offers, selling and support. Your whole team works from one WhatsApp number.')

  // ── 6. AI replies ──────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'The solution' })
  s.addText('AI replies in seconds, in their language', { placeholder: 'title' })
  ;['English', 'తెలుగు', 'हिंदी', 'Tenglish', 'Hinglish'].forEach((label, i) =>
    chip(s, label, 0.6 + (i % 3) * 2.35, 1.75 + Math.floor(i / 3) * 0.75, 2.15, BLUE_TINT, C.accent1, 0.58, 18))
  point(s, I.clock, C.accent1, '24 × 7', 'Even at 2 AM', 0.6, 3.5)
  point(s, I.store, C.accent2, 'Knows your business', 'Products, prices, FAQs', 0.6, 4.58)
  point(s, I.hand, C.accent1, 'Hands over', 'Hot leads to your team', 0.6, 5.66)
  halo(s, 8.3, 1.35, 4.6, BLUE_TINT)
  phone(s, 'phone-ai.png', 8.6, 1.25, 5.6, 'AI chat phone')
  s.addNotes('The AI understands how Indians really type, including Telugu and Hindi in English letters, and answers from your own product list and FAQs.')

  // ── 7. Launches and offers to the customer base ────────────────────────────
  pres.addSection({ title: 'Reach your customers' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Reach your customers' })
  s.addText('New launch? Tell every customer in one click', { placeholder: 'title' })
  halo(s, 0.45, 1.4, 4.6, GREEN_TINT)
  phone(s, 'phone-launch.png', 0.75, 1.3, 5.6, 'launch phone')
  point(s, I.users, C.accent1, 'All your customers, one list', 'From every chat, order and Excel sheet', 5.9, 1.6)
  point(s, I.filter, C.accent2, 'Pick who gets it', 'Past buyers, city, interest, tags', 5.9, 2.75)
  point(s, I.gift, C.accent1, 'Photo, offer code, Shop button', 'They can buy straight from the message', 5.9, 3.9)
  point(s, I.eye, C.accent2, 'See who read and bought', 'Delivered, read, replied, ordered', 5.9, 5.05)
  s.addNotes('This answers the launch problem. Every customer who ever messaged or bought is already in WAMA CRM. Pick a group, add a photo and an offer code, and send. Customers can tap Shop now and buy in the chat.')

  // ── 8. Offers that bring customers back ────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Reach your customers' })
  s.addText('Offers that bring customers back', { placeholder: 'title' })
  const offerFlow = [
    [I.users, 'Customer list'],
    [I.filter, 'Choose group'],
    [I.paper, 'Send offer'],
    [I.cart, 'Orders come in'],
  ]
  offerFlow.forEach(([img, label], i) => {
    const x = 0.6 + i * 1.82
    circleIcon(s, img, x + 0.35, 1.7, 0.9, i === 3 ? C.accent2 : C.accent1, `${label} step`)
    say(s, label, { x, y: 2.72, w: 1.6, h: 0.45, fontSize: 15, bold: true, color: C.text1, align: 'center' })
    if (i < offerFlow.length - 1) s.addShape(pres.shapes.RIGHT_ARROW, { x: x + 1.42, y: 2.0, w: 0.32, h: 0.3, fill: { color: 'C9D3E6' }, line: { type: 'none' }, objectName: `flow arrow ${i + 1}` })
  })
  const offers = [
    [I.star, 'Festival offers', 'Diwali, Sankranti, Ugadi'],
    [I.bell, 'Reminders', 'Appointments, renewals, stock back'],
    [I.calendar, 'Schedule once', 'Sends at the right time'],
    [I.badge, 'Meta approved', 'Your number stays safe'],
  ]
  offers.forEach(([img, head, body], i) => {
    const x = 0.6 + (i % 2) * 3.65, y = 3.5 + Math.floor(i / 2) * 1.55
    tile(s, x, y, 3.45, 1.35, i % 2 ? GREEN_TINT : BLUE_TINT, `offer ${i + 1}`)
    circleIcon(s, img, x + 0.25, y + 0.3, 0.75, i % 2 ? C.accent2 : C.accent1, `offer ${i + 1} icon`)
    say(s, head, { x: x + 1.15, y: y + 0.22, w: 2.2, h: 0.42, fontSize: 18, bold: true, color: C.text1 })
    say(s, body, { x: x + 1.15, y: y + 0.66, w: 2.2, h: 0.55, fontSize: 14 })
  })
  halo(s, 8.3, 1.35, 4.6, BLUE_TINT)
  phone(s, 'phone-campaign.png', 8.6, 1.25, 5.6, 'offer phone')
  s.addNotes('Most businesses post offers on Instagram or send SMS, and most customers never see them. On WhatsApp, the offer reaches the customer’s chat list with a button to book or buy.')

  // ── 9. E-commerce hero ─────────────────────────────────────────────────────
  pres.addSection({ title: 'E-commerce' })
  s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'E-commerce' })
  s.background = { path: IMG + 'bg-cover.png' }
  chip(s, 'NEW · WhatsApp Commerce', 0.7, 0.75, 3.6, C.accent2, C.background1)
  s.addText('Your shop, inside WhatsApp', { placeholder: 'title' })
  s.addText('No website. No app. Customers browse, order and pay in the chat.', { placeholder: 'body' })
  ;[[I.store, 'Catalog'], [I.cart, 'Cart'], [I.pin, 'Address'], [I.card, 'Pay'], [I.truck, 'Delivery']].forEach(([img, label], i) => {
    const x = 0.7 + i * 1.3
    circleIcon(s, img, x + 0.12, 5.3, 0.85, i % 2 ? C.accent2 : C.accent1, `${label} step`)
    say(s, label, { x: x - 0.1, y: 6.22, w: 1.3, h: 0.4, fontSize: 15, bold: true, color: C.background1, align: 'center' })
  })
  phone(s, 'phone-shop.png', 7.4, 0.5, 6.6, 'shop phone')
  phone(s, 'phone-pay.png', 9.95, 0.9, 6.2, 'payment phone')
  s.addNotes('For shops and brands: customers see your catalog, add to cart, give their address and pay, without leaving WhatsApp.')

  // ── 10. E-commerce features ────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'E-commerce' })
  s.addText('Everything a WhatsApp shop needs', { placeholder: 'title' })
  const shopTiles = [
    [I.sync, 'Catalog sync', 'With your Meta catalog'],
    [I.card, 'UPI · Cards · COD', 'WhatsApp Pay built in'],
    [I.robot, 'AI shop assistant', '“Where is my order?”'],
    [I.truck, 'Auto order updates', 'Paid, packed, shipped'],
    [I.chart, 'Orders in CRM', 'Every order, one screen'],
    [I.gift, 'Repeat sales', 'Thank-you and offers'],
  ]
  shopTiles.forEach(([img, head, body], i) => {
    const x = 0.6 + (i % 3) * 4.1, y = 1.55 + Math.floor(i / 3) * 2.6
    const green = (i + Math.floor(i / 3)) % 2 === 1
    tile(s, x, y, 3.85, 2.35, green ? GREEN_TINT : BLUE_TINT, `shop tile ${i + 1}`)
    circleIcon(s, img, x + 0.3, y + 0.35, 0.8, green ? C.accent2 : C.accent1, `shop tile ${i + 1} icon`)
    say(s, head, { x: x + 0.3, y: y + 1.3, w: 3.3, h: 0.45, fontSize: 21, bold: true, color: C.text1 })
    say(s, body, { x: x + 0.3, y: y + 1.78, w: 3.3, h: 0.4, fontSize: 16 })
  })
  s.addNotes('Stress UPI and Cash on Delivery, and that every order lands in the CRM.')

  // ── 11. Support ────────────────────────────────────────────────────────────
  pres.addSection({ title: 'Support' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Support' })
  s.addText('Support that never sleeps', { placeholder: 'title' })
  point(s, I.robot, C.accent1, 'AI answers first', '24 × 7, instantly', 0.6, 1.65, 6.4)
  point(s, I.ticket, C.accent2, 'A ticket for every request', 'Nothing gets lost', 0.6, 2.85, 6.4)
  point(s, I.hand, C.accent1, 'Smooth hand-over', 'To the right person', 0.6, 4.05, 6.4)
  point(s, I.stopwatch, C.accent2, 'Reply time limits', 'Alerts before delays', 0.6, 5.25, 6.4)
  halo(s, 8.3, 1.35, 4.6, GREEN_TINT)
  phone(s, 'phone-support.png', 8.6, 1.25, 5.6, 'support phone')
  s.addNotes('AI answers first. When a person is needed, a ticket is created and assigned with a reply time limit.')

  // ── 12. Before and after ───────────────────────────────────────────────────
  pres.addSection({ title: 'Your gain' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Your gain' })
  s.addText('Before vs. after WAMA CRM', { placeholder: 'title' })
  const before = ['Reply next day', 'Leads in staff phones', 'Launches reach a few people', 'Customers call to order', 'Guess what works']
  const after = ['Reply in seconds', 'Every lead in CRM', 'Launches reach every customer', 'Order and pay in chat', 'Live reports']
  tile(s, 0.6, 1.55, 5.85, 5.05, C.background2, 'before column')
  tile(s, 6.85, 1.55, 5.85, 5.05, GREEN_TINT, 'after column')
  say(s, 'Before', { x: 1.0, y: 1.8, w: 5, h: 0.6, fontSize: 26, bold: true, color: C.text2 })
  say(s, 'With WAMA CRM', { x: 7.25, y: 1.8, w: 5, h: 0.6, fontSize: 26, bold: true, color: C.accent2 })
  before.forEach((item, i) => {
    circleIcon(s, I.xmark, 1.0, 2.62 + i * 0.78, 0.5, 'B8C0D0', `before ${i + 1}`)
    say(s, item, { x: 1.7, y: 2.62 + i * 0.78, w: 4.6, h: 0.5, fontSize: 19, color: C.text2, valign: 'middle' })
  })
  after.forEach((item, i) => {
    circleIcon(s, I.check, 7.25, 2.62 + i * 0.78, 0.5, C.accent2, `after ${i + 1}`)
    say(s, item, { x: 7.95, y: 2.62 + i * 0.78, w: 4.6, h: 0.5, fontSize: 19, bold: true, color: C.text1, valign: 'middle' })
  })
  s.addNotes('Read the left side, then the right. Ask which change matters most to them.')

  // ── 13. Customers ──────────────────────────────────────────────────────────
  pres.addSection({ title: 'Trusted by' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Trusted by' })
  s.addText('Trusted by organisations that serve people', { placeholder: 'title' })
  tile(s, 0.6, 1.55, 5.95, 4.95, C.background1, 'DEEP card', { line: { color: LINE, width: 1 }, shadow: true })
  s.addImage({ path: BRAND + 'customers/deep-trust-logo.png', x: 0.95, y: 2.0, w: 5.25, h: 5.25 / deepRatio, objectName: 'DEEP Trust logo' })
  chip(s, 'Health screening campaigns', 0.95, 4.15, 5.25, C.background2, C.text1, 0.6, 18)
  say(s, 'WhatsApp campaigns for health camps, and support for people who reach out', { x: 0.95, y: 4.95, w: 5.25, h: 0.9, fontSize: 16, align: 'center' })
  say(s, 'deepindia.org', { x: 0.95, y: 5.9, w: 5.25, h: 0.35, fontSize: 14, bold: true, color: C.accent1, align: 'center' })
  tile(s, 6.75, 1.55, 5.95, 4.95, C.background1, 'Consular Helpdesk card', { line: { color: LINE, width: 1 }, shadow: true })
  s.addImage({ path: BRAND + 'customers/consular-helpdesk-logo.png', x: 7.15, y: 1.85, w: 2.0, h: 2.0, objectName: 'Consular Helpdesk logo' })
  say(s, 'Consular Helpdesk', { x: 9.3, y: 2.35, w: 3.2, h: 0.55, fontSize: 22, bold: true, color: '7A1E2C' })
  say(s, 'Passport · OCI · PCC', { x: 9.3, y: 2.9, w: 3.2, h: 0.4, fontSize: 15 })
  chip(s, 'AI chat support + tickets', 7.1, 4.15, 5.25, C.background2, C.text1, 0.6, 18)
  say(s, 'AI answers questions 24 × 7 and every request becomes a tracked ticket', { x: 7.1, y: 4.95, w: 5.25, h: 0.9, fontSize: 16, align: 'center' })
  say(s, 'consularhelpdesk.com', { x: 7.1, y: 5.9, w: 5.25, h: 0.35, fontSize: 14, bold: true, color: C.accent1, align: 'center' })
  s.addNotes('DEEP Trust (Disease Eradication through Education and Prevention) uses WAMA CRM for health screening campaigns and support. Consular Helpdesk uses it for AI chat support with tickets for passport, OCI and PCC help.')

  // ── 14. Why us ─────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Trusted by' })
  s.addText('Why WAMA CRM', { placeholder: 'title' })
  const why = [
    [I.badge, 'Official', 'Meta Tech Provider'],
    [I.rupee, '0% markup', 'Pay Meta’s rates directly'],
    [I.language, 'Made for India', 'Languages, UPI, COD'],
    [I.bolt, 'Live in minutes', 'No coding needed'],
  ]
  why.forEach(([img, head, body], i) => {
    const x = 0.6 + i * 3.06
    tile(s, x, 1.6, 2.86, 4.3, i % 2 ? GREEN_TINT : BLUE_TINT, `reason ${i + 1}`)
    circleIcon(s, img, x + 0.73, 2.35, 1.4, i % 2 ? C.accent2 : C.accent1, `reason ${i + 1} icon`)
    say(s, head, { x: x + 0.15, y: 4.1, w: 2.56, h: 0.6, fontSize: 26, bold: true, color: C.text1, align: 'center' })
    say(s, body, { x: x + 0.25, y: 4.8, w: 2.36, h: 0.9, fontSize: 18, align: 'center' })
  })
  s.addNotes('Four reasons: official Meta connection, no markup on Meta charges, built for India, and quick to start.')

  // ── 15. Call to action ─────────────────────────────────────────────────────
  pres.addSection({ title: 'Next steps' })
  s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Next steps' })
  s.background = { path: IMG + 'bg-cover.png' }
  s.addImage({ path: BRAND + 'wamacrm-logo-horizontal-light.png', x: 0.7, y: 0.55, w: 4.125, h: 1.1, objectName: 'WAMA CRM logo' })
  s.addText('Let’s grow your business on WhatsApp', { placeholder: 'title' })
  s.addText('14-day free trial · wamacrm.magnetora.in', { placeholder: 'body' })
  ;[[I.calendar, 'Free demo'], [I.plug, 'Connect WhatsApp'], [I.rocket, 'Go live']].forEach(([img, label], i) => {
    const y = 1.35 + i * 1.7
    tile(s, 8.2, y, 4.5, 1.4, C.background1, `step ${i + 1}`)
    circleIcon(s, img, 8.5, y + 0.28, 0.85, i % 2 ? C.accent2 : C.accent1, `step ${i + 1} icon`)
    say(s, `${i + 1}`, { x: 11.9, y: y + 0.3, w: 0.6, h: 0.8, fontSize: 36, bold: true, color: 'C7D2FE', align: 'right', valign: 'middle' })
    say(s, label, { x: 9.6, y: y + 0.3, w: 2.4, h: 0.8, fontSize: 22, bold: true, color: C.text1, valign: 'middle' })
  })
  say(s, 'Thank you · ధన్యవాదాలు · धन्यवाद', { x: 0.7, y: 6.45, w: 7, h: 0.45, fontSize: 20, color: '9FF0B0' })
  s.addNotes('Book the demo date before you leave the meeting. Offer to connect their WhatsApp number together on a call.')

  await pres.writeFile({ fileName: OUT })
  await applyTheme(OUT, THEME)
  console.log('wrote', OUT)
})().catch(error => { console.error(error); process.exit(1) })
