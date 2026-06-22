const fs = require('fs');
const path = require('path');

const targetPath = path.join('d:', 'new-chat', 'app', 'dashboard', 'page.tsx');
const sourcePath = 'C:\\Users\\HP\\.gemini\\antigravity\\brain\\ed133245-9c7e-4d35-8701-e0a13ebc5351\\scratch\\new_return.txt';

const targetContent = fs.readFileSync(targetPath, 'utf8');
const sourceContent = fs.readFileSync(sourcePath, 'utf8');

// Normalize line endings to LF to avoid issues
const lines = targetContent.replace(/\r\n/g, '\n').split('\n');

// Replace lines 675 to 1409 (inclusive, 1-indexed)
// lines[674] is line 675 (return ()
// lines[1408] is line 1409 ())
const before = lines.slice(0, 674).join('\n');
const after = lines.slice(1409).join('\n');

const newContent = before + '\n' + sourceContent + '\n' + after;
fs.writeFileSync(targetPath, newContent, 'utf8');
console.log('Successfully patched page.tsx');
