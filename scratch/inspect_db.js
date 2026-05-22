const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Manually parse .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
  if (match) {
    let val = match[2].trim();
    // remove quotes if present
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    env[match[1]] = val;
  }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function run() {
  console.log('Connecting to:', supabaseUrl);
  
  // Test reading profiles
  const { data: profiles, error: pError } = await supabase
    .from('profiles')
    .select('*')
    .limit(5);
    
  if (pError) {
    console.error('Error fetching profiles:', pError);
  } else {
    console.log('Profiles columns:', Object.keys(profiles[0] || {}));
    console.log('Profiles count:', profiles.length);
    console.log('Profiles sample:', profiles.map(p => ({ id: p.id, full_name: p.full_name, role: p.role })));
  }

  // Fetch list of users from Auth
  const { data: { users }, error: uError } = await supabase.auth.admin.listUsers();
  if (uError) {
    console.error('Error fetching users:', uError);
  } else {
    console.log('Users count:', users.length);
    console.log('Users sample:', users.map(u => ({ id: u.id, email: u.email })));
  }
}

run();
