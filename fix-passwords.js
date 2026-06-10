// // fix-passwords.js
// const bcrypt = require('bcrypt');
// const db = require('./config/db');

// async function fixPasswords() {
//     console.log('=================================');
//     console.log('FIXING PASSWORDS');
//     console.log('=================================');
    
//     try {
//         // Generate a fresh hash for 'password123'
//         const password = 'password123';
//         const hashedPassword = await bcrypt.hash(password, 10);
        
//         console.log('\nGenerated hash:', hashedPassword);
//         console.log('Length:', hashedPassword.length);
        
//         // List all users
//         console.log('\nCurrent users:');
//         const [users] = await db.execute('SELECT id, username, role FROM users');
//         users.forEach(u => {
//             console.log(`   ${u.username} (${u.role})`);
//         });
        
//         // Update all users with the new hash
//         console.log('\nUpdating passwords...');
//         for (const user of users) {
//             await db.execute(
//                 'UPDATE users SET password_hash = ? WHERE id = ?',
//                 [hashedPassword, user.id]
//             );
//             console.log(`   ✅ Updated: ${user.username}`);
//         }
        
//         // Verify the passwords work
//         console.log('\nVerifying passwords...');
//         let allGood = true;
        
//         for (const user of users) {
//             const [rows] = await db.execute('SELECT password_hash FROM users WHERE id = ?', [user.id]);
//             const storedHash = rows[0].password_hash;
//             const match = await bcrypt.compare(password, storedHash);
            
//             console.log(`   ${user.username}: ${match ? '✅ OK' : '❌ FAILED'}`);
//             if (!match) allGood = false;
//         }
        
//         if (allGood) {
//             console.log('\n✅ ALL PASSWORDS FIXED!');
//             console.log('\n🔐 Login credentials:');
//             console.log('   Username: ANY of the users above');
//             console.log('   Password: password123');
//         } else {
//             console.log('\n❌ Some passwords still not working');
//         }
        
//     } catch (error) {
//         console.error('Error:', error);
//     } finally {
//         await db.end();
//         process.exit();
//     }
// }

// fixPasswords();


// fix-passwords.js
const bcrypt = require('bcrypt');
const db = require('./config/db');

async function fixPasswords() {
    console.log('=================================');
    console.log('FIXING PASSWORDS & ADDING USERS');
    console.log('=================================\n');
    
    try {
        // Password hash for 'password123'
        const passwordHash = '$2b$10$9.CSzsBNxNSNsUVDcxrYluRJWn8i3WouCkBaSLOr0ldbVOM2FBclu';
        
        // Get current users
        console.log('Current users:');
        const [currentUsers] = await db.execute('SELECT id, username, role FROM users');
        if (currentUsers.length > 0) {
            currentUsers.forEach(u => {
                console.log(`   ${u.id}: ${u.username} (${u.role})`);
            });
        } else {
            console.log('   No users found');
        }
        
        // Define all required users
        const requiredUsers = [
            { username: 'hod', role: 'hod', email: 'victor.malanga@octagonafrica.com', department: 'ICT' },
            { username: 'finance', role: 'finance', email: 'waswa2002brian@gmail.com', department: 'Finance' },
            { username: 'director', role: 'director', email: 'director@example.com', department: 'Executive' },
            { username: 'staff', role: 'staff', email: 'brian.wekesa@octagonafrica.com', department: 'ICT' },
            { username: 'brian', role: 'director', email: 'prevailer.muhani@octagonafrica.com', department: 'Executive' }
        ];
        
        console.log('\n=================================');
        console.log('Adding/Updating users...');
        console.log('=================================');
        
        for (const user of requiredUsers) {
            try {
                // Check if user exists
                const [existing] = await db.execute('SELECT * FROM users WHERE username = ?', [user.username]);
                
                if (existing.length === 0) {
                    // Insert new user
                    await db.execute(
                        'INSERT INTO users (username, password_hash, role, email, department) VALUES (?, ?, ?, ?, ?)',
                        [user.username, passwordHash, user.role, user.email, user.department]
                    );
                    console.log(`✅ Created: ${user.username} (${user.role})`);
                } else {
                    // Update existing user's password
                    await db.execute(
                        'UPDATE users SET password_hash = ?, role = ?, email = ?, department = ? WHERE username = ?',
                        [passwordHash, user.role, user.email, user.department, user.username]
                    );
                    console.log(`🔄 Updated: ${user.username} (${user.role})`);
                }
            } catch (err) {
                console.error(`❌ Error with ${user.username}:`, err.message);
            }
        }
        
        // Show final users
        console.log('\n=================================');
        console.log('FINAL USERS IN DATABASE:');
        console.log('=================================');
        const [finalUsers] = await db.execute('SELECT id, username, role FROM users ORDER BY id');
        finalUsers.forEach(u => {
            console.log(`   ${u.id}: ${u.username.padEnd(15)} ${u.role}`);
        });
        
        // Test passwords
        console.log('\n=================================');
        console.log('TESTING PASSWORDS:');
        console.log('=================================');
        for (const user of finalUsers) {
            const [userData] = await db.execute('SELECT password_hash FROM users WHERE id = ?', [user.id]);
            const match = await bcrypt.compare('password123', userData[0].password_hash);
            console.log(`   ${user.username}: ${match ? '✅ Password works' : '❌ Password FAILED'}`);
        }
        
        console.log('\n=================================');
        console.log('✅ SETUP COMPLETE!');
        console.log('=================================');
        console.log('\n🔐 LOGIN CREDENTIALS:');
        console.log('   Password: password123');
        console.log('   Usernames:');
        finalUsers.forEach(u => {
            console.log(`     - ${u.username} (${u.role})`);
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await db.end();
        process.exit();
    }
}

fixPasswords();