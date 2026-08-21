// Verification test for WhatsApp Meta Template parameter formatting and #132012 resolution

function buildMetaTemplatePayload(
  templateName,
  templateLanguage,
  templateMetaComponents,
  templateVariables,
  msgMediaUrl
) {
  let tName = templateName.replace(/\s*\(Meta Approved\)/gi, '').replace(/\s*\(Twilio WhatsApp Approved\)/gi, '').replace(/\s*\[.*?\]/g, '').trim()
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '916303012453',
    type: 'template',
    template: {
      name: tName,
      language: {
        code: templateLanguage || 'en'
      }
    }
  }

  const metaComponents = templateMetaComponents || []
  if (metaComponents.length > 0) {
    const reqComponents = []
    const mappedVars = templateVariables || {}

    for (const comp of metaComponents) {
      if (comp.type === 'HEADER') {
        if (comp.format === 'IMAGE') {
          const imgVal = mappedVars['header_image_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || msgMediaUrl || ''
          if (imgVal) {
            const mediaParam = imgVal.startsWith('http') ? { link: imgVal } : { id: imgVal }
            reqComponents.push({
              type: 'header',
              parameters: [{ type: 'image', image: mediaParam }]
            })
          }
        } else if (comp.format === 'DOCUMENT') {
          const docVal = mappedVars['header_document_url'] || mappedVars['header_link'] || mappedVars['header_media_url'] || comp.example?.header_handle?.[0] || msgMediaUrl || ''
          if (docVal) {
            const filename = mappedVars['header_document_filename'] || 'document.pdf'
            const mediaParam = docVal.startsWith('http') ? { link: docVal, filename } : { id: docVal, filename }
            reqComponents.push({
              type: 'header',
              parameters: [{ type: 'document', document: mediaParam }]
            })
          }
        } else if (comp.format === 'TEXT') {
          const headerVal = mappedVars['header_text_1'] || mappedVars['header_1'] || comp.example?.header_text?.[0] || ''
          if (headerVal) {
            reqComponents.push({
              type: 'header',
              parameters: [{ type: 'text', text: headerVal }]
            })
          }
        }
      } else if (comp.type === 'BODY') {
        const bodyText = comp.text || ''
        let uniqueKeys = []

        const namedParams = comp.example?.body_text_named_params
        if (Array.isArray(namedParams) && namedParams.length > 0) {
          uniqueKeys = namedParams.map(p => p.param_name).filter(Boolean)
        } else {
          const placeholders = bodyText.match(/\{\{([^}]+)\}\}/g) || []
          const rawKeys = Array.from(new Set(placeholders.map(m => m.replace(/[\{\}]/g, ''))))
          uniqueKeys = rawKeys.filter(k => /^[a-zA-Z0-9_]+$/.test(k))
          const isNumeric = uniqueKeys.every(k => !isNaN(Number(k)))
          if (isNumeric) {
            uniqueKeys.sort((a, b) => Number(a) - Number(b))
          }
        }

        const parameters = uniqueKeys.map((key, idx) => {
          const positionalKey = String(idx + 1)
          const val = mappedVars[key] !== undefined
            ? mappedVars[key]
            : (mappedVars[key.toLowerCase()] !== undefined
                ? mappedVars[key.toLowerCase()]
                : (mappedVars[positionalKey] !== undefined ? mappedVars[positionalKey] : ''))
          const paramObj = { type: 'text', text: String(val) }
          if (isNaN(Number(key))) {
            paramObj.parameter_name = key
          }
          return paramObj
        })

        if (parameters.length > 0) {
          reqComponents.push({ type: 'body', parameters })
        }
      } else if (comp.type === 'BUTTONS' && Array.isArray(comp.buttons)) {
        comp.buttons.forEach((btn, idx) => {
          if (btn.type === 'URL' && btn.url?.includes('{{1}}')) {
            const val = mappedVars[`button_url_${idx + 1}`] || mappedVars['button_url_1'] || ''
            reqComponents.push({
              type: 'button',
              sub_type: 'url',
              index: String(idx),
              parameters: [{ type: 'text', text: val }]
            })
          }
        })
      }
    }

    if (reqComponents.length > 0) {
      payload.template.components = reqComponents
    }
  }

  return payload
}

async function runTests() {
  console.log('=== Test 1: Template with Header Image + Named Body Parameters ===')
  const metaComponents1 = [
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4:cHJldmlld19pbWFnZQ==:ARa...'] } },
    { type: 'BODY', text: 'Hello {{patient_name}}, your appointment at {{clinic_name}} is confirmed.' }
  ]
  const vars1 = { patient_name: 'Rahul', clinic_name: 'Yira Health', header_image_url: 'https://example.com/banner.png' }
  const payload1 = buildMetaTemplatePayload('appointment_reminder_v1', 'en', metaComponents1, vars1, null)
  console.log('Payload 1:', JSON.stringify(payload1, null, 2))

  if (!payload1.template.components || payload1.template.components.length !== 2) {
    console.error('❌ Test 1 Failed: Expected 2 components (header + body)!')
    process.exit(1)
  }
  if (payload1.template.components[0].type !== 'header' || payload1.template.components[0].parameters[0].image.link !== 'https://example.com/banner.png') {
    console.error('❌ Test 1 Failed: Header image component missing or incorrect!')
    process.exit(1)
  }
  if (payload1.template.components[1].parameters[0].parameter_name !== 'patient_name' || payload1.template.components[1].parameters[0].text !== 'Rahul') {
    console.error('❌ Test 1 Failed: Named parameter parameter_name missing!')
    process.exit(1)
  }

  console.log('\n=== Test 2: Static Template with NO variables (Zero parameters) ===')
  const metaComponents2 = [
    { type: 'BODY', text: 'Thank you for choosing Yira. Our support team is available 24/7.' }
  ]
  const payload2 = buildMetaTemplatePayload('welcome_static_msg', 'en', metaComponents2, {}, null)
  console.log('Payload 2:', JSON.stringify(payload2, null, 2))

  if (payload2.template.components) {
    console.error('❌ Test 2 Failed: Static template must NOT have components property!')
    process.exit(1)
  }

  console.log('\n=== Test 3: Positional Variables Template {{1}}, {{2}} ===')
  const metaComponents3 = [
    { type: 'BODY', text: 'Dear {{1}}, your OTP code is {{2}}.' }
  ]
  const vars3 = { '1': 'Suresh', '2': '482910' }
  const payload3 = buildMetaTemplatePayload('otp_verification', 'en', metaComponents3, vars3, null)
  console.log('Payload 3:', JSON.stringify(payload3, null, 2))

  if (payload3.template.components[0].parameters[0].parameter_name) {
    console.error('❌ Test 3 Failed: Positional parameter must NOT have parameter_name!')
    process.exit(1)
  }
  if (payload3.template.components[0].parameters[0].text !== 'Suresh' || payload3.template.components[0].parameters[1].text !== '482910') {
    console.error('❌ Test 3 Failed: Positional parameters value mismatch!')
    process.exit(1)
  }

  console.log('\n✅ All Meta WhatsApp template parameter format tests passed successfully!')
}

runTests()
