import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Load env files manually if not in process.env
function loadEnv() {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}
loadEnv();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase URL or Service Role Key.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Exact target accounts to delete:
const TARGET_OLD_ACCOUNTS = [
  { employee_code: 'TAS-002', email: 'adityakanchi@proton.me' },
  { employee_code: 'TAS-003', email: 'hr.theaischool@gmail.com' },
  { employee_code: 'TAS-004', email: 'nikithasambangi1@gmail.com' },
  { employee_code: 'TAS-005', email: 'adikanchi20@gmail.com' },
  { employee_code: 'TAS-006', email: 'saheelyadav06@gmail.com' },
  { employee_code: 'TAS-007', email: 'nikithasambangi@gmail.com' },
  { employee_code: 'TAS-008', email: 'yadavsaheel404@gmail.com' },
  { employee_code: 'TAS-009', email: 'solo@sp33d.space' },
  { employee_code: 'TAS-010', email: 'admin@theaischool.in' },
  { employee_code: 'TAS-011', email: 'employee@theaischool.in' },
];

// Protected accounts that must never be deleted:
const PROTECTED_ACCOUNTS = [
  'TAS-001',
  'TAS-012',
  'TAS-013',
  'TAS-014',
  'TAS-015',
  'TAS-016',
  'TAS-017',
  'TAS-018',
  'TAS-019',
  'TAS-020',
  'TAS-021',
];

async function runPermanentDeletion() {
  console.log('=== PERMANENT DELETION OF 10 OLD TEST ACCOUNTS ===');

  // 1. Fetch current profiles
  const { data: allProfiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, employee_code, work_email, full_name, account_status, employment_status');
  if (pErr) throw pErr;

  console.log(`Total current profiles in database: ${allProfiles.length}`);

  // Safety Gate: Check all protected accounts exist
  const protectedFound = allProfiles.filter(p => PROTECTED_ACCOUNTS.includes(p.employee_code));
  console.log(`Protected accounts detected: ${protectedFound.length} of ${PROTECTED_ACCOUNTS.length}`);
  if (protectedFound.length !== PROTECTED_ACCOUNTS.length) {
    throw new Error(`ABORT: Expected ${PROTECTED_ACCOUNTS.length} protected accounts, found ${protectedFound.length}`);
  }

  // Safety Gate: Match target accounts strictly by BOTH employee_code and email
  const targetsToDelete = [];
  for (const target of TARGET_OLD_ACCOUNTS) {
    const match = allProfiles.find(
      p => p.employee_code === target.employee_code && p.work_email?.toLowerCase() === target.email.toLowerCase()
    );
    if (!match) {
      console.warn(`Target account not found or already deleted: ${target.employee_code} (${target.email})`);
    } else {
      targetsToDelete.push(match);
    }
  }

  console.log(`Target accounts matched for deletion: ${targetsToDelete.length} of ${TARGET_OLD_ACCOUNTS.length}`);
  if (targetsToDelete.length === 0) {
    console.log('No targets found to delete. Exiting.');
    return;
  }

  // Double check no protected account is in targetsToDelete
  for (const t of targetsToDelete) {
    if (PROTECTED_ACCOUNTS.includes(t.employee_code)) {
      throw new Error(`CRITICAL ABORT: Protected account ${t.employee_code} found in target deletion list!`);
    }
  }

  const targetIds = targetsToDelete.map(t => t.id);

  console.log('\n--- Step 1: Pre-cleanup of dependent rows on target IDs ---');
  // Clear notifications
  const { error: notifErr } = await supabase.from('notifications').delete().in('user_id', targetIds);
  if (notifErr) console.warn('Warning deleting notifications:', notifErr.message);
  else console.log('Deleted notifications referencing target accounts.');

  // Clear self-referencing reporting_lead_id in profiles
  const { error: leadErr } = await supabase.from('profiles').update({ reporting_lead_id: null }).in('id', targetIds);
  if (leadErr) console.warn('Warning clearing reporting_lead_id:', leadErr.message);
  else console.log('Cleared reporting_lead_id for target accounts.');

  console.log('\n--- Step 2: Delete auth.users via Supabase Admin API ---');
  const deletionResults = [];
  for (const target of targetsToDelete) {
    console.log(`Deleting Auth user: ${target.employee_code} - ${target.work_email} (${target.id})...`);
    const { error: delErr } = await supabase.auth.admin.deleteUser(target.id);
    if (delErr) {
      console.error(`Error deleting auth user ${target.employee_code}:`, delErr);
      deletionResults.push({ ...target, status: 'FAILED', error: delErr.message });
    } else {
      console.log(`Successfully deleted auth user: ${target.employee_code}`);
      deletionResults.push({ ...target, status: 'DELETED' });
    }
  }

  console.log('\n--- Step 3: Check remaining profile rows (CASCADE verification) ---');
  const { data: remainingProfiles, error: rpErr } = await supabase
    .from('profiles')
    .select('id, employee_code, work_email, full_name, account_status, employment_status')
    .order('employee_code', { ascending: true });
  if (rpErr) throw rpErr;

  const orphanProfiles = remainingProfiles.filter(p => targetIds.includes(p.id));
  if (orphanProfiles.length > 0) {
    console.log(`Found ${orphanProfiles.length} orphan profiles not automatically cascaded. Deleting directly...`);
    const { error: delPErr } = await supabase.from('profiles').delete().in('id', orphanProfiles.map(p => p.id));
    if (delPErr) console.error('Error deleting orphan profiles:', delPErr);
    else console.log('Successfully cleaned orphan profiles.');
  } else {
    console.log('Auth CASCADE successfully removed corresponding profile rows.');
  }

  console.log('\n--- Step 4: Verification of Final Workforce ---');
  const { data: finalProfiles, error: fpErr } = await supabase
    .from('profiles')
    .select('id, employee_code, work_email, full_name, account_status, employment_status')
    .order('employee_code', { ascending: true });
  if (fpErr) throw fpErr;

  const { data: finalAuthUsers, error: faErr } = await supabase.auth.admin.listUsers({ perPage: 100 });
  if (faErr) throw faErr;

  const { data: finalRoles, error: frErr } = await supabase.from('user_roles').select('*');
  if (frErr) console.warn('Warning fetching user_roles:', frErr.message);

  const roleMap = new Map();
  (finalRoles || []).forEach(r => roleMap.set(r.user_id, r.role));

  console.log(`\nFinal Profile Count: ${finalProfiles.length}`);
  console.log(`Final Auth Users Count: ${finalAuthUsers.users.length}`);
  console.log(`Final user_roles Rows: ${finalRoles?.length ?? 'N/A'}`);

  console.table(
    finalProfiles.map(p => ({
      Code: p.employee_code,
      Name: p.full_name,
      Email: p.work_email,
      Role: roleMap.get(p.id) || 'UNKNOWN',
      Status: p.employment_status,
    }))
  );

  console.log('\nDeletion Summary:');
  console.table(deletionResults);

  // Write audit record of deletion
  const dirPath = path.resolve(process.cwd(), 'docs/account-audit');
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  const auditPath = path.resolve(dirPath, `deletion_audit_${Date.now()}.json`);
  fs.writeFileSync(
    auditPath,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        deletedCount: deletionResults.filter(r => r.status === 'DELETED').length,
        deletionResults,
        remainingProfilesCount: finalProfiles.length,
        remainingAuthUsersCount: finalAuthUsers.users.length,
        remainingUserRolesCount: finalRoles?.length ?? 0,
        finalWorkforce: finalProfiles.map(p => ({
          ...p,
          role: roleMap.get(p.id) || 'UNKNOWN',
        })),
      },
      null,
      2
    )
  );
  console.log(`\nSaved deletion audit log to: ${auditPath}`);
}

runPermanentDeletion().catch(err => {
  console.error('Fatal error during deletion execution:', err);
  process.exit(1);
});
