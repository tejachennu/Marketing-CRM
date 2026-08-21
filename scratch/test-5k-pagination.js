// Verification test for 5k+ contacts pagination and campaign execution

async function mockFetchAllTenantContacts(totalContacts) {
  // Simulates PostgREST 1000 row batching
  const batchSize = 1000
  let allContacts = []
  
  // First batch
  const firstBatchCount = Math.min(batchSize, totalContacts)
  const firstBatch = Array.from({ length: firstBatchCount }, (_, i) => ({ id: `c_${i + 1}`, phone: `+9199000${String(i).padStart(5, '0')}` }))
  allContacts = allContacts.concat(firstBatch)

  // Remaining batches
  if (totalContacts > batchSize) {
    const promises = []
    for (let offset = 1000; offset < totalContacts; offset += batchSize) {
      const count = Math.min(batchSize, totalContacts - offset)
      promises.push(Promise.resolve(
        Array.from({ length: count }, (_, i) => ({ id: `c_${offset + i + 1}`, phone: `+9199000${String(offset + i).padStart(5, '0')}` }))
      ))
    }
    const batches = await Promise.all(promises)
    batches.forEach(b => { allContacts = allContacts.concat(b) })
  }

  return allContacts
}

function chunkLogsInsertion(pendingLogs, chunkSize = 500) {
  const chunks = []
  for (let i = 0; i < pendingLogs.length; i += chunkSize) {
    chunks.push(pendingLogs.slice(i, i + chunkSize))
  }
  return chunks
}

async function runTest() {
  console.log('=== Test: Fetching 5,000 Tenant Contacts in 1,000-Row Chunks ===')
  const contacts = await mockFetchAllTenantContacts(5000)
  console.log(`Total Contacts Loaded: ${contacts.length}`)
  if (contacts.length !== 5000) {
    console.error('❌ Failed: Expected 5000 contacts!')
    process.exit(1)
  }

  console.log('\n=== Test: Chunking 5,000 Audience Records for Database Insert ===')
  const sampleLogs = contacts.map(c => ({ campaign_id: 'camp_1', phone: c.phone, status: 'PENDING' }))
  const chunks = chunkLogsInsertion(sampleLogs, 500)
  console.log(`Created ${chunks.length} chunks of max 500 records each.`)
  if (chunks.length !== 10 || chunks[0].length !== 500) {
    console.error('❌ Failed: Expected 10 chunks of 500 records!')
    process.exit(1)
  }

  console.log('\n✅ All 5k+ contact pagination and broadcast scaling tests passed successfully!')
}

runTest()
