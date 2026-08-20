// Verification test for contact first name and tag extraction/syncing from Excel

function processAudienceRow(row, contactNameCol, contactLastNameCol, contactTagCol, customTag) {
  const variables = {}

  if (contactNameCol && row[contactNameCol]) {
    variables['first_name'] = String(row[contactNameCol] || '').trim()
    variables['contact_name'] = String(row[contactNameCol] || '').trim()
    variables['name'] = String(row[contactNameCol] || '').trim()
  }
  if (contactLastNameCol && row[contactLastNameCol]) {
    variables['last_name'] = String(row[contactLastNameCol] || '').trim()
  }
  if (contactTagCol && row[contactTagCol]) {
    variables['tag'] = String(row[contactTagCol] || '').trim()
    variables['tags'] = String(row[contactTagCol] || '').trim()
  } else if (customTag) {
    variables['tag'] = customTag.trim()
    variables['tags'] = customTag.trim()
  }

  return variables
}

function extractContactSyncInfo(mappedVars, campaignName) {
  const explicitFirst = mappedVars['first_name'] || mappedVars['firstName']
  const explicitLast = mappedVars['last_name'] || mappedVars['lastName']
  let firstName = 'Campaign'
  let lastName = 'Contact'

  if (explicitFirst) {
    firstName = String(explicitFirst).trim()
    lastName = explicitLast ? String(explicitLast).trim() : ''
  }

  const rawTags = mappedVars['tag'] || mappedVars['tags'] || mappedVars['category'] || mappedVars['group'] || mappedVars['segment']
  let contactTags = []
  if (rawTags) {
    if (Array.isArray(rawTags)) {
      contactTags = rawTags.map(t => String(t).trim()).filter(Boolean)
    } else {
      contactTags = String(rawTags).split(/[,;]/).map(t => t.trim()).filter(Boolean)
    }
  }
  if (campaignName && !contactTags.includes(campaignName)) {
    contactTags.push(campaignName)
  }

  return { firstName, lastName, contactTags }
}

console.log('=== Test Case 1: Row with Patient Name & Custom Tag ===')
const row1 = {
  'Patient Name': 'Ananya Sharma',
  'MobileNumber': '+919876543210',
  'Category': 'HPV Lot 1'
}
const vars1 = processAudienceRow(row1, 'Patient Name', '', 'Category', '')
const sync1 = extractContactSyncInfo(vars1, 'HPV Campaign Motinagar')

console.log('Vars:', vars1)
console.log('Sync Result:', sync1)

if (sync1.firstName !== 'Ananya Sharma' || !sync1.contactTags.includes('HPV Lot 1') || !sync1.contactTags.includes('HPV Campaign Motinagar')) {
  console.error('❌ Error in Test 1')
  process.exit(1)
}

console.log('\n=== Test Case 2: Row with Custom Campaign Tag input ===')
const row2 = {
  'Contact Name': 'Dr. Rajesh',
  'MobileNumber': '+919876543211'
}
const vars2 = processAudienceRow(row2, 'Contact Name', '', '', 'HPV Followup, VIP')
const sync2 = extractContactSyncInfo(vars2, 'HPV Followup')

console.log('Vars:', vars2)
console.log('Sync Result:', sync2)

if (sync2.firstName !== 'Dr. Rajesh' || !sync2.contactTags.includes('HPV Followup') || !sync2.contactTags.includes('VIP')) {
  console.error('❌ Error in Test 2')
  process.exit(1)
}

console.log('\n✅ All tests passed! Contact first name and tags correctly extracted and formatted.')
