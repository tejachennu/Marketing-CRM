require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SERVICE_WINDOW_MS,
  formatBadgeCount,
  formatWindowRemaining,
  getAvatarTone,
  getDisplayUrl,
  getDownloadName,
  getMediaType,
  getMessagePosition,
  getMessagePreview,
  getMessageText,
  getServiceWindow,
  parseReplyMarker,
  parseRichText,
  withReplyMarker,
} = require('../lib/chat-message-format.ts')

// ── Replies ─────────────────────────────────────────────────────────────────

test('Chat format: reply markers are split from the text and round-trip', () => {
  assert.deepEqual(parseReplyMarker('[reply:abc-123]Sure, at 5pm'), { replyToId: 'abc-123', text: 'Sure, at 5pm' })
  assert.deepEqual(parseReplyMarker('[reply:abc]line one\nline two'), { replyToId: 'abc', text: 'line one\nline two' })
  assert.deepEqual(parseReplyMarker('[reply:abc]'), { replyToId: 'abc', text: '' })
  assert.deepEqual(parseReplyMarker('plain'), { replyToId: null, text: 'plain' })
  assert.deepEqual(parseReplyMarker('see [reply:abc] later'), { replyToId: null, text: 'see [reply:abc] later' })
  assert.deepEqual(parseReplyMarker(null), { replyToId: null, text: '' })
  assert.equal(withReplyMarker('abc', 'hi'), '[reply:abc]hi')
  assert.equal(withReplyMarker(null, 'hi'), 'hi')
  assert.deepEqual(parseReplyMarker(withReplyMarker('id-1', 'ok')), { replyToId: 'id-1', text: 'ok' })
})

// ── Media ───────────────────────────────────────────────────────────────────

test('Chat format: media kind comes from the data URL, hint, query or extension', () => {
  assert.equal(getMediaType(null), null)
  assert.equal(getMediaType(''), null)
  assert.equal(getMediaType('data:image/png;base64,AAAA'), 'image')
  assert.equal(getMediaType('data:application/pdf;base64,AAAA'), 'document')
  assert.equal(getMediaType('https://api.twilio.com/2010/Media/ME1#media.jpg'), 'image')
  assert.equal(getMediaType('https://cdn.example.com/file?mime=video/mp4'), 'video')
  assert.equal(getMediaType('https://cdn.example.com/file?ext=mp3'), 'audio')
  assert.equal(getMediaType('https://cdn.example.com/a/b/photo.JPEG?size=2'), 'image')
  assert.equal(getMediaType('https://cdn.example.com/invoice.pdf'), 'document')
  assert.equal(getMediaType('https://cdn.example.com/no-extension'), 'document')
})

test('Chat format: a WhatsApp voice note (.ogg) is audio, not video', () => {
  assert.equal(getMediaType('https://cdn.example.com/voice.ogg'), 'audio')
  assert.equal(getMediaType('https://api.twilio.com/Media/ME2#media.ogg'), 'audio')
  assert.equal(getMediaType('https://cdn.example.com/clip.opus'), 'audio')
  assert.equal(getMediaType('https://cdn.example.com/clip.mp4'), 'video')
})

test('Chat format: Twilio media goes through the proxy, everything else is used as is', () => {
  assert.equal(getDisplayUrl('https://api.twilio.com/2010/Media/ME1'), '/api/media/proxy?url=https%3A%2F%2Fapi.twilio.com%2F2010%2FMedia%2FME1')
  assert.equal(getDisplayUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png')
  assert.equal(getDisplayUrl(null), '')
})

test('Chat format: download names', () => {
  assert.equal(getDownloadName('https://cdn.example.com/files/Price%20List.pdf?x=1'), 'Price List.pdf')
  assert.equal(getDownloadName('https://api.twilio.com/Media/ME1#media.jpg'), 'attachment.jpg')
  assert.equal(getDownloadName('data:image/png;base64,AAAA'), 'attachment.png')
  assert.equal(getDownloadName(null), 'attachment')
  // A name that is not valid percent-encoding is returned as it is
  assert.equal(getDownloadName('https://cdn.example.com/100%.pdf'), '100%.pdf')
})

test('Chat format: list previews hide markers and describe attachments', () => {
  assert.equal(getMessagePreview({ body: '[reply:abc]On my way', media_url: null }), 'On my way')
  assert.equal(getMessagePreview({ body: 'line one\n\nline   two', media_url: null }), 'line one line two')
  assert.equal(getMessagePreview({ body: '[Media Attachment]', media_url: 'https://x.example/a.jpg' }), '📷 Photo')
  assert.equal(getMessagePreview({ body: '', media_url: 'https://x.example/a.ogg' }), '🎵 Audio')
  assert.equal(getMessagePreview({ body: null, media_url: 'https://x.example/a.pdf' }), '📄 Document')
  assert.equal(getMessagePreview({ body: 'Here it is', media_url: 'https://x.example/a.mp4' }), 'Here it is')
  assert.equal(getMessagePreview(null), '')
  // Without an attachment the placeholder is real text and stays
  assert.equal(getMessageText({ body: '[Media Attachment]', media_url: null }), '[Media Attachment]')
  assert.equal(getMessageText({ body: '[Media Attachment]', media_url: 'https://x.example/a.jpg' }), '')
})

// ── Formatting ──────────────────────────────────────────────────────────────

const plain = (tokens) => tokens.map((t) => t.text).join('')

test('Chat format: WhatsApp bold, italic, strike and code', () => {
  assert.deepEqual(parseRichText('Your order is *confirmed*.'), [
    { text: 'Your order is ' },
    { text: 'confirmed', bold: true },
    { text: '.' },
  ])
  assert.deepEqual(parseRichText('_note_ ~old~ `SAVE10`'), [
    { text: 'note', italic: true },
    { text: ' ' },
    { text: 'old', strike: true },
    { text: ' ' },
    { text: 'SAVE10', code: true },
  ])
  assert.deepEqual(parseRichText('*two words*'), [{ text: 'two words', bold: true }])
})

test('Chat format: marks that are not formatting are left exactly as typed', () => {
  for (const text of ['2 * 3 * 4 = 24', 'snake_case_name', 'file_name.txt', 'a*b*c', '* not bold *', 'price ~ 500', '5*', '**', 'email me_at_home']) {
    const tokens = parseRichText(text)
    assert.equal(plain(tokens), text, text)
    assert.equal(tokens.some((t) => t.bold || t.italic || t.strike || t.code), false, text)
  }
  assert.deepEqual(parseRichText(''), [])
  assert.deepEqual(parseRichText(null), [])
})

test('Chat format: links are found, and sentence punctuation is not part of them', () => {
  assert.deepEqual(parseRichText('Pay here: https://pay.example.com/i/42. Thanks!'), [
    { text: 'Pay here: ' },
    { text: 'https://pay.example.com/i/42', href: 'https://pay.example.com/i/42' },
    { text: '. Thanks!' },
  ])
  assert.deepEqual(parseRichText('(see www.example.com)'), [
    { text: '(see ' },
    { text: 'www.example.com', href: 'https://www.example.com' },
    { text: ')' },
  ])
  assert.deepEqual(parseRichText('https://en.wikipedia.org/wiki/Mumbai_(disambiguation)'), [
    { text: 'https://en.wikipedia.org/wiki/Mumbai_(disambiguation)', href: 'https://en.wikipedia.org/wiki/Mumbai_(disambiguation)' },
  ])
  // An underscore inside a link is part of the address, not italics
  const tokens = parseRichText('Track at https://t.example.com/order_id_9 now')
  assert.equal(tokens.some((t) => t.italic), false)
  assert.equal(tokens.find((t) => t.href).href, 'https://t.example.com/order_id_9')
})

test('Chat format: only http(s) addresses ever become links', () => {
  for (const text of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'mailto:a@b.co', 'ftp://example.com/x']) {
    assert.equal(parseRichText(text).some((t) => t.href), false, text)
  }
  for (const token of parseRichText('a https://x.example b www.y.example c *https://z.example*')) {
    if (token.href) assert.match(token.href, /^https?:\/\//)
  }
  // The text is never changed, only split
  const text = 'Hi *Asha*, pay at https://p.example/1?a=1&b=2 or call _now_ <script>alert(1)</script>'
  const tokens = parseRichText(text)
  assert.equal(plain(tokens), 'Hi Asha, pay at https://p.example/1?a=1&b=2 or call now <script>alert(1)</script>')
})

// ── Grouping ────────────────────────────────────────────────────────────────

const at = (hour, minute, sender, day = 12) => ({ id: `${day}-${hour}-${minute}`, sender_type: sender, created_at: new Date(2026, 9, day, hour, minute).toISOString() })

test('Chat format: bubbles group by sender, time gap and day', () => {
  const messages = [
    at(9, 0, 'contact'),
    at(9, 1, 'contact'),      // same sender, a minute later: same group
    at(9, 2, 'user'),         // sender changes
    at(9, 20, 'user'),        // more than five minutes later
    at(9, 21, 'user', 13),    // next day
  ]
  assert.deepEqual(getMessagePosition(messages, 0), { startsDay: true, startsGroup: true })
  assert.deepEqual(getMessagePosition(messages, 1), { startsDay: false, startsGroup: false })
  assert.deepEqual(getMessagePosition(messages, 2), { startsDay: false, startsGroup: true })
  assert.deepEqual(getMessagePosition(messages, 3), { startsDay: false, startsGroup: true })
  assert.deepEqual(getMessagePosition(messages, 4), { startsDay: true, startsGroup: true })
})

// ── 24-hour window ──────────────────────────────────────────────────────────

const NOW = new Date(2026, 9, 13, 12, 0).getTime()
const ago = (hours, sender) => ({ id: `m${hours}${sender}`, sender_type: sender, created_at: new Date(NOW - hours * 3600000).toISOString() })

test('Service window: open for 24 hours after the customer last wrote', () => {
  const open = getServiceWindow([ago(30, 'contact'), ago(2, 'contact'), ago(1, 'user')], NOW)
  assert.equal(open.state, 'open')
  assert.equal(open.remainingMs, 22 * 3600000)
  assert.equal(open.closingSoon, false)

  const closing = getServiceWindow([ago(21, 'contact')], NOW)
  assert.deepEqual(closing, { state: 'open', remainingMs: 3 * 3600000, closingSoon: true })
})

test('Service window: our own messages never reopen it', () => {
  assert.deepEqual(getServiceWindow([ago(30, 'contact'), ago(1, 'user'), ago(0.5, 'user')], NOW), { state: 'expired' })
  assert.deepEqual(getServiceWindow([ago(24, 'contact')], NOW), { state: 'expired' })
  assert.equal(SERVICE_WINDOW_MS, 86400000)
})

test('Service window: a customer who never wrote has no window', () => {
  assert.deepEqual(getServiceWindow([], NOW), { state: 'none' })
  assert.deepEqual(getServiceWindow([ago(1, 'user')], NOW), { state: 'none' })
})

test('Service window: time left reads naturally', () => {
  assert.equal(formatWindowRemaining(22 * 3600000 + 5 * 60000), '22h 5m')
  assert.equal(formatWindowRemaining(45 * 60000 + 59000), '45m')
  assert.equal(formatWindowRemaining(0), '0m')
  assert.equal(formatWindowRemaining(-5000), '0m')
})

// ── Small helpers ───────────────────────────────────────────────────────────

test('Chat format: badge counts are capped and avatar colours are stable', () => {
  assert.equal(formatBadgeCount(0), '0')
  assert.equal(formatBadgeCount(99), '99')
  assert.equal(formatBadgeCount(100), '99+')
  assert.equal(formatBadgeCount(1000, 999), '999+')
  assert.equal(getAvatarTone('contact-1'), getAvatarTone('contact-1'))
  assert.equal(typeof getAvatarTone(null), 'string')
  const tones = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(getAvatarTone))
  assert.ok(tones.size > 3)
})
