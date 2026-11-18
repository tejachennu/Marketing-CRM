require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const I = require('../lib/commerce/product-import.ts')
const PD = require('../lib/commerce/product-describe.ts')
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

test('headings in any order and case; unknown ones listed', () => {
  const { map, ignored } = I.mapHeadings(['Product Name', 'MRP', ' Qty ', 'Colour', 'GST %'])
  assert.deepEqual(map, { title: 0, price: 1, inventory_count: 2, gst_rate: 4 })
  assert.deepEqual(ignored, ['Colour'])
})

test('rows checked: prices with ₹ and commas, made SKUs, stock, GST; errors by row', () => {
  const check = I.checkImport([
    ['Name', 'Price', 'SKU', 'Stock', 'GST %', 'Weight (grams)', 'HSN'],
    ['Cotton saree', '₹1,299', 'SAREE-1', '12', '5%', '600', '5208'],
    ['Steel bottle', 449, '', '', '', '', ''],
    ['Steel bottle', 449, '', '', '', '', ''],
    ['', '', '', '', '', '', ''],
    ['Broken', 'abc', '', '', '', '', ''],
    ['Twice', 10, 'SAREE-1', '', '', '', ''],
    ['Bad GST', 10, '', '', 'lots', '', ''],
  ])
  assert.equal(check.products.length, 3)
  const [saree, bottle, bottle2] = check.products
  assert.deepEqual([saree.price, saree.inventory_count, saree.gst_rate, saree.weight_grams, saree.hsn_code, saree.madeSku], [1299, 12, 5, 600, '5208', false])
  assert.deepEqual(saree.given.sort(), ['gst_rate', 'hsn_code', 'inventory_count', 'price', 'retailer_id', 'title', 'weight_grams'])
  assert.equal(bottle.retailer_id, 'STEEL-BOTTLE')
  assert.equal(bottle2.retailer_id, 'STEEL-BOTTLE-2')
  assert.equal(bottle.madeSku, true)
  assert.equal(bottle.inventory_count, 100) // not tracked
  assert.equal(bottle.category, 'General')
  assert.deepEqual(check.errors.map((e) => e.split(':')[0]), ['Row 6', 'Row 7', 'Row 8'])
  assert.match(I.checkImport([['Item', 'Colour']]).errors[0], /Name and Price/)
  assert.match(I.sampleCsv(), /^Name,Price,SKU,Category,Stock/)
  // The sample sheet read the way the upload screen reads files
  const XLSX = require('xlsx')
  const book = XLSX.read(I.sampleCsv(), { type: 'string' })
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: '' })
  const sample = I.checkImport(rows)
  assert.deepEqual(sample.errors, [])
  assert.equal(sample.products.length, 2)
  assert.equal(sample.products[0].description, 'Soft handloom cotton, 6.3 m with blouse piece.')
})

test('AI description: prompt and answer checks', () => {
  const p = PD.describePrompt({ title: 'Red saree', shop: 'Asha Silks', language: 'Telugu' })
  assert.match(p, /Write in Telugu/)
  assert.match(p, /Do not invent facts/)
  assert.match(PD.describePrompt({ language: 'Klingon' }), /Write in English/)
  assert.deepEqual(PD.readDescribeAnswer('{"title":"Red cotton saree","description":"  Soft   cotton. ","category":"Sarees"}'), { title: 'Red cotton saree', description: 'Soft cotton.', category: 'Sarees' })
  assert.equal(PD.readDescribeAnswer('not json'), null)
  assert.equal(PD.readDescribeAnswer({ title: 'x' }), null)
})

test('wiring: import route checks again; screens; AI charged to the wallet', () => {
  assert.match(read('app/api/commerce/products/import/route.ts'), /checkImport\(/)
  const describe = read('app/api/commerce/products/describe/route.ts')
  assert.match(describe, /aiFetch\(db, ai, 'product_description'/)
  assert.match(describe, /if \(!ai\.allowed\)/)
  const tab = read('components/commerce/products-tab.tsx')
  assert.match(tab, /<ProductImportDialog /)
  assert.match(tab, /Write with AI/)
  assert.doesNotMatch(read('lib/commerce/product-import.ts'), /schema-setup|api-auth-helper/)
})
