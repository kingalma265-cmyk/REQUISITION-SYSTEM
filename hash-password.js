// hash-password.js
const bcrypt = require('bcrypt');
const db = require('./config/db');

async function setupUsers() {
    console.log('=================================');
    console.log('USER SETUP SCRIPT');
    console.log('=================================');
    
    try {
        const password = 'password123';
        console.log('\n1. Generating password hash...');
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log('   Hash:', hashedPassword);
        
        // Define users to create/update
        const users = [
            { username: 'hod', role: 'hod', email: 'victor.malanga@octagonafrica.com', department: 'ICT' },
            { username: 'finance', role: 'finance', email: 'waswa2002brian@gmail.com', department: 'Finance' },
            { username: 'director', role: 'director', email: 'director@example.com', department: 'Executive' },
            { username: 'staff', role: 'staff', email: 'brian.wekesa@octagonafrica.com', department: 'ICT' },
            { username: 'brian', role: 'director', email: 'prevailer.muhani@octagonafrica.com', department: 'Executive' }
        ];
        
        console.log('\n2. Updating/Creating users...');
        
        for (const user of users) {
            try {
                // Check if user exists
                const [existing] = await db.execute(
                    'SELECT * FROM users WHERE username = ?',
                    [user.username]
                );
                
                if (existing.length === 0) {
                    // Insert new user
                    await db.execute(
                        'INSERT INTO users (username, password_hash, role, email, department) VALUES (?, ?, ?, ?, ?)',
                        [user.username, hashedPassword, user.role, user.email, user.department]
                    );
                    console.log(`   ✓ Created user: ${user.username} (${user.role})`);
                } else {
                    // Update existing user's password
                    await db.execute(
                        'UPDATE users SET password_hash = ?, role = ?, email = ?, department = ? WHERE username = ?',
                        [hashedPassword, user.role, user.email, user.department, user.username]
                    );
                    console.log(`   ✓ Updated user: ${user.username} (${user.role})`);
                }
            } catch (err) {
                console.log(`   ✗ Error with user ${user.username}:`, err.message);
            }
        }
        
        // Verify all users
        console.log('\n3. Verifying users...');
        const [allUsers] = await db.execute(
            'SELECT id, username, role, LENGTH(password_hash) as hash_length FROM users ORDER BY id'
        );
        
        console.log('\n   Current users in database:');
        allUsers.forEach(user => {
            console.log(`   - ${user.username} (${user.role}) - Password hash length: ${user.hash_length}`);
        });
        
        console.log('\n=================================');
        console.log('✅ SETUP COMPLETE!');
        console.log('=================================');
        console.log('\n🔐 Login with these credentials:');
        console.log('   Username: hod');
        console.log('   Username: finance');
        console.log('   Username: director');
        console.log('   Username: staff');
        console.log('   Username: brian');
        console.log('   Password: password123');
        console.log('\n=================================');
        
        // Test login for HOD
        console.log('\n4. Testing HOD login...');
        const [hodUser] = await db.execute('SELECT * FROM users WHERE username = ?', ['hod']);
        if (hodUser.length > 0) {
            const testMatch = await bcrypt.compare('password123', hodUser[0].password_hash);
            console.log(`   HOD login test: ${testMatch ? '✓ SUCCESS' : '✗ FAILED'}`);
        }
        
    } catch (error) {
        console.error('\n❌ ERROR:', error);
        console.error('Error details:', error.message);
    } finally {
        await db.end(); // Close connection
        process.exit();
    }
}

setupUsers();