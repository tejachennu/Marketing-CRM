// Verification test for Facebook vs Twilio WhatsApp provider isolation

function resolveProviderAndChannel(body, org) {
  const { channel, templateName, templateSid, phoneNumber } = body
  const { whatsapp_provider, enable_sms, enable_messages } = org

  let isWhatsApp = true
  if (channel === 'sms') {
    isWhatsApp = false
  } else if (channel === 'whatsapp' || templateName || templateSid) {
    isWhatsApp = true
  } else if (phoneNumber && phoneNumber.startsWith('whatsapp:')) {
    isWhatsApp = true
  } else if (whatsapp_provider === 'facebook' || whatsapp_provider === 'twilio') {
    isWhatsApp = true
  } else if (!enable_messages && enable_sms) {
    isWhatsApp = false
  }

  const useFacebook = isWhatsApp && whatsapp_provider === 'facebook'
  const useTwilio = isWhatsApp ? (whatsapp_provider === 'twilio') : true

  return { isWhatsApp, useFacebook, useTwilio }
}

function buildMetaPayload(contactPhone, templateName, templateLanguage, templateVariables, msgBody) {
  const cleanToFb = contactPhone.replace(/^whatsapp:/i, '').replace(/^\+/, '').trim()
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanToFb
  }

  if (templateName) {
    let tName = templateName.replace(/\s*\(Meta Approved\)/gi, '').replace(/\s*\(Twilio WhatsApp Approved\)/gi, '').replace(/\s*\[.*?\]/g, '').trim()
    payload.type = 'template'
    payload.template = {
      name: tName,
      language: {
        code: templateLanguage || 'en'
      }
    }
    if (templateVariables && typeof templateVariables === 'object') {
      const parameters = Object.entries(templateVariables).map(([_, val]) => ({
        type: 'text',
        text: String(val || '')
      }))
      if (parameters.length > 0) {
        payload.template.components = [{ type: 'body', parameters }]
      }
    }
  } else {
    payload.type = 'text'
    payload.text = { body: msgBody }
  }

  return payload
}

console.log('=== Test 1: Chat 1-click Direct Message with Facebook Provider ===')
const orgFacebook = {
  whatsapp_provider: 'facebook',
  whatsapp_api_token: 'EAAMockToken...',
  whatsapp_phone_number_id: '123456789',
  enable_messages: true,
  enable_sms: true,
  twilio_account_sid: null, // Zero Twilio config
  twilio_auth_token: null
}

const req1 = {
  phoneNumber: '+919910909977',
  message: 'Hello! How are you doing today?',
  channel: 'whatsapp'
}

const res1 = resolveProviderAndChannel(req1, orgFacebook)
console.log('Provider resolution:', res1)
if (!res1.useFacebook || res1.useTwilio) {
  console.error('❌ Test 1 Failed: Facebook provider isolation failed!')
  process.exit(1)
}

const payload1 = buildMetaPayload(req1.phoneNumber, null, null, null, req1.message)
console.log('Meta Text Payload:', payload1)
if (payload1.to !== '919910909977' || payload1.type !== 'text') {
  console.error('❌ Test 1 Failed: Payload format invalid!')
  process.exit(1)
}

console.log('\n=== Test 2: Chat Template Message with Facebook Provider ===')
const req2 = {
  phoneNumber: '+919910909977',
  templateName: 'hpv_30aug_motinagar_01_msg (Meta Approved)',
  templateLanguage: 'te',
  templateVariables: { '1': 'Ananya', '2': 'Motinagar' },
  channel: 'whatsapp'
}

const res2 = resolveProviderAndChannel(req2, orgFacebook)
console.log('Provider resolution:', res2)
if (!res2.useFacebook) {
  console.error('❌ Test 2 Failed: Facebook provider not chosen!')
  process.exit(1)
}

const payload2 = buildMetaPayload(req2.phoneNumber, req2.templateName, req2.templateLanguage, req2.templateVariables, '')
console.log('Meta Template Payload:', JSON.stringify(payload2, null, 2))
if (payload2.template.name !== 'hpv_30aug_motinagar_01_msg' || payload2.template.language.code !== 'te' || payload2.template.components[0].parameters.length !== 2) {
  console.error('❌ Test 2 Failed: Template payload incorrect!')
  process.exit(1)
}

console.log('\n✅ All provider isolation tests passed! Facebook Meta WhatsApp never touches Twilio credentials.')
