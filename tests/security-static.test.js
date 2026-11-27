'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  if (entry.name === '.git') return [];
  return entry.isDirectory() ? walk(full) : [full];
});

const account = read('account.js');
const auth = read('auth.js');
const migration = read('security_hardening.sql');
const files = walk(root);
const html = files.filter(file => file.endsWith('.html'));

assert.match(account, /client\.rpc\('secure_sync_progress'/);
assert.doesNotMatch(account, /client\.rpc\('(?:add_cents|sync_progress)'/);
assert.match(account, /meta\.pending = pending/);
assert.match(account, /crypto\.randomUUID/);
assert.match(auth, /new URL\('index\.html', window\.location\.href\)/);

for (const file of html) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /http-equiv=["']Content-Security-Policy["']/i,
    `${path.relative(root, file)} is missing its CSP`);
  assert.match(source, /name=["']referrer["'][^>]+no-referrer/i,
    `${path.relative(root, file)} is missing its referrer policy`);
  assert.doesNotMatch(source, /@supabase\/supabase-js@2["']/,
    `${path.relative(root, file)} uses an unpinned Supabase dependency`);
  for (const match of source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    assert.doesNotThrow(() => new Function(match[1]),
      `${path.relative(root, file)} contains invalid inline JavaScript`);
  }
}

assert.match(migration, /enable row level security/gi);
assert.match(migration, /grant update \(username\)/i);
assert.match(migration, /capycoin_claims/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /50000 - v_daily_used/);
assert.match(migration, /proname in \('add_cents', 'sync_progress'\)/);

for (const file of files.filter(file => file !== __filename && /\.(?:js|html|sql)$/.test(file))) {
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /service[_-]?role/i,
    `${path.relative(root, file)} appears to contain a service-role secret`);
}

console.log(`security static checks passed (${html.length} HTML files)`);
