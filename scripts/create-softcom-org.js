const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const ORG_CONFIG = {
  name: 'Softcom Technologies',
  slug: 'softcom-technologies',
  whatsapp_provider: 'facebook',
  whatsapp_api_token: 'EAAkhVZCE7GZBgBSsVoCjf5ExiHF45nwGBrdueDZBZCKLM7kbivV6Ka5xoA6TccvuQEvf19etBOcslBpEme7My3jQ7aQWbudqqakgOCH3b1SBhpx4y7TPeuQqogZCm3VAed64JZC2J8gG8jtv0qY00JgC54b53Wbh3C43AZCeZBxrZB1fGHSPnIefjMvPkIAR8Rf2ZChwZDZD',
  whatsapp_phone_number_id: '1326239367246484',
  whatsapp_business_account_id: '3220691194788830',
  whatsapp_default_phone: '+91 85007 57299',
  whatsapp_graph_api_version: 'v26.0',
  contact_name: 'Manikanta',
  contact_email: 'mani.softcom@demo.com',
  contact_phone: '+91 85007 57299',
  enable_messages: true,
  enable_ai: true,
  enable_sms: false,
  enable_email: false,
  currency: 'INR',
  max_teammates: 10
};

const DEMO_USER = {
  email: 'mani.softcom@demo.com',
  password: 'SoftcomDemo@2026',
  fullName: 'Manikanta',
  role: 'org_admin'
};

async function main() {
  console.log('🚀 Setting up Softcom Technologies organization and demo user...');

  // 1. Check if organization already exists with this slug
  let orgId = null;
  const { data: existingOrg, error: findOrgError } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', ORG_CONFIG.slug)
    .maybeSingle();

  if (findOrgError) {
    console.error('Error finding org:', findOrgError);
    return;
  }

  if (existingOrg) {
    console.log(`ℹ️ Organization already exists with slug "${ORG_CONFIG.slug}" (ID: ${existingOrg.id}). Updating configuration...`);
    const { data: updatedOrg, error: updateError } = await supabase
      .from('organizations')
      .update(ORG_CONFIG)
      .eq('id', existingOrg.id)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Failed to update org:', updateError);
      return;
    }
    orgId = updatedOrg.id;
    console.log('✅ Organization updated successfully.');
  } else {
    console.log('Creating new organization...');
    const { data: newOrg, error: createError } = await supabase
      .from('organizations')
      .insert([ORG_CONFIG])
      .select()
      .single();

    if (createError) {
      console.error('❌ Failed to create org:', createError);
      return;
    }
    orgId = newOrg.id;
    console.log(`✅ Organization created successfully with ID: ${orgId}`);
  }

  // 2. Setup pipeline stages if not present
  const { data: existingStages } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('organization_id', orgId);

  if (!existingStages || existingStages.length === 0) {
    console.log('Adding default pipeline stages...');
    const stages = [
      { name: 'New Inbound Lead', color: '#6366f1', position: 1 },
      { name: 'Engaged / Contacted', color: '#8b5cf6', position: 2 },
      { name: 'Discussion / Follow-up', color: '#ec4899', position: 3 },
      { name: 'Confirmed / Active', color: '#10b981', position: 4 }
    ];

    await supabase.from('pipeline_stages').insert(
      stages.map(s => ({ organization_id: orgId, ...s }))
    );
    console.log('✅ Pipeline stages created.');
  }

  // 3. Setup or update Auth User
  let authUserId = null;
  const { data: authList, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Error listing auth users:', listError);
  }

  const existingAuthUser = authList?.users?.find(u => u.email.toLowerCase() === DEMO_USER.email.toLowerCase());

  if (existingAuthUser) {
    console.log(`ℹ️ Auth user ${DEMO_USER.email} exists with ID: ${existingAuthUser.id}. Updating password...`);
    const { data: updatedUser, error: updateAuthErr } = await supabase.auth.admin.updateUserById(
      existingAuthUser.id,
      {
        password: DEMO_USER.password,
        email_confirm: true,
        user_metadata: { full_name: DEMO_USER.fullName }
      }
    );
    if (updateAuthErr) {
      console.error('Failed to update auth user:', updateAuthErr);
    } else {
      authUserId = updatedUser.user.id;
      console.log('✅ Auth user password updated.');
    }
  } else {
    console.log(`Creating auth user ${DEMO_USER.email}...`);
    const { data: newAuthUser, error: createAuthErr } = await supabase.auth.admin.createUser({
      email: DEMO_USER.email,
      password: DEMO_USER.password,
      email_confirm: true,
      user_metadata: { full_name: DEMO_USER.fullName }
    });

    if (createAuthErr) {
      console.error('❌ Failed to create auth user:', createAuthErr);
      return;
    }
    authUserId = newAuthUser.user.id;
    console.log(`✅ Auth user created with ID: ${authUserId}`);
  }

  // 4. Ensure public.users record is linked to this organization
  const { data: existingPublicUser, error: publicFindErr } = await supabase
    .from('users')
    .select('id, organization_id, email, role')
    .eq('id', authUserId)
    .maybeSingle();

  if (existingPublicUser) {
    console.log('Updating public.users record...');
    const { error: updatePublicErr } = await supabase
      .from('users')
      .update({
        organization_id: orgId,
        email: DEMO_USER.email,
        full_name: DEMO_USER.fullName,
        role: DEMO_USER.role
      })
      .eq('id', authUserId);

    if (updatePublicErr) {
      console.error('❌ Failed to update public user:', updatePublicErr);
    } else {
      console.log('✅ public.users record updated.');
    }
  } else {
    console.log('Inserting into public.users...');
    const { error: insertPublicErr } = await supabase
      .from('users')
      .insert([
        {
          id: authUserId,
          organization_id: orgId,
          email: DEMO_USER.email,
          full_name: DEMO_USER.fullName,
          role: DEMO_USER.role
        }
      ]);

    if (insertPublicErr) {
      console.error('❌ Failed to insert public user:', insertPublicErr);
    } else {
      console.log('✅ public.users record created.');
    }
  }

  // 5. Test signing in with credentials to make sure login works
  console.log('\nTesting sign in with credentials...');
  const testClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: signInData, error: signInErr } = await testClient.auth.signInWithPassword({
    email: DEMO_USER.email,
    password: DEMO_USER.password
  });

  if (signInErr) {
    console.error('❌ Test sign-in failed:', signInErr.message);
  } else {
    console.log('🎉 Test sign-in successful! User access token received.');
  }

  // 6. Print summary
  console.log('\n======================================================');
  console.log('🎉 ORGANIZATION & DEMO USER SETUP COMPLETE');
  console.log('======================================================');
  console.log('Organization Name:      ', ORG_CONFIG.name);
  console.log('Organization ID:        ', orgId);
  console.log('Slug:                   ', ORG_CONFIG.slug);
  console.log('WhatsApp Provider:      ', ORG_CONFIG.whatsapp_provider);
  console.log('Phone Number ID:        ', ORG_CONFIG.whatsapp_phone_number_id);
  console.log('WABA ID:                ', ORG_CONFIG.whatsapp_business_account_id);
  console.log('Sender Phone Number:    ', ORG_CONFIG.whatsapp_default_phone);
  console.log('Graph API Version:      ', ORG_CONFIG.whatsapp_graph_api_version);
  console.log('Meta App ID:            ', '2569936383450088');
  console.log('------------------------------------------------------');
  console.log('Webhook Dynamic Path:   ', `${orgId}_${ORG_CONFIG.slug}`);
  console.log('Verify Token:           ', orgId);
  console.log('------------------------------------------------------');
  console.log('Demo Login Email:       ', DEMO_USER.email);
  console.log('Demo Login Password:    ', DEMO_USER.password);
  console.log('User Role:              ', DEMO_USER.role);
  console.log('======================================================');
}

main().catch(console.error);
