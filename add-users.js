const bcrypt = require('bcrypt');
const db = require('./config/db');

const newUsers = [
    {
        // username: 'john.doe',
        email: 'brian.wekesa@octagonafrica.com',
        role: 'staff',
        department: 'IT',
        tempPassword: 'TempPass123!'
    },
     {
        // username: 'john.doe',
        email: 'francis.kangethe@octagonafrica.com',
        role: 'hod',
        department: 'Operations',
        tempPassword: 'TempPass123!'
    },
    {
        // username: 'jane.smith',
        email: 'victor.malanga@octagonafrica.com',
        role: 'hod',
        department: 'IT',
        tempPassword: 'password123!'
    },
     {
        // username: 'jane.smith',
        email: 'prevailer.muhani@octagonafrica.com',
        role: 'hod',
        department: 'Finance',
        tempPassword: 'password123!'
    },
    {
        // username: 'jane.smith',
        email: 'waswa2002brian@gmail.com',
        role: 'director',
        department: 'operations',
        tempPassword: 'password123!'
    }
];

async function addUsers() {
    try {
        for (const user of newUsers) {
            const username = user.email.split('@')[0];
            const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [user.email]);
            const passwordHash = await bcrypt.hash(user.tempPassword, 10);

            if (existing.length === 0) {
                await db.execute(
                    'INSERT INTO users (username, email, password_hash, role, department, must_reset_password) VALUES (?, ?, ?, ?, ?, ?)',
                    [username, user.email, passwordHash, user.role, user.department, 1]
                );
                console.log(`Created user ${user.email} with temporary password: ${user.tempPassword}`);
            } else {
                await db.execute(
                    'UPDATE users SET username = ?, role = ?, department = ?, password_hash = ?, must_reset_password = 1 WHERE email = ?',
                    [username, user.role, user.department, passwordHash, user.email]
                );
                console.log(`Updated existing user ${user.email} and set password reset required.`);
            }
        }
    } catch (err) {
        console.error('Error adding users:', err);
    } finally {
        await db.end();
        process.exit();
    }
}

addUsers();
