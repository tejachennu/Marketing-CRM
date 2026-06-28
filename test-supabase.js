require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const orConditions = `assigned_to.eq.a281729c-a81d-4eb3-81a1-9a70f3f26b1f,contact_id.in.(4e55fc0f-7828-4ef7-b247-493e8006eec7)`;
  const { data, error } = await supabase.from('conversations').select('*').or(orConditions);
  console.log('Error:', error);
  console.log('Data:', data?.length);
}

test();
