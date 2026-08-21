// Verification test for Step 3 validation when template has 0 variables

function validateStep3(variablesToMap, variableMappingTypes, variableMappings, staticVariableValues) {
  const unmapped = variablesToMap.filter(tplVar => {
    const type = variableMappingTypes[tplVar] || 'dynamic'
    if (type === 'static') {
      return !staticVariableValues[tplVar]?.trim()
    } else {
      return !variableMappings[tplVar]
    }
  })
  
  if (unmapped.length > 0) {
    return { valid: false, error: 'Please complete all variable mappings or static values before proceeding.' }
  }
  return { valid: true, error: null }
}

function runTests() {
  console.log('=== Test 1: Zero-variable Template (e.g. Yira 360 Family Health) ===')
  const variablesToMap1 = []
  // Simulated stale state from a previous template
  const staleMappingTypes = { '1': 'dynamic', '2': 'dynamic' }
  const staleMappings = {}
  const staleStatics = {}

  const result1 = validateStep3(variablesToMap1, staleMappingTypes, staleMappings, staleStatics)
  console.log('Validation Result (Zero Variables):', result1)
  if (!result1.valid) {
    console.error('❌ Test 1 Failed: Zero-variable template was blocked by stale state!')
    process.exit(1)
  }

  console.log('\n=== Test 2: Two-variable Template (unmapped) ===')
  const variablesToMap2 = ['1', '2']
  const result2 = validateStep3(variablesToMap2, { '1': 'dynamic', '2': 'dynamic' }, { '1': 'Name' }, {})
  console.log('Validation Result (Missing variable 2):', result2)
  if (result2.valid) {
    console.error('❌ Test 2 Failed: Unmapped variable 2 should be rejected!')
    process.exit(1)
  }

  console.log('\n=== Test 3: Two-variable Template (complete mapping) ===')
  const result3 = validateStep3(variablesToMap2, { '1': 'dynamic', '2': 'static' }, { '1': 'Name' }, { '2': 'Yira Health' })
  console.log('Validation Result (Complete):', result3)
  if (!result3.valid) {
    console.error('❌ Test 3 Failed: Valid mapping was rejected!')
    process.exit(1)
  }

  console.log('\n✅ All Step 3 variable mapping validation tests passed successfully!')
}

runTests()
