// WAMA CRM client deck, visual edition: few words, colourful tiles, phone mock-ups, real customer logos
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
  name: 'WAMA CRM Bright',
  headFontFace: 'Arial',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '0E1B3D', lt1: 'FFFFFF', dk2: '4A5874', lt2: 'F2F6FD',
    accent1: '1D5BEA', accent2: '00A884', accent3: 'F97316', accent4: 'EC4899', accent5: '7C3AED', accent6: 'E5484D',
    hlink: '1D5BEA', folHlink: '4A5874',
  },
}
// Two extra brights the theme has no slot for
const CYAN = '0EA5E9', AMBER = 'F59E0B'

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
    robot: fa.FaRobot, cart: fa.FaCartShopping, bullhorn: fa.FaBullhorn, headset: fa.FaHeadset, store: fa.FaStore, list: fa.FaLocationDot,
    card: fa.FaCreditCard, truck: fa.FaTruckFast, sync: fa.FaArrowsRotate, chart: fa.FaChartLine, gift: fa.FaGift, ticket: fa.FaTicket,
    hand: fa.FaHandshake, stopwatch: fa.FaStopwatch, file: fa.FaFileExcel, image: fa.FaImage, badge: fa.FaCircleCheck, rupee: fa.FaIndianRupeeSign,
    india: fa.FaLanguage, bolt: fa.FaBolt, xmark: fa.FaXmark, check: fa.FaCheck, calendar: fa.FaCalendarCheck, plug: fa.FaPlug, rocket: fa.FaRocket,
    brain: fa.FaBrain, heart: fa.FaHeartPulse, globe: fa.FaEarthAsia, star: fa.FaStar,
  }
  for (const [key, Component] of Object.entries(want)) I[key] = await icon(Component)
  // The same icon drawn in a tile's colour, for white circles on coloured tiles
  const tinted = {}
  for (const [key, Component] of Object.entries(want)) tinted[key] = {}
  const HEXOF = { [C.accent1]: THEME.colors.accent1, [C.accent2]: THEME.colors.accent2, [C.accent3]: THEME.colors.accent3, [C.accent4]: THEME.colors.accent4, [C.accent5]: THEME.colors.accent5, [C.accent6]: THEME.colors.accent6 }
  const tint = async (key, fill) => {
    const hex = HEXOF[fill] || fill
    if (!tinted[key][hex]) tinted[key][hex] = await icon(want[key], '#' + hex)
    return tinted[key][hex]
  }
  const keyOf = img => Object.keys(I).find(key => I[key] === img)
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
      { image: { path: BRAND + 'wamacrm-logo-horizontal.png', x: 0.6, y: 6.98, w: 1.4, h: 0.4 } },
    ],
    slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.35, fontSize: 10, color: '8A96B0', align: 'right' },
  })

  const shadow = () => ({ type: 'outer', color: '0E1B3D', opacity: 0.14, blur: 12, offset: 4, angle: 90 })
  const box = (slide, x, y, w, h, fill, name, radius = 0.18, line = { type: 'none' }) =>
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: radius, fill: { color: fill }, line, shadow: shadow(), objectName: name })
  const circleIcon = (slide, img, x, y, d, fill, name) => {
    slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { type: 'none' }, objectName: name + ' circle' })
    slide.addImage({ data: img, x: x + d * 0.25, y: y + d * 0.25, w: d * 0.5, h: d * 0.5, objectName: name })
  }
  const whiteIcon = async (slide, img, x, y, d, tileFill, name) => {
    slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: C.background1 }, line: { type: 'none' }, objectName: name + ' circle' })
    slide.addImage({ data: await tint(keyOf(img), tileFill), x: x + d * 0.25, y: y + d * 0.25, w: d * 0.5, h: d * 0.5, objectName: name })
  }
  const say = (slide, value, opts) => slide.addText(value, { isTextBox: true, margin: 0, valign: 'top', fontSize: 16, color: C.text2, ...opts })
  const phone = (slide, file, x, y, h, name) => slide.addImage({ path: IMG + file, x, y, w: h * phoneRatio, h, objectName: name })
  const chip = (slide, value, x, y, w, fill, color = C.background1, h = 0.48, fontSize = 15) => {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: h / 2, fill: { color: fill }, line: { type: 'none' }, objectName: `${value} chip` })
    say(slide, value, { x, y, w, h, fontSize, bold: true, color, align: 'center', valign: 'middle' })
  }

  // ── 1. Cover ───────────────────────────────────────────────────────────────
  pres.addSection({ title: 'Introduction' })
  let s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Introduction' })
  s.background = { path: IMG + 'bg-cover.png' }
  s.addImage({ path: BRAND + 'wamacrm-logo-horizontal-light.png', x: 0.7, y: 0.55, w: 3.85, h: 1.1, objectName: 'WAMA CRM logo' })
  s.addText('Turn WhatsApp chats into sales', { placeholder: 'title' })
  s.addText('AI replies · Shop in chat · Campaigns · Support', { placeholder: 'body' })
  chip(s, '     Official Meta Tech Provider', 0.7, 5.35, 3.8, C.accent2)
  s.addImage({ data: I.badge, x: 0.92, y: 5.46, w: 0.26, h: 0.26, objectName: 'badge icon' })
  say(s, 'by Magnetora AI Solutions', { x: 0.7, y: 6.55, w: 5, h: 0.4, fontSize: 15, color: 'B9C7EC' })
  phone(s, 'phone-ai.png', 7.55, 0.55, 6.5, 'AI chat phone')
  phone(s, 'phone-pay.png', 9.95, 1.0, 6.2, 'payment phone')
  s.addNotes('Namaste! WAMA CRM turns WhatsApp chats into sales: AI replies, a shop inside WhatsApp, campaigns and support, all in one app. Built by Magnetora AI Solutions, an official Meta Tech Provider.')

  // ── 2. Problem ─────────────────────────────────────────────────────────────
  pres.addSection({ title: 'The problem' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'The problem' })
  s.addText('Customers message. Who replies?', { placeholder: 'title' })
  const pains = [
    [I.clock, C.accent6, 'Late replies', 'They buy from someone else'],
    [I.phone, C.accent3, 'Leads lost', 'Chats stuck in staff phones'],
    [I.forgot, C.accent5, 'No follow-up', 'Interested buyers forgotten'],
    [I.repeat, C.accent4, 'Same questions', '“Price? Timing? Address?”'],
  ]
  for (const [i, [img, fill, head, body]] of pains.entries()) {
    const x = 0.6 + i * 3.06
    box(s, x, 1.6, 2.86, 4.9, fill, `pain ${i + 1}`)
    await whiteIcon(s, img, x + 0.78, 2.35, 1.3, fill, `pain ${i + 1} icon`)
    say(s, head, { x: x + 0.2, y: 4.0, w: 2.46, h: 0.6, fontSize: 26, bold: true, color: C.background1, align: 'center' })
    say(s, body, { x: x + 0.25, y: 4.7, w: 2.36, h: 1.2, fontSize: 18, color: C.background1, align: 'center' })
  }
  s.addNotes('Ask the client: which of these happens in your business today? Most say all four.')

  // ── 3. Loss ────────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'The problem' })
  s.addText('What it costs you', { placeholder: 'title' })
  box(s, 0.6, 1.55, 6.3, 4.95, C.accent6, 'loss panel')
  say(s, 'You may be losing', { x: 1.0, y: 1.95, w: 5.5, h: 0.5, fontSize: 22, color: 'FFE4E6' })
  say(s, '₹6.7 lakh', { x: 1.0, y: 2.5, w: 5.5, h: 1.4, fontSize: 80, bold: true, color: C.background1 })
  say(s, 'every year', { x: 1.0, y: 3.95, w: 5.5, h: 0.6, fontSize: 30, bold: true, color: C.background1 })
  say(s, 'Example: 300 enquiries a month, ₹2,000 average sale', { x: 1.0, y: 5.75, w: 5.6, h: 0.4, fontSize: 13, italic: true, color: 'FFE4E6' })
  const leaks = [
    [I.clock, C.accent3, '90', 'enquiries a month get no quick reply'],
    [I.forgot, C.accent5, '60', 'interested leads never followed up'],
    [I.stopwatch, C.accent4, '52 hrs', 'staff time on the same questions'],
  ]
  leaks.forEach(([img, fill, big, small], i) => {
    const y = 1.55 + i * 1.7
    box(s, 7.3, y, 5.4, 1.5, 'FFF1F2', `leak ${i + 1}`)
    circleIcon(s, img, 7.55, y + 0.3, 0.9, fill, `leak ${i + 1} icon`)
    say(s, big, { x: 8.7, y: y + 0.18, w: 3.8, h: 0.65, fontSize: 32, bold: true, color: C.text1 })
    say(s, small, { x: 8.7, y: y + 0.85, w: 3.8, h: 0.45, fontSize: 16, color: C.text2 })
  })
  s.addNotes('Missed replies cost about 36,000 rupees a month, no follow-up about 12,000, and staff time about 7,800. That is 55,800 a month, about 6.7 lakh a year. Redo this with the client’s own numbers.')

  // ── 4. Magnetora ───────────────────────────────────────────────────────────
  pres.addSection({ title: 'Who we are' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Who we are' })
  s.addText('Magnetora AI Solutions', { placeholder: 'title' })
  box(s, 0.6, 1.55, 4.9, 4.95, C.background1, 'Magnetora logo card', 0.18, { color: 'E1E7F2', width: 1 })
  s.addImage({ path: MAGNETORA_LOGO, x: 0.85, y: 1.75, w: 4.4, h: 4.4, objectName: 'Magnetora AI Solutions logo' })
  say(s, 'We make AI simple for Indian businesses', { x: 6.0, y: 1.6, w: 6.7, h: 1.1, fontSize: 28, bold: true, color: C.text1 })
  const does = [
    [I.robot, C.accent1, 'AI chatbots'],
    [I.whatsapp, C.accent2, 'WhatsApp CRM'],
    [I.brain, C.accent5, 'Custom AI tools'],
  ]
  for (const [i, [img, fill, label]] of does.entries()) {
    const x = 6.0 + i * 2.25
    box(s, x, 3.0, 2.05, 2.0, fill, `service ${i + 1}`)
    await whiteIcon(s, img, x + 0.6, 3.25, 0.85, fill, `service ${i + 1}`)
    say(s, label, { x: x + 0.1, y: 4.25, w: 1.85, h: 0.55, fontSize: 18, bold: true, color: C.background1, align: 'center' })
  }
  chip(s, '     Official Meta Tech Provider', 6.0, 5.55, 4.2, C.text1)
  s.addImage({ data: I.badge, x: 6.24, y: 5.66, w: 0.26, h: 0.26, objectName: 'badge icon' })
  s.addNotes('Magnetora AI Solutions builds AI products for Indian businesses. We are an official Meta Tech Provider, so we connect you to WhatsApp the official way.')

  // ── 5. Meet WAMA CRM ───────────────────────────────────────────────────────
  pres.addSection({ title: 'The solution' })
  s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'The solution' })
  s.addImage({ path: BRAND + 'wamacrm-logo-horizontal-light.png', x: 0.7, y: 0.55, w: 3.85, h: 1.1, objectName: 'WAMA CRM logo' })
  s.addText('One app for every WhatsApp customer', { placeholder: 'title' })
  const four = [[I.robot, C.accent1, 'Reply'], [I.cart, C.accent2, 'Sell'], [I.bullhorn, C.accent3, 'Market'], [I.headset, C.accent4, 'Support']]
  four.forEach(([img, fill, label], i) => {
    const x = 0.7 + i * 1.62
    circleIcon(s, img, x + 0.2, 4.35, 1.0, fill, `${label} icon`)
    say(s, label, { x, y: 5.45, w: 1.4, h: 0.45, fontSize: 18, bold: true, color: C.background1, align: 'center' })
  })
  s.addImage({ path: IMG + 'dashboard.png', x: 7.0, y: 1.9, w: 6.1, h: 6.1 / dashRatio, objectName: 'WAMA CRM dashboard' })
  s.addNotes('WAMA CRM does four jobs in one app: replies, selling, marketing and support. Your whole team works from one WhatsApp number.')

  // ── 6. AI replies ──────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'The solution' })
  s.addText('AI replies in seconds, in their language', { placeholder: 'title' })
  const langs = [['English', C.accent1], ['తెలుగు', C.accent2], ['हिंदी', C.accent3], ['Tenglish', C.accent4], ['Hinglish', C.accent5]]
  langs.forEach(([label, fill], i) => chip(s, label, 0.6 + (i % 3) * 2.35, 1.75 + Math.floor(i / 3) * 0.75, 2.15, fill, C.background1, 0.58, 18))
  const aiPoints = [[I.clock, C.accent1, '24 × 7', 'Even at 2 AM'], [I.store, C.accent2, 'Knows your business', 'Products, prices, FAQs'], [I.hand, C.accent3, 'Hands over', 'Hot leads to your team']]
  aiPoints.forEach(([img, fill, head, body], i) => {
    const y = 3.5 + i * 1.08
    circleIcon(s, img, 0.6, y, 0.82, fill, `AI point ${i + 1}`)
    say(s, head, { x: 1.6, y: y + 0.02, w: 5.2, h: 0.42, fontSize: 21, bold: true, color: C.text1 })
    say(s, body, { x: 1.6, y: y + 0.44, w: 5.2, h: 0.38, fontSize: 16 })
  })
  s.addShape(pres.shapes.OVAL, { x: 8.3, y: 1.35, w: 4.6, h: 4.6, fill: { color: 'E8EEFF' }, line: { type: 'none' }, objectName: 'phone halo' })
  phone(s, 'phone-ai.png', 8.6, 1.25, 5.6, 'AI chat phone')
  s.addNotes('The AI understands how Indians really type, including Telugu and Hindi in English letters, and answers from your own product list and FAQs.')

  // ── 7. E-commerce hero ─────────────────────────────────────────────────────
  pres.addSection({ title: 'E-commerce' })
  s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'E-commerce' })
  s.background = { path: IMG + 'bg-cover.png' }
  chip(s, 'NEW · WhatsApp Commerce', 0.7, 0.75, 3.6, C.accent4)
  s.addText('Your shop, inside WhatsApp', { placeholder: 'title' })
  s.addText('No website. No app. Customers browse, order and pay in the chat.', { placeholder: 'body' })
  const shopSteps = [[I.store, C.accent1, 'Catalog'], [I.cart, C.accent2, 'Cart'], [I.list, C.accent3, 'Address'], [I.card, C.accent4, 'Pay'], [I.truck, C.accent5, 'Delivery']]
  shopSteps.forEach(([img, fill, label], i) => {
    const x = 0.7 + i * 1.3
    circleIcon(s, img, x + 0.12, 5.3, 0.85, fill, `${label} step`)
    say(s, label, { x: x - 0.1, y: 6.22, w: 1.3, h: 0.4, fontSize: 15, bold: true, color: C.background1, align: 'center' })
  })
  phone(s, 'phone-shop.png', 7.4, 0.5, 6.6, 'shop phone')
  phone(s, 'phone-pay.png', 9.95, 0.9, 6.2, 'payment phone')
  s.addNotes('This is the big one for shops and brands. Customers see your catalog, add to cart, give their address and pay, without leaving WhatsApp.')

  // ── 8. E-commerce benefits ─────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'E-commerce' })
  s.addText('Everything a WhatsApp shop needs', { placeholder: 'title' })
  const shopTiles = [
    [I.sync, C.accent1, 'Catalog sync', 'With your Meta catalog'],
    [I.card, C.accent2, 'UPI · Cards · COD', 'WhatsApp Pay built in'],
    [I.robot, C.accent5, 'AI shop assistant', '“Where is my order?”'],
    [I.truck, C.accent3, 'Auto order updates', 'Paid, packed, shipped'],
    [I.chart, CYAN, 'Orders in CRM', 'Every order, one screen'],
    [I.gift, C.accent4, 'Repeat sales', 'Thank-you and offers'],
  ]
  for (const [i, [img, fill, head, body]] of shopTiles.entries()) {
    const x = 0.6 + (i % 3) * 4.1, y = 1.6 + Math.floor(i / 3) * 2.55
    box(s, x, y, 3.85, 2.3, fill, `shop tile ${i + 1}`)
    await whiteIcon(s, img, x + 0.35, y + 0.35, 0.85, fill, `shop tile ${i + 1}`)
    say(s, head, { x: x + 0.35, y: y + 1.32, w: 3.2, h: 0.48, fontSize: 21, bold: true, color: C.background1 })
    say(s, body, { x: x + 0.35, y: y + 1.8, w: 3.2, h: 0.4, fontSize: 16, color: C.background1 })
  }
  s.addNotes('Walk through each tile quickly. Stress UPI and Cash on Delivery, and that every order lands in the CRM.')

  // ── 9. Campaigns ───────────────────────────────────────────────────────────
  pres.addSection({ title: 'Features' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Features' })
  s.addText('Send offers people actually read', { placeholder: 'title' })
  s.addShape(pres.shapes.OVAL, { x: 0.45, y: 1.4, w: 4.6, h: 4.6, fill: { color: 'FFEDE0' }, line: { type: 'none' }, objectName: 'phone halo' })
  phone(s, 'phone-campaign.png', 0.75, 1.3, 5.6, 'campaign phone')
  const campaignPoints = [
    [I.file, C.accent2, 'Upload Excel', 'Names and offers, personalised'],
    [I.image, C.accent3, 'Photo, video, offers', 'Every Meta template type'],
    [I.badge, C.accent1, 'Meta approved', 'Your number stays safe'],
  ]
  campaignPoints.forEach(([img, fill, head, body], i) => {
    const y = 1.5 + i * 1.05
    circleIcon(s, img, 5.9, y, 0.85, fill, `campaign point ${i + 1}`)
    say(s, head, { x: 6.95, y: y + 0.02, w: 5.6, h: 0.45, fontSize: 21, bold: true, color: C.text1 })
    say(s, body, { x: 6.95, y: y + 0.47, w: 5.6, h: 0.4, fontSize: 16 })
  })
  const funnel = [['Sent', '8A96B0', 5.0], ['Delivered', CYAN, 4.4], ['Read', C.accent1, 3.6], ['Replied', C.accent2, 2.4]]
  funnel.forEach(([label, fill, w], i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.9, y: 5.25 + i * 0.4, w, h: 0.32, rectRadius: 0.08, fill: { color: fill }, line: { type: 'none' }, objectName: `${label} bar` })
    say(s, label, { x: 6.0, y: 5.25 + i * 0.4, w: 2, h: 0.32, fontSize: 12, bold: true, color: C.background1, valign: 'middle' })
  })
  say(s, 'Track every message', { x: 5.9, y: 4.75, w: 5, h: 0.35, fontSize: 15, bold: true, color: C.text1 })
  s.addNotes('Upload an Excel sheet, pick a Meta-approved template and send. You see who received, read and replied.')

  // ── 10. Support ────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Features' })
  s.addText('Support that never sleeps', { placeholder: 'title' })
  const supportTiles = [
    [I.robot, C.accent5, 'AI answers first', '24 × 7, instantly'],
    [I.ticket, C.accent3, 'A ticket for every request', 'Nothing gets lost'],
    [I.hand, C.accent2, 'Smooth hand-over', 'To the right person'],
    [I.stopwatch, C.accent6, 'Reply time limits', 'Alerts before delays'],
  ]
  for (const [i, [img, fill, head, body]] of supportTiles.entries()) {
    const x = 0.6 + (i % 2) * 3.65, y = 1.6 + Math.floor(i / 2) * 2.55
    box(s, x, y, 3.45, 2.3, fill, `support tile ${i + 1}`)
    await whiteIcon(s, img, x + 0.3, y + 0.3, 0.8, fill, `support tile ${i + 1}`)
    say(s, head, { x: x + 0.3, y: y + 1.2, w: 2.95, h: 0.62, fontSize: 19, bold: true, color: C.background1 })
    say(s, body, { x: x + 0.3, y: y + 1.82, w: 2.95, h: 0.38, fontSize: 15, color: C.background1 })
  }
  s.addShape(pres.shapes.OVAL, { x: 8.3, y: 1.35, w: 4.6, h: 4.6, fill: { color: 'F1E8FF' }, line: { type: 'none' }, objectName: 'phone halo' })
  phone(s, 'phone-support.png', 8.6, 1.25, 5.6, 'support phone')
  s.addNotes('AI answers first. When a person is needed, a ticket is created and assigned with a reply time limit.')

  // ── 11. Before and after ───────────────────────────────────────────────────
  pres.addSection({ title: 'Your gain' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Your gain' })
  s.addText('Before vs. after WAMA CRM', { placeholder: 'title' })
  const before = ['Reply next day', 'Leads in staff phones', 'Customers call to order', 'Guess what works']
  const after = ['Reply in seconds', 'Every lead in CRM', 'Order and pay in chat', 'Live reports']
  box(s, 0.6, 1.55, 5.85, 4.95, 'F3F4F6', 'before column')
  box(s, 6.85, 1.55, 5.85, 4.95, C.accent2, 'after column')
  say(s, 'Before', { x: 1.0, y: 1.8, w: 5, h: 0.6, fontSize: 26, bold: true, color: C.text2 })
  say(s, 'With WAMA CRM', { x: 7.25, y: 1.8, w: 5, h: 0.6, fontSize: 26, bold: true, color: C.background1 })
  before.forEach((item, i) => {
    circleIcon(s, I.xmark, 1.0, 2.7 + i * 0.9, 0.55, C.accent6, `before ${i + 1}`)
    say(s, item, { x: 1.75, y: 2.7 + i * 0.9, w: 4.5, h: 0.55, fontSize: 20, color: C.text2, valign: 'middle' })
  })
  for (const [i, item] of after.entries()) {
    await whiteIcon(s, I.check, 7.25, 2.7 + i * 0.9, 0.55, C.accent2, `after ${i + 1}`)
    say(s, item, { x: 8.0, y: 2.7 + i * 0.9, w: 4.5, h: 0.55, fontSize: 20, bold: true, color: C.background1, valign: 'middle' })
  }
  s.addNotes('Read the left side, then the right. In our example, even saving half the loss is about 3.3 lakh rupees a year.')

  // ── 12. Customers ──────────────────────────────────────────────────────────
  pres.addSection({ title: 'Trusted by' })
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Trusted by' })
  s.addText('Trusted by organisations that serve people', { placeholder: 'title' })
  // DEEP Trust
  box(s, 0.6, 1.55, 5.95, 4.95, C.background1, 'DEEP card', 0.18, { color: 'E1E7F2', width: 1 })
  s.addImage({ path: BRAND + 'customers/deep-trust-logo.png', x: 0.95, y: 2.0, w: 5.25, h: 5.25 / deepRatio, objectName: 'DEEP Trust logo' })
  chip(s, 'Health screening campaigns', 0.95, 4.15, 5.25, C.accent3, C.background1, 0.6, 18)
  say(s, 'WhatsApp campaigns for health camps, and support for people who reach out', { x: 0.95, y: 4.95, w: 5.25, h: 0.9, fontSize: 16, color: C.text2, align: 'center' })
  say(s, 'deepindia.org', { x: 0.95, y: 5.9, w: 5.25, h: 0.35, fontSize: 14, bold: true, color: C.accent1, align: 'center' })
  // Consular Helpdesk
  box(s, 6.75, 1.55, 5.95, 4.95, C.background1, 'Consular Helpdesk card', 0.18, { color: 'E1E7F2', width: 1 })
  s.addImage({ path: BRAND + 'customers/consular-helpdesk-logo.png', x: 7.15, y: 1.85, w: 2.0, h: 2.0, objectName: 'Consular Helpdesk logo' })
  say(s, 'Consular Helpdesk', { x: 9.3, y: 2.35, w: 3.2, h: 0.55, fontSize: 22, bold: true, color: '7A1E2C' })
  say(s, 'Passport · OCI · PCC', { x: 9.3, y: 2.9, w: 3.2, h: 0.4, fontSize: 15, color: C.text2 })
  chip(s, 'AI chat support + tickets', 7.1, 4.15, 5.25, '8B1E3F', C.background1, 0.6, 18)
  say(s, 'AI answers questions 24 × 7 and every request becomes a tracked ticket', { x: 7.1, y: 4.95, w: 5.25, h: 0.9, fontSize: 16, color: C.text2, align: 'center' })
  say(s, 'consularhelpdesk.com', { x: 7.1, y: 5.9, w: 5.25, h: 0.35, fontSize: 14, bold: true, color: C.accent1, align: 'center' })
  s.addNotes('DEEP Trust (Disease Eradication through Education and Prevention) uses WAMA CRM for health screening campaigns and support. Consular Helpdesk uses it for AI chat support with tickets for passport, OCI and PCC help.')

  // ── 13. Why us ─────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Trusted by' })
  s.addText('Why WAMA CRM', { placeholder: 'title' })
  const why = [
    [I.badge, C.accent1, 'Official', 'Meta Tech Provider'],
    [I.rupee, C.accent2, '0% markup', 'Pay Meta’s rates directly'],
    [I.india, C.accent3, 'Made for India', 'Languages, UPI, COD'],
    [I.bolt, C.accent4, 'Live in minutes', 'No coding needed'],
  ]
  for (const [i, [img, fill, head, body]] of why.entries()) {
    const x = 0.6 + i * 3.06
    box(s, x, 1.6, 2.86, 4.9, fill, `reason ${i + 1}`)
    await whiteIcon(s, img, x + 0.73, 2.35, 1.4, fill, `reason ${i + 1}`)
    say(s, head, { x: x + 0.15, y: 4.1, w: 2.56, h: 0.6, fontSize: 26, bold: true, color: C.background1, align: 'center' })
    say(s, body, { x: x + 0.25, y: 4.8, w: 2.36, h: 0.9, fontSize: 18, color: C.background1, align: 'center' })
  }
  s.addNotes('Four reasons: official Meta connection, no markup on Meta charges, built for India, and quick to start.')

  // ── 14. Call to action ─────────────────────────────────────────────────────
  pres.addSection({ title: 'Next steps' })
  s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Next steps' })
  s.background = { path: IMG + 'bg-cover.png' }
  s.addImage({ path: BRAND + 'wamacrm-logo-horizontal-light.png', x: 0.7, y: 0.55, w: 3.85, h: 1.1, objectName: 'WAMA CRM logo' })
  s.addText('Let’s grow your business on WhatsApp', { placeholder: 'title' })
  s.addText('14-day free trial · wamacrm.magnetora.in', { placeholder: 'body' })
  const go = [[I.calendar, C.accent2, 'Free demo'], [I.plug, C.accent1, 'Connect WhatsApp'], [I.rocket, C.accent3, 'Go live']]
  go.forEach(([img, fill, label], i) => {
    const y = 1.35 + i * 1.7
    box(s, 8.2, y, 4.5, 1.4, 'FFFFFF', `step ${i + 1}`)
    circleIcon(s, img, 8.5, y + 0.28, 0.85, fill, `step ${i + 1} icon`)
    say(s, `${i + 1}`, { x: 11.9, y: y + 0.3, w: 0.6, h: 0.8, fontSize: 36, bold: true, color: 'C7D2FE', align: 'right', valign: 'middle' })
    say(s, label, { x: 9.6, y: y + 0.3, w: 2.4, h: 0.8, fontSize: 22, bold: true, color: C.text1, valign: 'middle' })
  })
  say(s, 'Thank you · ధన్యవాదాలు · धन्यवाद', { x: 0.7, y: 6.45, w: 7, h: 0.45, fontSize: 20, color: '7CF0A8' })
  s.addNotes('Book the demo date before you leave the meeting. Offer to connect their WhatsApp number together on a call.')

  await pres.writeFile({ fileName: OUT })
  await applyTheme(OUT, THEME)
  console.log('wrote', OUT)
})().catch(error => { console.error(error); process.exit(1) })
