require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const R = require('../lib/ai/knowledge-rules.ts')
const S = require('../lib/ai/knowledge-store.ts')
const A = require('../lib/ai/faq-answer.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const ORG = '11111111-1111-4111-8111-111111111111'

test('both searches are ranked together: found by both comes first, the same entry once', () => {
  const meaning = [
    { id: 'a', title: 'Timings', content: 'Open 10 to 9', similarity: 0.62 },
    { id: 'b', title: 'Hair cut price', content: '₹300', similarity: 0.55 },
  ]
  const words = [
    { id: 'b', title: 'Hair cut price', content: '₹300', score: 0.9 },
    { id: 'c', title: 'Parking', content: 'Free parking', score: 0.2 },
  ]
  const hits = R.fuseResults(meaning, words, 5)
  assert.deepEqual(hits.map((h) => h.id), ['b', 'a', 'c'])
  assert.equal(hits[0].similarity, 0.55)
  assert.equal(hits[0].wordScore, 0.9)
  assert.equal(hits[2].similarity, null)
  assert.equal(R.fuseResults(meaning, words, 2).length, 2)
  // No ids: the same title is the same entry
  assert.equal(R.fuseResults([{ title: 'Fees', content: 'x', similarity: 0.5 }], [{ title: ' fees ', content: 'x', score: 0.4 }]).length, 1)
  assert.equal(R.fuseResults([{ title: '', content: 'x' }], []).length, 0)
})

test('how sure the search is', () => {
  assert.equal(R.confidenceOf([]), 'none')
  assert.equal(R.confidenceOf([{ title: 't', content: 'c', score: 1, similarity: 0.7, wordScore: null }]), 'high')
  assert.equal(R.confidenceOf([{ title: 't', content: 'c', score: 1, similarity: 0.5, wordScore: 0.4 }]), 'high')
  assert.equal(R.confidenceOf([{ title: 't', content: 'c', score: 1, similarity: 0.46, wordScore: null }]), 'medium')
  assert.equal(R.confidenceOf([{ title: 't', content: 'c', score: 1, similarity: null, wordScore: 0.35 }]), 'medium')
  assert.equal(R.confidenceOf([{ title: 't', content: 'c', score: 1, similarity: 0.32, wordScore: null }]), 'low')
  assert.match(R.knowledgeText([]), /nothing in the knowledge base/)
  assert.match(R.knowledgeText([{ title: 'Q', content: 'A' }]), /\[1\] Question: Q\nAnswer: A/)
})

test('a customer asking for a person, in English, Tenglish, Hinglish, Telugu and Hindi', () => {
  for (const yes of [
    'I want to talk to a person', 'can I speak with someone from your team', 'connect me to customer care', 'real person please',
    'please call me back', 'are you a bot?', 'raise a ticket', 'manishi tho matladali', 'evaraina tho matladali andi',
    'call cheyandi', 'kisi se baat karni hai', 'call karo please', 'మనిషితో మాట్లాడాలి', 'किसी से बात करनी है',
  ]) assert.equal(R.wantsPerson(yes), true, yes)
  // Words that only mention "agent", "human" or "help" are questions for the AI, not a hand-off
  for (const no of ['need help with my booking', 'do you have human hair extensions?', 'is the travel agent fee included?', 'price entha?', 'agent', '', 'what time do you open']) {
    assert.equal(R.wantsPerson(no), false, no)
  }
})

test('the model answer is read safely: never half a JSON to a customer', () => {
  assert.deepEqual(R.parseAnswer('{"reply":"We open at 10 am.","status":"answered","summary":"Asked timings","urgent":false}'), { reply: 'We open at 10 am.', status: 'answered', summary: 'Asked timings', urgent: false, used: [] })
  // Cut off by the length limit: the words are kept
  const cut = R.parseAnswer('{"reply":"Avunu andi, maa daggara \\"Gold\\" facial undi. Price')
  assert.equal(cut.reply, 'Avunu andi, maa daggara "Gold" facial undi. Price')
  assert.equal(cut.status, 'answered')
  // Broken JSON with no reply: nothing is sent, it counts as not known
  assert.deepEqual(R.parseAnswer('{"status": "ans'), { reply: '', status: 'unknown', summary: '', urgent: false })
  assert.equal(R.parseAnswer('').status, 'unknown')
  // Plain words are fine
  assert.equal(R.parseAnswer('We are open 10 to 9.').reply, 'We are open 10 to 9.')
  // Older answers
  assert.equal(R.parseAnswer('{"reply":"Team will reply","isRiseTicket":true}').status, 'unknown')
  assert.equal(R.parseAnswer('{"reply":"Hi!","isRiseTicket":false}').status, 'answered')
  // JSON with text around it
  assert.equal(R.parseAnswer('Here: {"reply":"Yes","status":"chat"} ok').status, 'chat')
  // WhatsApp formatting
  assert.equal(R.tidyReply('**Price:** ₹300\n## Note'), '*Price:* ₹300\nNote')
})

test('when the chat goes to the team, and what the customer is told', () => {
  const ans = (status, reply = 'x') => ({ reply, status, summary: '', urgent: false })
  assert.deepEqual(R.decideHandoff(ans('answered'), { askedPerson: false }), { handoff: false, reason: null })
  assert.deepEqual(R.decideHandoff(ans('chat'), { askedPerson: false }), { handoff: false, reason: null })
  assert.deepEqual(R.decideHandoff(ans('answered'), { askedPerson: true }), { handoff: true, reason: 'asked_person' })
  assert.deepEqual(R.decideHandoff(ans('person'), { askedPerson: false }), { handoff: true, reason: 'asked_person' })
  assert.deepEqual(R.decideHandoff(ans('complaint'), { askedPerson: false }), { handoff: true, reason: 'complaint' })
  assert.deepEqual(R.decideHandoff(ans('unknown'), { askedPerson: false }), { handoff: true, reason: 'not_answered' })
  assert.deepEqual(R.decideHandoff(ans('answered', ''), { askedPerson: false }), { handoff: true, reason: 'not_answered' })

  const d = R.readHandoffSettings(null)
  assert.deepEqual(d, { pauseAi: true, resumeOnResolve: true, keepAiWhenUnsure: false, message: '' })
  assert.equal(R.pausesAi('not_answered', d), true)
  assert.equal(R.pausesAi('not_answered', { ...d, keepAiWhenUnsure: true }), false)
  assert.equal(R.pausesAi('asked_person', { ...d, keepAiWhenUnsure: true }), true, 'asking for a person always pauses')
  assert.equal(R.pausesAi('complaint', { ...d, pauseAi: false }), false)
  assert.equal(R.readHandoffSettings({ message: '  We   will call you  ' }).message, 'We will call you')
  assert.equal(R.handoffText(ans('unknown', 'Team will reply soon andi'), d), 'Team will reply soon andi')
  assert.equal(R.handoffText(ans('unknown', ''), d), R.DEFAULT_HANDOFF_TEXT)
  assert.equal(R.handoffText(ans('unknown', 'x'), { ...d, message: 'Own words' }), 'Own words')
  assert.equal(R.ticketSubject(''), 'Support request')
  assert.equal(R.ticketSubject('a'.repeat(150)).length, 100)
  assert.equal(R.readReason('complaint'), 'complaint')
  assert.equal(R.readReason('drop table'), null)
})

test('the same unanswered question in other words is counted once; search words in any script', () => {
  assert.equal(R.gapKey('Do you have parking?'), R.gapKey('parking  do you have'))
  assert.equal(R.gapKey('మీ దగ్గర పార్కింగ్ ఉందా?'), 'ఉందా దగ్గర పార్కింగ్ మీ')
  assert.equal(R.isRealQuestion('ok'), false)
  assert.equal(R.isRealQuestion('Do you deliver to Vizag?'), true)
  assert.equal(R.searchWords('What is the price of a hair cut?'), 'price or hair or cut')
  assert.equal(R.searchWords('హెయిర్ కట్ ధర ఎంత?'), 'హెయిర్ or కట్ or ధర or ఎంత')
  assert.equal(R.searchWords('a an the'), '')
  assert.ok(R.searchWords(Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')).split(' or ').length <= 12)
})

test('the migration file is the SQL the app runs, and the search never needs an approximate index', () => {
  assert.equal(read('supabase/migrations/20261206_ai_knowledge_handoff.sql'), S.KNOWLEDGE_SQL)
  assert.equal(S.KNOWLEDGE_LOCK, 724519032)
  assert.match(S.KNOWLEDGE_SQL, /FUNCTION search_knowledge\(/)
  assert.match(S.KNOWLEDGE_SQL, /FUNCTION search_knowledge_words\(/)
  assert.match(S.KNOWLEDGE_SQL, /REVOKE ALL ON FUNCTION search_knowledge/)
  assert.doesNotMatch(S.KNOWLEDGE_SQL, /USING (hnsw|ivfflat)/i, 'an approximate index can miss a small business\'s answers')
  assert.equal(S.isMissingKnowledgeSchema({ code: 'PGRST202' }), true)
  assert.equal(S.isMissingKnowledgeSchema({ code: '23505', message: 'duplicate' }), false)
})

test('hand-off: one ticket per chat, AI paused, back on when resolved', async () => {
  const db = salonDb({
    organizations: [{ id: ORG, ai_handoff: null }],
    conversations: [{ id: 'c1', organization_id: ORG, auto_reply_enabled: true }],
    contacts: [{ id: 'p1', organization_id: ORG }],
    tickets: [],
  })
  const settings = R.readHandoffSettings(null)
  const input = { organizationId: ORG, conversationId: 'c1', contactId: 'p1', message: 'Where is my order? It is 5 days late', reason: 'complaint', summary: 'Order late', urgent: true, channel: 'whatsapp', settings }
  const first = await S.handOffToTeam(db, input)
  assert.equal(first.created, true)
  assert.equal(first.paused, true)
  const second = await S.handOffToTeam(db, input)
  assert.equal(second.created, false)
  assert.equal(second.ticketId, first.ticketId)
  const tickets = db.tables.tickets
  assert.equal(tickets.length, 1)
  assert.equal(tickets[0].reason, 'complaint')
  assert.equal(tickets[0].priority, 'urgent')
  assert.equal(tickets[0].ai_paused, true)
  assert.equal(db.tables.conversations[0].auto_reply_enabled, false)

  await S.markTeamReplied(db, 'c1')
  assert.ok(tickets[0].first_reply_at)

  tickets[0].status = 'resolved'
  assert.equal(await S.afterTicketResolved(db, tickets[0]), true)
  assert.equal(db.tables.conversations[0].auto_reply_enabled, true)
  // Not paused by the hand-off: stays as it is
  assert.equal(await S.afterTicketResolved(db, { ...tickets[0], ai_paused: false }), false)
})

test('the AI not knowing keeps the AI on when the business wants that', async () => {
  const db = salonDb({ conversations: [{ id: 'c2', organization_id: ORG, auto_reply_enabled: true }], tickets: [] })
  const settings = { ...R.readHandoffSettings(null), keepAiWhenUnsure: true }
  const out = await S.handOffToTeam(db, { organizationId: ORG, conversationId: 'c2', contactId: 'p1', message: 'Do you deliver to Vizag?', reason: 'not_answered', settings })
  assert.equal(out.paused, false)
  assert.equal(db.tables.conversations[0].auto_reply_enabled, true)
  assert.equal(db.tables.tickets[0].ai_paused, false)
})

test('questions the AI could not answer are counted once per question', async () => {
  const db = salonDb({ knowledge_gaps: [] })
  await S.recordKnowledgeGap(db, ORG, 'Do you have parking?', 'c1')
  await S.recordKnowledgeGap(db, ORG, 'parking do you have', 'c2')
  await S.recordKnowledgeGap(db, ORG, 'ok', 'c3')
  assert.equal(db.tables.knowledge_gaps.length, 1)
  assert.equal(db.tables.knowledge_gaps[0].asked_count, 2)
  assert.equal(db.tables.knowledge_gaps[0].last_conversation_id, 'c2')
  const list = await S.listKnowledgeGaps(db, ORG)
  assert.equal(list.length, 1)
  assert.equal(await S.setKnowledgeGapStatus(db, ORG, list[0].id, 'answered'), true)
  assert.equal((await S.listKnowledgeGaps(db, ORG)).length, 0)
})

test('the answer prompt: facts only, no guessing, the business\'s own words first', () => {
  const p = A.answerPrompt({ name: 'Glow Salon', contact_phone: '+91 90000 00000', chatbot_base_prompt: 'Never promise a time.' }, [{ title: 'Hair cut price', content: '₹300' }], { askedPerson: true })
  assert.match(p, /Glow Salon/)
  assert.match(p, /Never promise a time\./)
  assert.match(p, /\+91 90000 00000/)
  assert.match(p, /Hair cut price/)
  assert.match(p, /do not guess: status "unknown"/)
  assert.match(p, /has asked for a person/)
  assert.match(A.businessFacts({}), /none given/)
  assert.match(A.answerPrompt({}, [], { channel: 'instagram' }), /Instagram assistant/)
})

test('every place that answers uses the shared search and answer', () => {
  const hook = read('app/api/webhooks/facebook/[orgIdAndSlug]/route.ts')
  assert.match(hook, /answerFromKnowledge\(/)
  assert.match(hook, /handOffToTeam\(/)
  assert.doesNotMatch(hook, /lowerIncoming\.includes\('agent'\)/, 'the word "agent" alone no longer makes a ticket')
  assert.match(hook, /openAiKey &&\n\s+!previousMessage/, 'a redelivered message is not answered twice')
  assert.match(read('lib/instagram/ai.ts'), /answerFromKnowledge\(/)
  assert.match(read('lib/instagram/automation.ts'), /handOffToTeam\(/)
  assert.match(read('app/api/ai/playground-chat/route.ts'), /answerFromKnowledge\(/)
  assert.match(read('app/api/ai/copilot/route.ts'), /searchKnowledge\(/)
  assert.match(read('app/api/webhooks/twilio/[orgIdAndSlug]/route.ts'), /searchKnowledge\(supabase, null, orgId, \{ question: messageBody, synonyms, embedding/)
  assert.match(read('app/api/tickets/route.ts'), /afterTicketResolved\(/)
  assert.match(read('app/api/messages/send/route.ts'), /markTeamReplied\(/)
})
