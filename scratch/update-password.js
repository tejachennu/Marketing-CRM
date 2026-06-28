require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function updatePassword() {
  const email = 'tejachennu223@gmail.com';
  const newPassword = 'Teja@0311';

  try {
    // Get the user by email (using listUsers because admin.getUserByEmail doesn't always exist in older v2 versions, but we can try it first or use users table if we have to, wait, supabaseAdmin.auth.admin.listUsers() is safer)
    
    // In Supabase v2, we can just use updateUserById if we have the ID. But we need the ID.
    // Let's first query the public.users table to get the auth ID.
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();
      
    if (userError || !userData) {
      console.log('User not found in public.users, searching auth.users directly...');
      // If not in public.users, list users
      const { data: authUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      if (listError) {
        console.error("Error listing users:", listError);
        return;
      }
      const authUser = authUsers.users.find(u => u.email === email);
      if (!authUser) {
        console.error("User not found with email:", email);
        return;
      }
      
      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        password: newPassword
      });
      
      if (error) {
        console.error("Failed to update password:", error);
      } else {
        console.log("Successfully updated password for", email);
      }
      return;
    }
    
    console.log(`Found user ID: ${userData.id}`);
    
    // Update the password using the ID
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userData.id, {
      password: newPassword
    });
    
    if (error) {
      console.error("Failed to update password:", error);
    } else {
      console.log("Successfully updated password for", email);
    }
    
  } catch (err) {
    console.error("Unexpected error:", err);
  }
}

updatePassword();
