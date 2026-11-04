// How every composer reads an answer of POST /api/messages/send (components/send-message-dialog.tsx):
// the 24-hour refusal opens the template picker and says which way, a teammate's claim and a
// mismatched number are shown in the server's words, and the inbox row changes the way the route
// changes the chat once a reply is away. The component file is loaded with its UI parts stubbed;
// nothing here renders or reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const ts = require('typescript')

const PROJECT = path.join(__dirname, '..')
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }

// The shared loader knows .ts only; a component file has JSX to compile as well
require.extensions['.tsx'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } })
  module._compile(output.outputText, filename)
}
const Nothing = () => null
stub(path.join(PROJECT, 'components/ui/button.tsx'), { Button: Nothing })
stub(path.join(PROJECT, 'components/ui/dialog.tsx'), { Dialog: Nothing, DialogContent: Nothing, DialogHeader: Nothing, DialogTitle: Nothing, DialogTrigger: Nothing })

const { SendMessageDialog, readSendFailure, conversationAfterReply } = require(path.join(PROJECT, 'components/send-message-dialog.tsx'))

const WINDOW_CLOSED = 'This customer last wrote more than 24 hours ago, so WhatsApp only allows an approved template message.'
const NEVER_WROTE = 'This customer has not written to you yet. Start the conversation with an approved template message.'

test('Send failure: the 24-hour refusal says which way to a template, in the server\'s words', () => {
  assert.deepEqual(readSendFailure({ error: WINDOW_CLOSED, code: 'outside_24h_window', reason: 'window_closed' }, 'fallback'), { message: WINDOW_CLOSED, templateReason: 'window_closed' })
  assert.deepEqual(readSendFailure({ error: NEVER_WROTE, code: 'outside_24h_window', reason: 'never_wrote' }, 'fallback'), { message: NEVER_WROTE, templateReason: 'never_wrote' })
  // A reason the screen does not know is the plain closed window, never a bare error
  assert.deepEqual(readSendFailure({ error: WINDOW_CLOSED, code: 'outside_24h_window', reason: 'later' }, 'fallback'), { message: WINDOW_CLOSED, templateReason: 'window_closed' })
  assert.deepEqual(readSendFailure({ error: WINDOW_CLOSED, code: 'outside_24h_window' }, 'fallback'), { message: WINDOW_CLOSED, templateReason: 'window_closed' })
  // The code alone, without words, still opens the picker
  assert.deepEqual(readSendFailure({ code: 'outside_24h_window', reason: 'never_wrote' }, 'Failed to send'), { message: 'Failed to send', templateReason: 'never_wrote' })
})

test('Send failure: a teammate\'s claim and a mismatched number are shown verbatim, with no template offer', () => {
  assert.deepEqual(readSendFailure({ error: 'This customer is being handled by Priya Nair', code: 'handled_by_teammate' }, 'fallback'), { message: 'This customer is being handled by Priya Nair' })
  assert.deepEqual(readSendFailure({ error: 'The number does not match this contact' }, 'fallback'), { message: 'The number does not match this contact' })
  // The provider refused after the fact: the stored message comes along, the words stay the server's
  assert.deepEqual(readSendFailure({ success: false, error: 'Meta error 131047: re-engagement message', message: { id: 'm1' }, twilioSent: false }, 'fallback'), { message: 'Meta error 131047: re-engagement message' })
  // Another code is not this screen's business
  assert.deepEqual(readSendFailure({ error: 'Something else', code: 'rate_limited' }, 'fallback'), { message: 'Something else' })
})

test('Send failure: an answer without words falls back to the composer\'s own', () => {
  assert.deepEqual(readSendFailure({}, 'Failed to dispatch message'), { message: 'Failed to dispatch message' })
  assert.deepEqual(readSendFailure({ error: '   ' }, 'Failed to dispatch message'), { message: 'Failed to dispatch message' })
  assert.deepEqual(readSendFailure({ error: 42 }, 'Failed to dispatch message'), { message: 'Failed to dispatch message' })
  assert.deepEqual(readSendFailure(null, 'Failed to dispatch message'), { message: 'Failed to dispatch message' })
  assert.deepEqual(readSendFailure(undefined, 'Failed to dispatch message'), { message: 'Failed to dispatch message' })
  assert.deepEqual(readSendFailure('<html>Bad gateway</html>', 'Failed to dispatch message'), { message: 'Failed to dispatch message' })
})

test('After a reply: an agent limited to their own work takes the chat nobody owned, and the chatbot goes quiet', () => {
  const handedOff = { id: 'c1', assigned_to: null, auto_reply_enabled: false, unread_count: 2, contact: { id: 'k1', first_name: 'Asha' } }
  assert.deepEqual(conversationAfterReply(handedOff, { id: 'agent-1', seesAll: false }), { ...handedOff, assigned_to: 'agent-1', auto_reply_enabled: false })
  assert.equal(handedOff.assigned_to, null, 'the row given is left as it was')
  // The chatbot was still answering: it stops, and the chat is the agent's
  assert.deepEqual(conversationAfterReply({ id: 'c2', assigned_to: null, auto_reply_enabled: true }, { id: 'agent-1', seesAll: false }), { id: 'c2', assigned_to: 'agent-1', auto_reply_enabled: false })
  assert.deepEqual(conversationAfterReply({ id: 'c3', assigned_to: null }, { id: 'agent-1', seesAll: false }), { id: 'c3', assigned_to: 'agent-1', auto_reply_enabled: false })
})

test('After a reply: a manager leaves the chat unowned, and nobody takes a teammate\'s chat', () => {
  assert.deepEqual(conversationAfterReply({ id: 'c1', assigned_to: null, auto_reply_enabled: true }, { id: 'manager-1', seesAll: true }), { id: 'c1', assigned_to: null, auto_reply_enabled: false })
  assert.deepEqual(conversationAfterReply({ id: 'c1', assigned_to: 'teammate-9', auto_reply_enabled: true }, { id: 'agent-1', seesAll: false }), { id: 'c1', assigned_to: 'teammate-9', auto_reply_enabled: false })
  assert.deepEqual(conversationAfterReply({ id: 'c1', assigned_to: 'agent-1', auto_reply_enabled: true }, { id: 'agent-1', seesAll: false }), { id: 'c1', assigned_to: 'agent-1', auto_reply_enabled: false })
})

test('The dialog itself still loads next to its helpers', () => {
  assert.equal(typeof SendMessageDialog, 'function')
})
