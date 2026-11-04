// Media downloads connect only to an address that was checked at connect time: a name that answers
// "public" to the early check and "private" when the socket resolves it (DNS rebinding) is refused
// before any byte is sent. The resolver is faked and the only server is a local one on 127.0.0.1;
// nothing here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const dns = require('node:dns')
const net = require('node:net')

const { lookupPublicAddress, downloadPublicHttpUrl } = require('../lib/utils.ts')

// The early check (dns.promises.lookup) and the socket's lookup (dns.lookup) are faked apart, so a
// name can answer differently to each, as a rebinding name with a zero TTL does
const early = { 'rebind.example.com': ['93.184.216.34'], 'cdn.example.com': ['93.184.216.34'] }
const atConnect = {
  'rebind.example.com': ['127.0.0.1'],
  'cdn.example.com': ['93.184.216.34'],
  'mixed.example.com': ['93.184.216.34', '10.0.0.8'],
  'v6.example.com': ['2606:4700::1111'],
  'meta.example.com': ['169.254.169.254'],
}
const entries = (list) => list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
const connectLookups = []
const original = { lookup: dns.lookup, promisesLookup: dns.promises.lookup }
dns.promises.lookup = async (host, options) => {
  const list = early[host]
  if (!list) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
  return options?.all ? entries(list) : entries(list)[0]
}
dns.lookup = (host, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {} }
  // The local server binds to an IP literal through the real resolver
  if (net.isIP(host)) return original.lookup(host, options, callback)
  connectLookups.push({ host, options })
  const list = atConnect[host]
  setImmediate(() => {
    if (!list) return callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' }))
    if (options?.all) return callback(null, entries(list))
    callback(null, entries(list)[0].address, entries(list)[0].family)
  })
}

// A local server: what it was asked for, and how it answers each path
const served = []
let handlers = {}
const server = http.createServer((req, res) => {
  served.push({ url: req.url, host: req.headers.host, userAgent: req.headers['user-agent'], accept: req.headers.accept, acceptEncoding: req.headers['accept-encoding'] })
  const handler = handlers[req.url]
  if (!handler) { res.writeHead(404); return res.end() }
  handler(req, res)
})
let base = ''
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
test.after(async () => {
  dns.lookup = original.lookup
  dns.promises.lookup = original.promisesLookup
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})
function reset() {
  served.length = 0
  connectLookups.length = 0
  handlers = {}
}
const limits = { maxBytes: 1024, maxRedirects: 3, timeoutMs: 2000 }
const lookup = (host, options) => new Promise((resolve) => lookupPublicAddress(host, options, (error, address, family) => resolve({ error, address, family })))

test('Media pinning: the connect-time lookup passes public answers on and refuses any private one', async () => {
  reset()
  let answer = await lookup('cdn.example.com', {})
  assert.equal(answer.error, null)
  assert.equal(answer.address, '93.184.216.34')
  assert.equal(answer.family, 4)
  // The form sockets use when they try several addresses
  answer = await lookup('v6.example.com', { all: true })
  assert.deepEqual(answer.address, [{ address: '2606:4700::1111', family: 6 }])
  assert.equal(connectLookups.every((call) => call.options.all === true), true, 'every answer is looked at')

  for (const host of ['rebind.example.com', 'mixed.example.com', 'meta.example.com']) {
    answer = await lookup(host, { all: true })
    assert.match(answer.error.message, /private network address/, host)
    assert.equal(answer.error.code, 'EPRIVATEADDRESS')
  }
  answer = await lookup('nowhere.example.com', {})
  assert.equal(answer.error.code, 'ENOTFOUND')
})

test('Media pinning: a name that turns private between the check and the connection is never reached', async () => {
  reset()
  handlers['/a.png'] = (req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end('secret') }
  const port = server.address().port
  await assert.rejects(() => downloadPublicHttpUrl(`http://rebind.example.com:${port}/a.png`, limits), /private network address/)
  // The socket's own lookup was the one that refused, and the local server heard nothing
  assert.deepEqual(connectLookups.map((call) => call.host), ['rebind.example.com'])
  assert.equal(served.length, 0)
})

test("Media pinning: this app's own address is trusted, a redirect from it is not", async () => {
  reset()
  handlers['/ok.png'] = (req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.alloc(100, 7)) }
  const download = await downloadPublicHttpUrl(`${base}/ok.png`, { ...limits, trustFirstHop: true })
  assert.equal(download.buffer.length, 100)
  assert.equal(download.contentType, 'image/png')
  assert.equal(served[0].host, base.slice('http://'.length), 'the Host header is the address asked for')
  // Some media hosts refuse a request without a User-Agent; no compression is asked for
  assert.equal(served[0].userAgent, 'WAMA-CRM media fetch')
  assert.equal(served[0].accept, '*/*')
  assert.equal(served[0].acceptEncoding, undefined)
  assert.equal(connectLookups.length, 0)

  // Without the trust, the same address is refused before anything is sent
  reset()
  await assert.rejects(() => downloadPublicHttpUrl(`${base}/ok.png`, limits), /Only a public http\(s\) address/)
  assert.equal(served.length, 0)

  // Redirects from it are checked: by address, and by name at connect time
  const port = server.address().port
  for (const [target, refusal] of [[`${base}/ok.png`, /Only a public http\(s\) address/], [`http://rebind.example.com:${port}/ok.png`, /private network address/]]) {
    reset()
    handlers['/hop'] = (req, res) => { res.writeHead(302, { location: target }); res.end() }
    await assert.rejects(() => downloadPublicHttpUrl(`${base}/hop`, { ...limits, trustFirstHop: true }), refusal)
    assert.deepEqual(served.map((request) => request.url), ['/hop'], target)
  }
})

test('Media pinning: the size cap, the answer status and the time limit still hold', async () => {
  const trusted = { ...limits, trustFirstHop: true }
  reset()
  handlers['/announced'] = (req, res) => { res.writeHead(200, { 'content-length': '2048' }); res.end(Buffer.alloc(2048)) }
  await assert.rejects(() => downloadPublicHttpUrl(`${base}/announced`, trusted), /larger than/)
  handlers['/streamed'] = (req, res) => { res.writeHead(200); res.write(Buffer.alloc(600)); res.end(Buffer.alloc(600)) }
  await assert.rejects(() => downloadPublicHttpUrl(`${base}/streamed`, trusted), /larger than/)
  handlers['/exact'] = (req, res) => { res.writeHead(200); res.end(Buffer.alloc(1024)) }
  assert.equal((await downloadPublicHttpUrl(`${base}/exact`, trusted)).buffer.length, 1024)

  await assert.rejects(() => downloadPublicHttpUrl(`${base}/missing`, trusted), /Failed to download: 404/)

  // A server that never answers, and one that stops halfway through the body
  handlers['/silent'] = () => {}
  await assert.rejects(() => downloadPublicHttpUrl(`${base}/silent`, { ...trusted, timeoutMs: 200 }))
  handlers['/trickle'] = (req, res) => { res.writeHead(200, { 'content-length': '500' }); res.write(Buffer.alloc(10)) }
  await assert.rejects(() => downloadPublicHttpUrl(`${base}/trickle`, { ...trusted, timeoutMs: 200 }), /took too long|cut off/)
})
