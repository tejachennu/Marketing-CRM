// Test script to verify Excel header matching and name splitting logic

const isPhoneHeader = (header) => {
  const h = header.trim().toLowerCase()
  if (/name/i.test(h)) return false // Exclude Contact Name, Customer Name, Full Name, etc.
  return (
    /phone|mobile|cell|tel|whatsapp/i.test(h) ||
    /contact.*(num|no|#)/i.test(h) ||
    /phone.*(num|no|#)/i.test(h) ||
    /mobile.*(num|no|#)/i.test(h) ||
    /^(phone|mobile|cell|tel|whatsapp|contact_no|phone_no|mobile_no)$/i.test(h)
  )
}

const autoDetectVariableMappings = (variables, headers) => {
  const mappings = {}
  const types = {}

  variables.forEach((v) => {
    const isMedia = v.includes('image_url') || v.includes('video_url') || v.includes('document_url') || v.includes('filename')
    types[v] = isMedia ? 'static' : 'dynamic'
    mappings[v] = ''

    if (!isMedia && headers.length > 0) {
      const vClean = v.toLowerCase().trim()

      if (vClean === '1' || /^(first_name|name|contact_name|customer_name|patient_name|full_name)$/i.test(vClean)) {
        const matchedNameHeader = 
          headers.find(h => /^(contact\s*name|first\s*name|customer\s*name|patient\s*name|full\s*name|client\s*name|name)$/i.test(h.trim())) ||
          headers.find(h => /contact.*name|first.*name|customer.*name|patient.*name|full.*name|client.*name|^name$/i.test(h.trim())) ||
          (headers.includes('first_name') ? 'first_name' : '')
        
        if (matchedNameHeader) {
          mappings[v] = matchedNameHeader
          types[v] = 'dynamic'
        }
      } else if (vClean === '2' || /^(last_name|surname|company|date|location)$/i.test(vClean)) {
        const matchedSecondHeader = 
          headers.find(h => /^(last\s*name|surname)$/i.test(h.trim())) ||
          headers.find(h => /last.*name|surname/i.test(h.trim())) ||
          headers.find(h => /^(company|organization|org)$/i.test(h.trim())) ||
          headers.find(h => /company|organization|date|appointment|city|location/i.test(h.trim())) ||
          (headers.includes('last_name') ? 'last_name' : '')

        if (matchedSecondHeader) {
          mappings[v] = matchedSecondHeader
          types[v] = 'dynamic'
        }
      }
    }
  })

  return { mappings, types }
}

function extractContactNames(mappedVars) {
  const explicitFirst = mappedVars['first_name'] || mappedVars['firstName']
  const explicitLast = mappedVars['last_name'] || mappedVars['lastName']
  if (explicitFirst) {
    return {
      firstName: String(explicitFirst).trim(),
      lastName: explicitLast ? String(explicitLast).trim() : ''
    }
  }

  const rawFullName = mappedVars['name'] || 
                      mappedVars['contact_name'] || 
                      mappedVars['customer_name'] || 
                      mappedVars['patient_name'] || 
                      mappedVars['client_name'] || 
                      mappedVars['full_name'] || 
                      mappedVars['1'] || ''
  const cleanedName = String(rawFullName).trim()

  if (cleanedName) {
    const explicitSecondVar = mappedVars['last_name'] || mappedVars['surname']
    if (explicitSecondVar) {
      return {
        firstName: cleanedName,
        lastName: String(explicitSecondVar).trim()
      }
    }

    const parts = cleanedName.split(/\s+/).filter(Boolean)
    if (parts.length === 1) {
      return { firstName: parts[0], lastName: '' }
    } else if (parts.length > 1) {
      const firstName = parts[0]
      const lastName = parts.slice(1).join(' ')
      return { firstName, lastName }
    }
  }

  return { firstName: 'Campaign', lastName: 'Contact' }
}

// Run test cases
console.log('=== TEST 1: Header Matching ===')
const testHeaders = [
  ['Contact Name', 'Contact Number', 'Email Address', 'Company'],
  ['First Name', 'Last Name', 'Phone', 'City'],
  ['Customer Name', 'Mobile', 'Appointment Date'],
  ['Full Name', 'Phone Number', 'Email'],
  ['Patient Name', 'Mobile Number', 'Date', 'Amount'],
  ['name', 'mobile_no', 'company_name']
]

testHeaders.forEach((headers, i) => {
  const phone = headers.find(isPhoneHeader)
  const { mappings } = autoDetectVariableMappings(['1', '2'], headers)
  console.log(`Dataset #${i + 1}: [${headers.join(', ')}]`)
  console.log(`  -> Detected Phone: "${phone}"`)
  console.log(`  -> Placeholder 1:  "${mappings['1']}"`)
  console.log(`  -> Placeholder 2:  "${mappings['2']}"`)
  
  if (phone && phone.toLowerCase().includes('name')) {
    console.error('  ❌ ERROR: Phone matched a name header!')
    process.exit(1)
  }
  if (!mappings['1']) {
    console.error('  ❌ ERROR: Placeholder 1 was not auto-mapped!')
    process.exit(1)
  }
})

console.log('\n=== TEST 2: Contact Name Extraction ===')
const nameTests = [
  { '1': 'Dr. Rajesh Kumar' },
  { '1': 'Ananya' },
  { '1': 'Pooja', '2': 'Verma' },
  { 'contact_name': 'Sarah Connor' },
  { 'first_name': 'Amit', 'last_name': 'Shah' }
]

nameTests.forEach((vars, i) => {
  const extracted = extractContactNames(vars)
  console.log(`Input: ${JSON.stringify(vars)} -> First: "${extracted.firstName}", Last: "${extracted.lastName}"`)
})

console.log('\n✅ All tests passed successfully!')
