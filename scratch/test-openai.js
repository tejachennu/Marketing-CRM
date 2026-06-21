const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load .env
dotenv.config({ path: path.join(__dirname, '../.env') });

const key = process.env.OPENAI_API_KEY;
console.log('API Key length:', key ? key.length : 0);
console.log('API Key prefix:', key ? key.substring(0, 12) : 'none');

async function test() {
  if (!key) {
    console.error('No OPENAI_API_KEY found in process.env');
    return;
  }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say hello!' }],
        max_tokens: 10
      })
    });
    console.log('Status code:', res.status);
    const body = await res.text();
    console.log('Response body:', body);
  } catch (err) {
    console.error('Error during fetch:', err);
  }
}

test();
