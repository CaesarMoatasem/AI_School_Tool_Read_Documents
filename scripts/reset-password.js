'use strict';
/* Usage: npm run reset-password -- someone@example.com NewPassword123 */
const fs = require('fs');
const path = require('path');

try {
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !/^\s*#/.test(line) && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  });
} catch (e) { /* no .env file */ }

const { createFirestoreStore } = require('../store');
const { hashPassword } = require('../password');

(async () => {
  const [email, newPassword] = process.argv.slice(2);
  if (!email || !newPassword || newPassword.length < 8) {
    console.error('Usage: npm run reset-password -- <email> <new password of at least 8 characters>');
    process.exit(1);
  }
  const store = createFirestoreStore(process.env);
  const user = await store.getUserByEmail(email.trim().toLowerCase());
  if (!user) {
    console.error('No account with that email.');
    process.exit(1);
  }
  await store.setUserPassword(user.id, hashPassword(newPassword));
  await store.deleteSessionsForUser(user.id);
  console.log('Password updated. The user has been logged out everywhere.');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
