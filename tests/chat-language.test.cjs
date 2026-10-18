require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const { LANGUAGE_RULES, SEARCH_QUERY_LANGUAGE_RULE, editDistance, fuzzyWordMatch, soundKey } = require('../lib/chat-language.ts')
const { rankProducts, scoreProduct } = require('../lib/commerce/shopping-assistant.ts')

test('Chat language: transliteration variants sound the same', () => {
  assert.equal(soundKey('Radhakrishnan'), soundKey('radakrishnan'))
  assert.equal(soundKey('Premchandh'), soundKey('premchand'))
  assert.equal(soundKey('Gitaanjali'), soundKey('gitanjali'))
  assert.equal(soundKey('Vunaya'), 'vunaya')
  assert.equal(editDistance('kitten', 'sitting'), 3)
})

test('Chat language: near spellings match a product word; unrelated words do not', () => {
  assert.equal(fuzzyWordMatch('radakrishnan', 'The Hindu View of Life – S. Radhakrishnan'), 1)
  assert.ok(fuzzyWordMatch('gitanjli', 'Gitanjali – Rabindranath Tagore') > 0.8)
  assert.ok(fuzzyWordMatch('premchnd', 'Godaan – Munshi Premchand (Hindi)') > 0.8)
  assert.equal(fuzzyWordMatch('tagor', 'Gitanjali – Rabindranath Tagore'), 1) // a prefix counts
  assert.equal(fuzzyWordMatch('cricket', 'Gitanjali – Rabindranath Tagore'), 0)
  assert.equal(fuzzyWordMatch('ab', 'Abc'), 0) // too short to judge
})

test('Chat language: a Tenglish search finds the right book, not every book', () => {
  const books = [
    { retailer_id: 'BK-1', title: 'The Hindu View of Life – S. Radhakrishnan', price: 299, currency: 'INR', category: 'Books' },
    { retailer_id: 'BK-2', title: 'Gitanjali – Rabindranath Tagore', price: 199, currency: 'INR', category: 'Books' },
    { retailer_id: 'BK-3', title: 'Godaan – Munshi Premchand', price: 249, currency: 'INR', category: 'Books' },
  ]
  // "me degera radhakrishnan books vunaya" → the assistant searches "radakrishnan books" (spelled loosely)
  assert.deepEqual(rankProducts(books, ['radakrishnan', 'books']).map((book) => book.retailer_id), ['BK-1'])
  assert.deepEqual(rankProducts(books, ['gitanjli']).map((book) => book.retailer_id), ['BK-2'])
  // Just "books": everything that matches
  assert.equal(rankProducts(books, ['books']).length, 3)
  assert.equal(rankProducts(books, ['cricket'], 2).length, 0)
  assert.ok(scoreProduct(books[2], ['premchnd']) > 2)
})

test('Chat language: the instructions cover mixed-language chat and replying in kind', () => {
  assert.match(LANGUAGE_RULES, /me degara radhakrishnan books vunaya/)
  assert.match(LANGUAGE_RULES, /Tenglish in → Tenglish out/)
  assert.match(LANGUAGE_RULES, /Telugu script in → Telugu script out/)
  assert.match(SEARCH_QUERY_LANGUAGE_RULE, /write the query in English/)
})
