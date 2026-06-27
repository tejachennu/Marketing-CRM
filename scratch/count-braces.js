const fs = require('fs')
const code = fs.readFileSync('d:/new-chat/app/dashboard/tickets/page.tsx', 'utf8')

let open = 0
let close = 0
let lineNum = 1
for (let i = 0; i < code.length; i++) {
  if (code[i] === '\n') lineNum++
  if (code[i] === '{') {
    open++
  } else if (code[i] === '}') {
    close++
    if (close > open) {
      console.log(`Extra closing brace found at line ${lineNum}`)
    }
  }
}
console.log(`Total open braces: ${open}`)
console.log(`Total close braces: ${close}`)
