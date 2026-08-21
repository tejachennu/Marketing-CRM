// Verification test for broadcasting to all tenant contacts

function compileDbAudience(contacts, selectedIds, variableMappingTypes, variableMappings, staticValues, channel) {
  const selectedContacts = contacts.filter(c => selectedIds.includes(c.id))
  return selectedContacts.map(c => {
    const variables = {}
    Object.keys(variableMappingTypes).forEach(tplVar => {
      const type = variableMappingTypes[tplVar]
      if (type === 'static') {
        variables[tplVar] = staticValues[tplVar] || ''
      } else {
        const attr = variableMappings[tplVar]
        variables[tplVar] = String(c[attr] || '')
      }
    })

    const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.first_name || 'Valued Customer'
    if (!variables['1']) variables['1'] = c.first_name || fullName
    if (!variables['name']) variables['name'] = c.first_name || fullName
    if (!variables['first_name']) variables['first_name'] = c.first_name || fullName
    if (!variables['contact_name']) variables['contact_name'] = fullName
    if (!variables['2'] && c.last_name) variables['2'] = c.last_name
    if (!variables['last_name'] && c.last_name) variables['last_name'] = c.last_name
    if (c.company && !variables['company']) variables['company'] = c.company
    if (Array.isArray(c.tags) && c.tags.length > 0 && !variables['tag']) variables['tag'] = c.tags.join(', ')

    if (channel === 'email') {
      return {
        email: c.email || '',
        variables
      }
    } else {
      return {
        phone: c.phone_number,
        variables
      }
    }
  }).filter(item => channel === 'email' ? (item.email && item.email.includes('@')) : (item.phone && item.phone.length > 5))
}

console.log('=== Test: Broadcasting to 500 Tenant Contacts ===')
const sampleTenantContacts = Array.from({ length: 500 }, (_, i) => ({
  id: `contact-${i + 1}`,
  organization_id: 'org-tenant-1',
  first_name: `Patient ${i + 1}`,
  last_name: `Kumar`,
  phone_number: `+9198765${String(i).padStart(5, '0')}`,
  company: 'Yira Clinic',
  tags: ['HPV Lot 1', 'Tenant Audience']
}))

// 1. Select All
const allIds = sampleTenantContacts.map(c => c.id)
const audience = compileDbAudience(sampleTenantContacts, allIds, {}, {}, {}, 'whatsapp')

console.log(`Total Tenant Contacts: ${sampleTenantContacts.length}`)
console.log(`Compiled Broadcast Audience: ${audience.length}`)
console.log(`Sample Audience Item:`, JSON.stringify(audience[0], null, 2))

if (audience.length !== 500) {
  console.error('❌ Error: Expected 500 contacts in audience!')
  process.exit(1)
}

if (audience[0].variables.first_name !== 'Patient 1' || audience[0].variables.tag !== 'HPV Lot 1, Tenant Audience') {
  console.error('❌ Error: Variables not properly mapped from tenant contact!')
  process.exit(1)
}

console.log('\n✅ Verification passed! All tenant contacts compiled into broadcast audience.')
