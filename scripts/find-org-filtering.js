const fs = require('fs')
const path = require('path')

const dirToSearch = 'd:\\new-chat'

function searchDir(dir) {
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const fullPath = path.join(dir, file)
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.next' && file !== '.git') {
        searchDir(fullPath)
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js')) {
      const content = fs.readFileSync(fullPath, 'utf8')
      if (content.includes('organization_id')) {
        console.log(`Found in: ${fullPath}`)
        // Find matching lines
        const lines = content.split('\n')
        lines.forEach((line, idx) => {
          if (line.includes('organization_id') || line.includes('organizationId')) {
            console.log(`  Line ${idx + 1}: ${line.trim()}`)
          }
        })
      }
    }
  }
}

searchDir(dirToSearch)
