
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function run() {
  const { data: d1, error: e1 } = await supabase.from('lead_activities').select('*').limit(1);
  console.log('lead_activities:', e1 ? e1.message : 'Exists');
  
  const { data: d2, error: e2 } = await supabase.from('lead_notes').select('*').limit(1);
  console.log('lead_notes:', e2 ? e2.message : 'Exists');
  
  const { data: d3, error: e3 } = await supabase.from('leads').select('*').limit(1);
  if (d3 && d3.length > 0) {
    console.log('leads cols:', Object.keys(d3[0]));
  }
}
run();

