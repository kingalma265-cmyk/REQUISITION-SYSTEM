require('dotenv').config();
const db = require('./config/db');

const expectedUsers = [
  { email: 'victor.malanga@octagonafrica.com', role: 'hod', department: 'ICT' },
  { email: 'francis.kangethe@octagonafrica.com', role: 'hod', department: 'Operations' },
  { email: 'waswa2002brian@gmail.com', role: 'finance', department: 'Finance' },
  { email: 'director@example.com', role: 'director', department: 'Executive' },
  { email: 'brian.wekesa@octagonafrica.com', role: 'staff', department: 'IT' }
];

async function fixUsers() {
  try {
    console.log('Scanning users table...');
    const [users] = await db.execute('SELECT id, username, email, role, department FROM users ORDER BY id');
    console.table(users.map(u => ({ id: u.id, username: u.username, email: u.email, role: u.role, department: u.department })));

    console.log('\n1) Normalizing role to lowercase for all users...');
    await db.execute('UPDATE users SET role = LOWER(role)');

    console.log('2) Fixing usernames that look like role names (e.g. "staff","finance","hod","director")');
    const roleLike = ['staff', 'finance', 'hod', 'director'];
    for (const r of roleLike) {
      const [rows] = await db.execute('SELECT id, email, username, role FROM users WHERE username = ?', [r]);
      if (rows.length > 0) {
        for (const row of rows) {
          const newUsername = row.email ? row.email.split('@')[0] : row.username;
          console.log(` - Updating id=${row.id} username=${row.username} -> ${newUsername}`);
          await db.execute('UPDATE users SET username = ? WHERE id = ?', [newUsername, row.id]);
        }
      }
    }

    console.log('\n3) Ensuring username fallback: if username is missing, set from email local-part');
    await db.execute("UPDATE users SET username = SUBSTRING_INDEX(email, '@', 1) WHERE username IS NULL OR username = ''");

    console.log('\n4) Adding missing expected accounts or correcting their roles/departments');
    const passwordHash = '$2b$10$9.CSzsBNxNSNsUVDcxrYluRJWn8i3WouCkBaSLOr0ldbVOM2FBclu';
    for (const expected of expectedUsers) {
      const [rows] = await db.execute('SELECT id, email, username, role, department FROM users WHERE email = ?', [expected.email]);
      const username = expected.email.split('@')[0];
      if (rows.length === 0) {
        console.log(` - Inserting missing account: ${expected.email} (${expected.role})`);
        await db.execute(
          'INSERT INTO users (username, email, password_hash, role, department, must_reset_password) VALUES (?, ?, ?, ?, ?, 1)',
          [username, expected.email, passwordHash, expected.role, expected.department]
        );
      } else {
        console.log(` - Updating existing account: ${expected.email} -> role=${expected.role}, department=${expected.department}`);
        await db.execute(
          'UPDATE users SET username = ?, role = ?, department = ? WHERE id = ?',
          [username, expected.role, expected.department, rows[0].id]
        );
      }
    }

    console.log('\nFinal users:');
    const [final] = await db.execute('SELECT id, username, email, role, department FROM users ORDER BY id');
    console.table(final.map(u => ({ id: u.id, username: u.username, email: u.email, role: u.role, department: u.department })));

    console.log('\nDone. Please restart the server and clear browser cookies (or use an incognito window) before testing logins again.');
  } catch (err) {
    console.error('Error fixing users:', err);
  } finally {
    await db.end();
    process.exit();
  }
}

fixUsers();
