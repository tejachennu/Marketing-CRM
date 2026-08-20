// Verification test for Telugu [te] template language & parameter matching

function resolveTemplateMeta(rawCampaignName, rawTemplateName, metaApiLang, metaApiName, dbLang) {
  const rawName = metaApiName || rawTemplateName || 'custom_message'
  const templateName = rawName.split('•')[0].replace(/\s*\(Meta Approved\)/i, '').trim()
  
  const tagMatch = (rawTemplateName || '').match(/\[([a-z]{2}(?:_[A-Z]{2})?)\]/i)
  const templateLanguage = metaApiLang || dbLang || tagMatch?.[1] || 'en'

  return { templateName, templateLanguage }
}

function buildBodyParameters(uniqueKeys, mappedVars) {
  return uniqueKeys.map((key, idx) => {
    const positionalKey = String(idx + 1)
    const val = mappedVars[key] !== undefined 
      ? mappedVars[key] 
      : (mappedVars[key.toLowerCase()] !== undefined 
          ? mappedVars[key.toLowerCase()] 
          : (mappedVars[positionalKey] !== undefined ? mappedVars[positionalKey] : ''))
    return {
      type: 'text',
      text: String(val)
    }
  })
}

console.log('=== Test Case 1: HPV Motinagar Telugu Template ===')
const res1 = resolveTemplateMeta(
  'HPV Campaign', 
  'hpv_30aug_motinagar_01_msg • ✓ Approved [te] [UTILITY]',
  'te', // fetched from Meta Graph API
  'hpv_30aug_motinagar_01_msg',
  'te'
)
console.log('Resolved Template Name:', res1.templateName)
console.log('Resolved Template Language:', res1.templateLanguage)

if (res1.templateName !== 'hpv_30aug_motinagar_01_msg') {
  console.error('❌ Error: templateName was not cleaned properly')
  process.exit(1)
}

if (res1.templateLanguage !== 'te') {
  console.error('❌ Error: templateLanguage is not "te"')
  process.exit(1)
}

console.log('\n=== Test Case 2: Parameter Resolution (Named & Positional) ===')
const keys = ['name', 'firstdate', 'lastdate', 'place', 'map']
const mappedFromExcel = {
  '1': 'Dr. Rajesh',
  '2': '01-Aug-2026',
  '3': '30-Aug-2026',
  '4': 'Moti Nagar Clinic',
  '5': 'https://maps.app.goo.gl/xyz'
}

const params = buildBodyParameters(keys, mappedFromExcel)
console.log('Generated Meta Parameters:', JSON.stringify(params, null, 2))

if (params[0].text !== 'Dr. Rajesh' || params[3].text !== 'Moti Nagar Clinic') {
  console.error('❌ Error in parameter extraction!')
  process.exit(1)
}

console.log('\n✅ Verification passed! Language is "te" and template name is "hpv_30aug_motinagar_01_msg".')
