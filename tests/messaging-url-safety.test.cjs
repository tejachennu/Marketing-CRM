// Media URLs the server is asked to download: the address rules, and the resolver-backed check
// that catches names pointing at this machine or the private network. DNS is faked; nothing
// here reaches the network.
require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const dns = require('node:dns')

const { isPrivateIpAddress, isPublicHttpUrl, assertPublicHttpUrl } = require('../lib/utils.ts')

// What each name resolves to; a name that is missing does not exist
const answers = {
  'cdn.example.com': ['93.184.216.34'],
  '127-0-0-1.nip.io': ['127.0.0.1'],
  'both.example.com': ['93.184.216.34', '::ffff:127.0.0.1'],
  'metadata.example.com': ['169.254.169.254'],
  'v6.example.com': ['2606:4700::1111', 'fe80::1'],
  'cgnat.example.com': ['100.64.1.1'],
  'nat64.example.com': ['64:ff9b::a00:1'],
}
const lookups = []
const originalLookup = dns.promises.lookup
dns.promises.lookup = async (host, options) => {
  lookups.push({ host, options })
  const list = answers[host]
  if (!list) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
  const entries = list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  return options?.all ? entries : entries[0]
}
test.after(() => { dns.promises.lookup = originalLookup })

test('Media URLs: addresses off the public internet are told apart, IPv6 wrappers of IPv4 included', () => {
  for (const address of [
    '127.0.0.1', '127.255.255.255', '10.1.2.3', '100.64.0.1', '100.127.255.255', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '192.0.0.8', '0.0.0.0', '0.1.2.3', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '100::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:10.0.0.1', '::ffff:169.254.169.254', '::ffff:100.64.0.1', '::10.0.0.1', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1',
    '[::1]', 'not-an-ip', '1.2.3', '1.2.3.256', '', null, undefined,
  ]) {
    assert.equal(isPrivateIpAddress(address), true, String(address))
  }
  for (const address of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '100.63.255.255', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
    assert.equal(isPrivateIpAddress(address), false, address)
  }
})

test('Media URLs: the hostname check now refuses mapped-IPv6, carrier-grade NAT and local names', () => {
  for (const url of [
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:10.0.0.1]/', 'http://[64:ff9b::7f00:1]/', 'http://100.64.0.1/x', 'http://100.127.1.1/x',
    'http://intranet/', 'http://db:5432/', 'http://localhost./', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://127.1/', 'http://0/',
    'http://224.0.0.1/', 'http://[fec0::1]/', 'http://[ff02::1]/',
  ]) {
    assert.equal(isPublicHttpUrl(url), false, url)
  }
  for (const url of ['https://cdn.example.com/a.png', 'https://[2606:4700::1111]/x', 'https://[::ffff:8.8.8.8]/x', 'http://example.com./a', 'https://100.128.0.1/x']) {
    assert.equal(isPublicHttpUrl(url), true, url)
  }
})

test('Media URLs: a name is resolved, and every address it gives must be public', async () => {
  lookups.length = 0
  const accepted = await assertPublicHttpUrl('https://cdn.example.com/a.png?x=1')
  assert.equal(accepted.href, 'https://cdn.example.com/a.png?x=1')
  assert.deepEqual(lookups, [{ host: 'cdn.example.com', options: { all: true } }])

  await assert.rejects(() => assertPublicHttpUrl('https://127-0-0-1.nip.io/a.png'), /private network address/)
  await assert.rejects(() => assertPublicHttpUrl('https://both.example.com/a.png'), /private network address/)      // one private answer is enough
  await assert.rejects(() => assertPublicHttpUrl('http://metadata.example.com/latest/meta-data/'), /private network address/)
  await assert.rejects(() => assertPublicHttpUrl('https://v6.example.com/a.png'), /private network address/)       // link-local beside a public address
  await assert.rejects(() => assertPublicHttpUrl('https://cgnat.example.com/a.png'), /private network address/)
  await assert.rejects(() => assertPublicHttpUrl('https://nat64.example.com/a.png'), /private network address/)
  await assert.rejects(() => assertPublicHttpUrl('https://nowhere.example.com/a.png'), /Could not resolve nowhere\.example\.com/)
})

test('Media URLs: what the address alone rules out is refused without a lookup', async () => {
  lookups.length = 0
  for (const url of ['http://intranet/x', 'http://localhost:3000/api/x', 'http://127.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/', 'ftp://cdn.example.com/a', 'file:///etc/passwd', '/uploads/a.png', '', undefined]) {
    await assert.rejects(() => assertPublicHttpUrl(url), /Only a public http\(s\) address/, String(url))
  }
  // A public IP literal needs no lookup either
  assert.equal((await assertPublicHttpUrl('https://93.184.216.34/a.png')).hostname, '93.184.216.34')
  assert.equal(lookups.length, 0)
})
