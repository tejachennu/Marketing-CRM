require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const S = require('../lib/commerce/storefront.ts')
const Art = require('../lib/commerce/store-art.ts')

const APP = 'https://wamacrm.magnetora.in'
const products = [
  { title: 'Soap', category: 'Bath', image_url: 'https://cdn.example.com/soap.jpg' },
  { title: 'Shampoo', category: 'Bath', image_url: '' },
  { title: 'Cream', category: 'Skin', image_url: 'http://insecure.example.com/x.jpg' },
  { title: 'Bag', category: '', image_url: '' },
]

test('a new store page is filled from the business details and products', () => {
  const s = S.suggestStorefront({
    appUrl: APP,
    organization: { name: 'Magnetora', currency: 'INR', contact_phone: '+91 83676 29608', contact_address: 'Hyderabad', whatsapp_default_phone: '918367629608', commerce_default_shipping_fee: 50, commerce_free_shipping_threshold: 999 },
    salon: null,
    products,
  })
  assert.equal(s.enabled, false, 'never switched on by itself')
  assert.equal(s.title, 'Magnetora')
  assert.equal(s.whatsapp, '+918367629608')
  assert.equal(s.phone, '+918367629608')
  assert.equal(s.address, 'Hyderabad')
  assert.equal(s.delivery_fee, 50)
  assert.equal(s.free_delivery_from, 999)
  assert.match(s.announcement, /Free delivery on orders above ₹999/)
  assert.equal(s.payment, 'later')
  assert.ok(s.logo.startsWith(`${APP}/api/public/store-art?kind=logo`))
  // Welcome banner, one per top category, then free delivery
  assert.equal(s.banners[0].title, 'Welcome to Magnetora')
  assert.deepEqual(s.banners.slice(1, 3).map((b) => b.category), ['Bath', 'Skin'])
  assert.equal(s.banners.at(-1).title, 'Free delivery')
  assert.ok(s.banners.every((b) => b.image.startsWith('https://')))
  // Categories by count; a real https photo is kept, otherwise a made tile
  assert.deepEqual(s.categories.map((c) => c.name), ['Bath', 'Other', 'Skin'])
  assert.equal(s.categories[0].image, 'https://cdn.example.com/soap.jpg')
  assert.ok(s.categories[2].image.includes('kind=tile'))
})

test('Front Desk details and logo are used when there are no workspace contact details', () => {
  const s = S.suggestStorefront({ appUrl: APP, organization: { name: 'Org' }, salon: { business_name: 'Glow Salon', phone: '9876543210', address: 'Road 1', logo_url: 'https://cdn.example.com/logo.png' }, products: [] })
  assert.equal(s.title, 'Glow Salon')
  assert.equal(s.logo, 'https://cdn.example.com/logo.png')
  assert.equal(s.address, 'Road 1')
  assert.equal(s.banners.length, 1)
  assert.equal(s.announcement, '')
})

test('filling keeps what the business typed and fills only the blanks', () => {
  const suggested = S.suggestStorefront({ appUrl: APP, organization: { name: 'Magnetora', contact_address: 'Hyderabad' }, products })
  const current = S.readStorefront({ title: 'My Shop', categories: [{ name: 'Skin', image: '' }], banners: [] })
  const out = S.fillStorefront(current, suggested)
  assert.equal(out.title, 'My Shop')
  assert.equal(out.address, 'Hyderabad')
  assert.equal(out.categories[0].name, 'Skin')
  assert.ok(out.categories[0].image.includes('kind=tile'))
  assert.equal(out.categories.length, 3)
  assert.equal(out.banners.length, suggested.banners.length)
  // The result survives the save's clean-up
  assert.deepEqual(S.readStorefront(out), out)
})

test('made pictures are plain SVG with the business colour and safe text', () => {
  const banner = Art.bannerSvg({ colour: '0E1B3D', design: 1, name: 'Magnetora AI' })
  assert.match(banner, /^<svg /)
  assert.match(banner, /#0E1B3D/)
  assert.doesNotMatch(banner, /Gradient/i)
  const logo = Art.logoSvg({ colour: 'nope', name: '<script>x</script> Shop' })
  assert.doesNotMatch(logo, /<script>/)
  assert.match(logo, /#1D5BEA/)
  assert.equal(Art.initials('Magnetora AI'), 'MA')
  assert.equal(Art.initials('csat37'), 'C')
  for (let n = 0; n < 4; n++) assert.match(Art.bannerSvg({ design: n, name: 'X' }), /<\/svg>$/)
  assert.equal(Art.storeArt(new URLSearchParams('kind=other')), null)
  assert.match(Art.storeArt(new URLSearchParams('kind=tile&name=Bath&c=008069')), /#008069/)
})
