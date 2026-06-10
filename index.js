    require('dotenv').config();
    const express = require('express');
    const session = require('express-session');
    const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./config/db');
const path = require('path');
const { sendNotification, sendPasswordResetEmail } = require('./utils/mailer');
    const ejs = require('ejs');
    const http = require('http');
    const puppeteer = require('puppeteer-core');
    const { execSync } = require('child_process');

    // Dynamically locate Chromium (works across nix hash changes)
    function findChromium() {
        if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
        try {
            const found = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null || echo ""').toString().trim();
            if (found) return found;
        } catch(e) {}
        // fallback: search nix store
        try {
            const nixPath = execSync('find /nix/store -maxdepth 3 -name "chromium" -type f 2>/dev/null | head -1').toString().trim();
            if (nixPath) return nixPath;
        } catch(e) {}
        return null;
    }
    const CHROMIUM_EXEC = findChromium();
    console.log('Chromium path:', CHROMIUM_EXEC || 'NOT FOUND');
    
    // Load and encode logo as base64 for embedding in PDFs
    const fs = require('fs');
    const bitmap = fs.readFileSync(path.join(__dirname, 'public/Images/octagon-logo.png'));
    const logoBase64 = Buffer.from(bitmap).toString('base64');

        
    const app = express();
    const hostname = '0.0.0.0';
    const port = process.env.PORT || 5000;
    const multer = require('multer');
    const { triggerWorkflowEmail } = require('./utils/notifications');
    

    // Configure how files are stored
    const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/signatures/'); // Make sure this folder exists!
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

    const upload = multer({ storage: storage });

    // Helper function to parse requisition data
    function parseRequisition(requisition) {
        if (!requisition) return requisition;
        
        const parsed = { ...requisition };
        
        // Parse items
        if (parsed.items) {
            if (typeof parsed.items === 'string') {
                try {
                    parsed.items = JSON.parse(parsed.items);
                } catch(e) {
                    parsed.items = [];
                }
            }
        } else {
            parsed.items = [];
        }

        parsed.items = parsed.items.map(item => {
            const normalizedItem = {
                ...item,
                qty: Number(item.qty) || 0,
                unitPrice: Number(item.unitPrice) || 0,
                total: Number(item.total) || 0,
                vat: Number(item.vat) || 0,
                costCentre: item.costCentre || item.costCentre === '' ? item.costCentre : 'N/A'
            };

            if (!normalizedItem.vat && normalizedItem.qty && normalizedItem.unitPrice) {
                const base = normalizedItem.qty * normalizedItem.unitPrice;
                const computedVat = base * 0.16;
                normalizedItem.vat = Number(computedVat.toFixed(2));
            }

            return normalizedItem;
        });
        
        // Parse history
        if (parsed.history) {
            if (typeof parsed.history === 'string') {
                try {
                    parsed.history = JSON.parse(parsed.history);
                } catch(e) {
                    parsed.history = [];
                }
            }
        } else {
            parsed.history = [];
        }
        
        return parsed;
    }

    //SETTINGS
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    //STANDARD MIDDLEWARE
    app.use(express.static('public'));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    app.use(express.json({ limit: '50mb' }));
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

    const ensureResetColumns = async () => {
        const alterStatements = [
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token VARCHAR(255) DEFAULT NULL`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMP DEFAULT NULL`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password SMALLINT NOT NULL DEFAULT 0`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(6) DEFAULT NULL`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires TIMESTAMP DEFAULT NULL`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_path VARCHAR(255) DEFAULT NULL`
        ];
        for (const stmt of alterStatements) {
            try {
                await db.execute(stmt);
            } catch (e) {
                // Ignore if column already exists
            }
        }
        console.log('DB: ensured password reset and OTP columns exist.');
    };

    ensureResetColumns();
    
    //SESSION INITIALIZATION
    app.use(session({
        secret: process.env.SESSION_SECRET || 'octagon_secret_key_2026',
        resave: false,
        saveUninitialized: false,
        cookie: { 
            maxAge: 3600000,
            httpOnly: true,
            secure: false
        },
        name: 'octagon_session'
    }));

    //GLOBAL MIDDLEWARE
   
        app.use((req, res, next) => {
            res.locals.user = (req.session && req.session.userId) ? 
                { 
                    username: req.session.username, 
                    role: req.session.role,
                    department: req.session.department,
                    id: req.session.userId 
                } : null;
            
            next();
        });


        
    // ACCESS CONTROL MIDDLEWARE
    const isAuthenticated = (req, res, next) => {
        if (req.session && req.session.userId) {
            return next();
        }
        req.session.returnTo = req.originalUrl;
        res.redirect('/login');
    };


//Authorize role
    const authorize = (role) => {
        return (req, res, next) => {
            if (req.session && req.session.role === role) {
                return next();
            }
            res.status(403).send(`
                <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                    <h1 style="color:#b91c1c;font-family:sans-serif;font-size:24px;">Access Denied!!</h1>
                    <p>You do not have permission to view the ${role} dashboard.</p>
                    <p>Your role: ${req.session?.role || 'Not logged in'}</p>
                    <a href="/">Go Back to Home</a>
                </div>
            `);
        };
    };

    function redirectToDashboard(role, res) {
        switch(role) {
            case 'hod':
                return res.redirect('/hod/dashboard');
            case 'finance':
                return res.redirect('/finance/dashboard');
            case 'director':
                return res.redirect('/director/dashboard');
            default:
                return res.redirect('/home');
        }
    }

    // AUTHENTICATION ROUTES
    //Login
//     app.get('/login', (req, res) => {
//     if (req.session && req.session.userId) {
//         return redirectToDashboard(req.session.role, res);
//     }
//     res.render('login', { error: null });
// });

app.get('/login', (req, res) => {
    if (req.session && req.session.userId) {
        return redirectToDashboard(req.session.role, res);
    }
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    // 1. Get email and password from the form, trim whitespace
    const { email, password } = req.body;
    const trimmedEmail = email ? email.trim() : '';
    const trimmedPassword = password ? password.trim() : '';

    console.log('\n=================================');
    console.log(`Login attempt for: ${trimmedEmail}`);
    console.log('=================================');
    
    // Check if input exists
    if (!trimmedEmail || !trimmedPassword) {
        return res.render('login', { error: "Please enter both email and password" });
    }
    
    try {
        // 2. Query the DB using email only
        const [rows] = await db.execute(
            'SELECT * FROM users WHERE email = ?',
            [trimmedEmail]
        );
        const user = rows[0];
        
        if (!user) {
            console.log(`❌ User not found for email: ${trimmedEmail}`);
            return res.render('login', { error: "Invalid email or password" });
        }
        
        // Check if password hash exists
        if (!user.password_hash) {
            console.log(`❌ No password hash for user: ${trimmedEmail}. Run hash-password.js to set up users.`);
            return res.render('login', { error: "Account not properly initialized. Contact administrator." });
        }
        
        // 3. Compare passwords
        const passwordMatch = await bcrypt.compare(trimmedPassword, user.password_hash);
        console.log(`Password match: ${passwordMatch}`);
        
        if (passwordMatch) {
            
            // This turns "brian.wekesa@octagonafrica.com" into "Brian Wekesa"
            const displayName = trimmedEmail.split('@')[0]
                .split('.')
                .map(name => name.charAt(0).toUpperCase() + name.slice(1))
                .join(' ');

            req.session.userId = user.id;
            req.session.role = user.role;
            
            // FIX: Explicitly save the lowercase username for database query consistency (e.g. "brian.wekesa")
            req.session.username = user.username; 
            
            // NEW: Add a separate variable strictly for UI layout headers/welcomes
            req.session.displayName = displayName; 
            
            req.session.department = user.department;

            // Save the user's signature path directly into the session 
            req.session.signaturePath = user.signature_path || null;

            if (user.must_reset_password) {
                return res.redirect('/change-password');
            }

            console.log(`✅ Login successful for database identity: ${user.username} (${displayName})`);
            
            const returnTo = req.session.returnTo || '/';
            delete req.session.returnTo;
            return redirectToDashboard(user.role, res);
        }
        
        console.log('❌ Invalid password');
        res.render('login', { error: "Invalid email or password" });
        
    } catch (err) {
        console.error('❌ Login error:', err);
        res.render('login', { error: "A server error occurred. Please try again." });
    }
});
//const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
    // Forgot Password - Display form
    app.get('/forgot-password', (req, res) => {
        res.render('forgot_password', { error: null, message: null, resetEmail: '' });
    });

    const OTP_RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds cooldown

    app.get('/forgot-password/verify', (req, res) => {
        const email = req.session.otpResetEmail;
        const otpPending = req.session.otpReset;
        const resendAllowedAt = req.session.otpResendAllowedAt || 0;

        if (!otpPending || !email) {
            return res.redirect('/login');
        }

        // Allow only a single direct render; refresh should require re-starting flow.
        req.session.otpReset = false;

        res.render('forgot_password', {
            error: null,
            message: 'If an account exists for this email, an OTP has been sent. Please verify.',
            resetEmail: email,
            resendAllowedAt
        });
    });

    app.get('/forgot-password/resend', async (req, res) => {
        const email = req.session.otpResetEmail;
        const now = Date.now();
        const resendAllowedAt = req.session.otpResendAllowedAt || 0;

        if (!email) {
            return res.redirect('/login');
        }

        if (now < resendAllowedAt) {
            return res.render('forgot_password', {
                error: `Please wait ${Math.ceil((resendAllowedAt - now) / 1000)} seconds before resending.`,
                message: 'If an account exists for this email, an OTP has been sent. Please verify.',
                resetEmail: email,
                resendAllowedAt
            });
        }

        try {
            const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
            const user = rows[0];

            if (user) {
                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
                const tempPassword = crypto.randomBytes(4).toString('hex');

                await db.execute(
                    'UPDATE users SET otp_code = ?, otp_expires = ?, must_reset_password = 1 WHERE id = ?',
                    [otp, otpExpires, user.id]
                );

                const emailResult = await sendPasswordResetEmail(user.email, otp, tempPassword);
                if (!emailResult.success) {
                    console.error('Error sending OTP email:', emailResult.error);
                }
            }

            req.session.otpReset = true;
            req.session.otpResendAllowedAt = Date.now() + OTP_RESEND_COOLDOWN_MS;
            return res.redirect('/forgot-password/verify');
        } catch (err) {
            console.error('Resend OTP error:', err);
            res.render('forgot_password', {
                error: 'Unable to resend OTP. Please try again.',
                message: 'If an account exists for this email, an OTP has been sent. Please verify.',
                resetEmail: email || '',
                resendAllowedAt
            });
        }
    });

    // Forgot Password - Handle form submission
    app.post('/forgot-password', async (req, res) => {
        const { email } = req.body;

        if (!email) {
            return res.render('forgot_password', { error: 'Please enter your email address', message: null, resetEmail: '' });
        }

        const trimmedEmail = email.trim();
        req.session.otpResetEmail = trimmedEmail;
        req.session.otpReset = true;

        try {
            const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [trimmedEmail]);
            const user = rows[0];

            if (user) {
                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
                const tempPassword = crypto.randomBytes(4).toString('hex');

                await db.execute(
                    'UPDATE users SET otp_code = ?, otp_expires = ?, must_reset_password = 1 WHERE id = ?',
                    [otp, otpExpires, user.id]
                );

                const emailResult = await sendPasswordResetEmail(user.email, otp, tempPassword);
                if (!emailResult.success) {
                    console.error('Error sending OTP email:', emailResult.error);
                }
            }

            req.session.otpResendAllowedAt = Date.now() + OTP_RESEND_COOLDOWN_MS;
            return res.redirect('/forgot-password/verify');
        } catch (err) {
            console.error('Forgot password error:', err);
            return res.render('forgot_password', { error: 'An error occurred. Please try again.', message: null, resetEmail: trimmedEmail });
        }
    });

    app.get('/verify-otp', (req, res) => {
        return res.redirect('/forgot-password/verify');
    });

    // Verify OTP - redirects to reset-password with token on success
    app.post('/verify-otp', async (req, res) => {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.render('forgot_password', {
                error: 'Please enter the OTP sent to your email.',
                message: 'If an account exists for this email, an OTP has been sent. Please verify.',
                resetEmail: email || ''
            });
        }

        try {
            const [rows] = await db.execute(
                'SELECT * FROM users WHERE email = ? AND otp_code = ? AND otp_expires > NOW()',
                [email.trim(), otp.trim()]
            );
            const user = rows[0];

            if (!user) {
                return res.render('forgot_password', {
                    error: 'Invalid or expired OTP. Please request a new one.',
                    message: 'If an account exists for this email, an OTP has been sent. Please verify.',
                    resetEmail: email
                });
            }

            // OTP verified - create reset token and clear OTP
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

            await db.execute(
                'UPDATE users SET otp_code = NULL, otp_expires = NULL, reset_password_token = ?, reset_password_expires = ?, must_reset_password = 1 WHERE id = ?',
                [resetToken, resetExpires, user.id]
            );

            res.redirect(`/reset-password/${resetToken}`);
        } catch (err) {
            console.error('OTP verification error:', err);
            res.render('forgot_password', {
                error: 'An error occurred. Please try again.',
                message: 'If an account exists for this email, an OTP has been sent. Please verify.',
                resetEmail: email
            });
        }
    });

    app.get('/reset-password/:token', async (req, res) => {
        const { token } = req.params;

        try {
            const [rows] = await db.execute(
                'SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()',
                [token]
            );
            const user = rows[0];

            if (!user) {
                return res.render('reset_password', { error: 'Reset link is invalid or has expired.', formAction: '/change-password', token: '' });
            }

            res.render('reset_password', { error: null, formAction: `/reset-password/${token}`, token });
        } catch (err) {
            console.error('Reset password token validation error:', err);
            res.render('reset_password', { error: 'An error occurred. Please try again.', formAction: '/change-password', token: '' });
        }
    });

    app.post('/reset-password/:token', async (req, res) => {
        const { token } = req.params;
        const { password, confirmPassword } = req.body;

        if (!password || !confirmPassword) {
            return res.render('reset_password', { error: 'Please fill in both password fields.', formAction: `/reset-password/${token}`, token });
        }

        if (password !== confirmPassword) {
            return res.render('reset_password', { error: 'Passwords do not match.', formAction: `/reset-password/${token}`, token });
        }

        if (password.length < 8) {
            return res.render('reset_password', { error: 'Password must be at least 8 characters long.', formAction: `/reset-password/${token}`, token });
        }

        try {
            const [rows] = await db.execute(
                'SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()',
                [token]
            );
            const user = rows[0];

            if (!user) {
                return res.render('reset_password', { error: 'Reset link is invalid or has expired.', formAction: '/change-password', token: '' });
            }

            const passwordHash = await bcrypt.hash(password, 10);
            await db.execute(
                'UPDATE users SET password_hash = ?, must_reset_password = 0, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?',
                [passwordHash, user.id]
            );

            res.redirect('/login');
        } catch (err) {
            console.error('Reset password update error:', err);
            res.render('reset_password', { error: 'Unable to update password. Please try again.', formAction: `/reset-password/${token}`, token });
        }
    });

    app.get('/change-password', isAuthenticated, (req, res) => {
        res.render('reset_password', { error: null, formAction: '/change-password' });
    });

    app.post('/change-password', isAuthenticated, async (req, res) => {
        const { password, confirmPassword } = req.body;

        if (!password || !confirmPassword) {
            return res.render('reset_password', { error: 'Please fill in both password fields.', formAction: '/change-password' });
        }

        if (password !== confirmPassword) {
            return res.render('reset_password', { error: 'Passwords do not match.', formAction: '/change-password' });
        }

        if (password.length < 8) {
            return res.render('reset_password', { error: 'Password must be at least 8 characters long.', formAction: '/change-password' });
        }

        try {
            const passwordHash = await bcrypt.hash(password, 10);
            await db.execute(
                'UPDATE users SET password_hash = ?, must_reset_password = 0 WHERE id = ?',
                [passwordHash, req.session.userId]
            );
            res.redirect('/home');
        } catch (err) {
            console.error('Password update error:', err);
            res.render('reset_password', { error: 'Unable to update password. Please try again.', formAction: '/change-password' });
        }
    });

    //Logout
    app.get('/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) {
                console.log("Logout error:", err);
            }
            res.clearCookie('octagon_session');
            res.redirect('/login');
        });
    });

    // ROOT ROUTE
    app.get('/', isAuthenticated, (req, res) => {
        redirectToDashboard(req.session.role, res);
    });

    // STAFF ROUTES
    app.get('/home', isAuthenticated, async (req, res) => {
        try {
            const [rows] = await db.execute(
                'SELECT * FROM requisitions ORDER BY requestDate DESC LIMIT 50'
            );
            
            // Parse JSON fields like history and items using existing helper
            const parsedRows = rows.map(r => parseRequisition(r));
            
            res.render('index', { 
                currentPage: 'new', 
                requisitions: parsedRows,
                success: req.query.success,
                error: req.query.error
            });
        } catch (error) {
            console.error('Error loading home page:', error);
            res.render('index', { 
                currentPage: 'new', 
                user: req.session.username, 
                requisitions: [],
                error: "Could not load requisitions"
            });
        }
    });

//submit
 app.post('/requisition/submit-to-hod', isAuthenticated, async (req, res) => {
    try {
        const { requestDate, grandTotal, staffName } = req.body;
        const department = req.session.department;
        
        let newStatus = 'PENDING_HOD'; 
        let workflowStage = 'Prepared';
        const userRole = req.session.role;

        if (userRole === 'hod') {
            newStatus = 'PENDING_FINANCE';
            workflowStage = 'Prepared by HOD (Sent to Finance for review)';
        }

        if (userRole === 'finance') {
            newStatus = 'PENDING_DIRECTOR';
            workflowStage = 'Prepared by Finance Staff (Sent to Director)';
        }


        // Normalize fields (ensure arrays)
        const descriptions = Array.isArray(req.body.description) ? req.body.description : [req.body.description];
        const budgetLines = Array.isArray(req.body.budgetLine) ? req.body.budgetLine : [req.body.budgetLine];
        const costCentres = Array.isArray(req.body.costCentre) ? req.body.costCentre : [req.body.costCentre];
        const qtys = Array.isArray(req.body.qty) ? req.body.qty : [req.body.qty];
        const units = Array.isArray(req.body.unit) ? req.body.unit : [req.body.unit];
        const vats = Array.isArray(req.body.VAT) ? req.body.VAT : [req.body.VAT];
        const totals = Array.isArray(req.body.total) ? req.body.total : [req.body.total];

        // Server-side validation: Ensure every item has a description and a valid price
        for (let i = 0; i < descriptions.length; i++) {
            if (!descriptions[i] || (typeof descriptions[i] === 'string' && descriptions[i].trim() === '')) {
                return res.status(400).send(`Validation Error: Item #${i + 1} is missing a description.`);
            }
            if (!units[i] || isNaN(units[i]) || Number(units[i]) <= 0) {
                return res.status(400).send(`Validation Error: Item #${i + 1} must have a unit price greater than 0.`);
            }
        }

        const items = descriptions.map((desc, i) => ({
            budgetLine: budgetLines[i] || '',
            costCentre: costCentres[i] || '',
            description: desc || '',    
            qty: Number(qtys[i]) || 0,
            unitPrice: Number(units[i]) || 0,
            vat: Number(vats[i]) || 0,
            total: Number(totals[i]) || 0
        }));

        const computedGrandTotal = items.reduce((sum, item) => sum + item.total, 0);
        const submittedGrandTotal = Number(grandTotal) || 0;
        if (Math.abs(computedGrandTotal - submittedGrandTotal) > 1) {
            return res.status(400).send('Validation Error: Grand total does not match item totals.');
        }

        const history = [{ 
            stage: workflowStage, 
            date: new Date().toISOString(), 
            user: req.session.username,
            timestamp: Date.now()
        }];

        // 3. Database Insert
        const [insertRows] = await db.execute(
            'INSERT INTO requisitions ("staffName", "requestDate", department, items, "grandTotal", status, history) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
            [
                staffName || req.session.username, 
                requestDate || new Date(), 
                department, 
                JSON.stringify(items), 
                computedGrandTotal, 
                newStatus, 
                JSON.stringify(history)
            ]
        );

        const requisitionId = insertRows[0].id;

        // 4. Trigger Email
        try {
            await triggerWorkflowEmail(requisitionId, newStatus);
        } catch (mailErr) {
            console.error('❌ Email Notification Failed:', mailErr.message);
        }
        
        res.redirect('/home?success=Requisition submitted successfully');

    } catch (error) {
        console.error('Error saving requisition:', error);
        res.status(500).send(`Error saving requisition: ${error.message}`);
    }
    
});




    //HOD ROUTES
    app.get('/hod/dashboard', isAuthenticated, authorize('hod'), async (req, res) => {
        try {
            console.log("HOD User:", req.session.username);
            console.log("Looking for Department:", req.session.department);

            const [rows] = await db.execute(
                'SELECT * FROM requisitions WHERE department = ? ORDER BY requestDate DESC',
                [req.session.department]
            );
            
            const allDepartmentRequisitions = rows.map(req => {
                const parsed = parseRequisition(req);
                parsed.totalAmount = parsed.items.reduce((sum, item) => {
                    return sum + (Number(item.total) || Number(item.qty) * Number(item.unitPrice) || 0);
                }, 0);
                parsed.daysPending = Math.ceil((new Date() - new Date(parsed.requestDate)) / (1000 * 60 * 60 * 24));
                return parsed;
            });

            // Filter for specific categories for display on the dashboard
            const pendingHODRequisitions = allDepartmentRequisitions.filter(r => r.status === 'PENDING_HOD');
            const rejectedRequisitions = allDepartmentRequisitions.filter(r => r.status.startsWith('REJECTED'));
            const approvedRequisitions = allDepartmentRequisitions.filter(r => r.status === 'APPROVED');
            const inProgressRequisitions = allDepartmentRequisitions.filter(r => 
                r.status !== 'PENDING_HOD' && !r.status.startsWith('REJECTED') && r.status !== 'APPROVED'
            );

            // Recalculate stats based on the full set of department requisitions
            const totalDepartmentRequisitions = allDepartmentRequisitions.length;
            const highValueItems = allDepartmentRequisitions.filter(r => r.totalAmount > 100000).length;
            const urgentRequests = allDepartmentRequisitions.filter(r => r.daysPending > 3 && r.status === 'PENDING_HOD').length; // Urgent only for pending HOD
            
            res.render('hod_dashboard', { 
                requisitions: allDepartmentRequisitions,
                pendingHODRequisitions: pendingHODRequisitions,
                rejectedRequisitions: rejectedRequisitions,
                approvedRequisitions: approvedRequisitions,
                inProgressRequisitions: inProgressRequisitions,
                stats: {
                    total: totalDepartmentRequisitions,
                    highValue: highValueItems,
                    urgent: urgentRequests
                },
                currentPage: 'hod',
                user: req.session.username,
                role: 'hod',
                success: req.query.success,
                error: req.query.error
            });
            
        } catch (error) {
            console.error('Error loading HOD dashboard:', error);
            res.render('hod_dashboard', { 
                pendingHODRequisitions: [],
                rejectedRequisitions: [],
                approvedRequisitions: [],
                inProgressRequisitions: [],
                role: 'hod',
                department: req.session.department || 'General',
                stats: { total: 0, highValue: 0, urgent: 0 },
                currentPage: 'hod',
                user: req.session.username,
                error: "Could not load requisitions: " + error.message,
                success: req.query.success
            });
        }
    });
//HOD APPROVAL FORM
    app.get('/hod/approval/:id', isAuthenticated, authorize('hod'), async (req, res) => {
        try {
            const [rows] = await db.execute('SELECT * FROM requisitions WHERE id = ?', [req.params.id]);
            
            if (!rows || rows.length === 0) {
                return res.status(404).send("Requisition not found");
            }
            
            const requisition = parseRequisition(rows[0]);
            
            if (requisition.department !== req.session.department) {
                return res.status(403).send(`
                    <div style="text-align:center; margin-top:50px;">
                        <h2>Access Denied</h2>
                        <p>This requisition belongs to ${requisition.department} department, not yours.</p>
                        <a href="/hod/dashboard">Back to Dashboard</a>
                    </div>
                `);
            }
            
            if (requisition.status !== 'PENDING_HOD') {
                return res.status(400).send(`
                    <div style="text-align:center; margin-top:50px;">
                        <h2>Requisition Already Processed</h2>
                        <p>Status: ${requisition.status}</p>
                        <a href="/hod/dashboard">Back to Dashboard</a>
                    </div>
                `);
            }
            
            const subtotal = requisition.items.reduce((sum, item) => {
                return sum + (Number(item.total) || Number(item.qty) * Number(item.unitPrice) || 0);
            }, 0);
            
            res.render('approve_form', {
                requisition: {
                    ...requisition,
                    subtotal: subtotal,
                    grandTotal: subtotal,
                    history: requisition.history || []
                },
                currentPage: 'hod',
                role: 'hod'
            });
            
        } catch (error) {
            console.error('Error loading approval form:', error);
            res.status(500).send(`Error loading requisition: ${error.message}`);
        }

    });


    app.post('/hod/submit-approval/:id', isAuthenticated, authorize('hod'), upload.single('signature_file'), async (req, res) => {
        const { id } = req.params;
        const { action, comments } = req.body || {};
        const signaturePath = req.file ? `/uploads/signatures/${req.file.filename}` : null;
        
        console.log('Processing HOD approval:', { id, action });
        
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).send("Invalid action. Must be 'approve' or 'reject'.");
        }
        
        if (!req.file && action === 'approve') {
            return res.status(400).send("Signature is required.");
        }
        
        try {
            const [rows] = await db.execute('SELECT * FROM requisitions WHERE id = ?', [id]);
            
            if (rows.length === 0) {
                return res.status(404).send("Requisition not found");
            }
            
            const requisition = rows[0];
            
            if (requisition.department !== req.session.department) {
                return res.status(403).send("Access denied: this requisition is not from your department.");
            }
            
            if (requisition.status !== 'PENDING_HOD') {
                return res.status(400).send(`Requisition already processed. Current status: ${requisition.status}`);
            }
            
            let history = [];
            if (requisition.history) {
                try {
                    history = typeof requisition.history === 'string' ? 
                        JSON.parse(requisition.history) : 
                        (requisition.history || []);
                } catch(e) {
                    history = [];
                }
            }
            
            const newStatus = action === 'approve' ? 'PENDING_FINANCE' : 'REJECTED_BY_HOD';
            
            const historyEntry = {
                stage: 'HOD Approval',
                action: action === 'approve' ? 'Approved' : 'Rejected',
                date: new Date().toISOString(),
                user: req.session.username,
                signature: signaturePath,
                timestamp: Date.now()
            };
            
            if (comments) {
                historyEntry.comments = comments;
            }
            
            history.push(historyEntry);
            
            const updateQuery = 'UPDATE requisitions SET status = ?, hodSignature = ?, history = ? WHERE id = ?';
            const updateValues = [newStatus, signaturePath, JSON.stringify(history), id];
            
            await db.execute(updateQuery, updateValues);

            try {
                await triggerWorkflowEmail(id, newStatus);
            } catch (mailErr) {
                console.error('❌ Email Notification Failed:', mailErr.message);
            }
            
            console.log(`✅ HOD ${action}d requisition ${id}`);
            
            const message = action === 'approve' 
                ? '✅ Requisition approved and sent to Finance' 
                : '❌ Requisition rejected';
            
            res.redirect(`/hod/dashboard?success=${encodeURIComponent(message)}`);
            
        } catch (error) {
            console.error('❌ Error processing HOD approval:', error);
            res.status(500).send(`Error processing approval: ${error.message}`);
        }

       
    });

// FINANCE ROUTES
    app.get('/finance/dashboard', isAuthenticated, authorize('finance'), async (req, res) => { 
        try { 
            // Get pending finance requisitions 
            const [pendingRows] = await db.execute( 
                'SELECT * FROM requisitions WHERE status = ? ORDER BY requestDate DESC', 
                ['PENDING_FINANCE'] 
            ); 
            
            // Get ALL requisitions for tracking view 
            const [allRows] = await db.execute( 
                'SELECT * FROM requisitions ORDER BY requestDate DESC' 
            ); 
            
            //  department statistics
            const [deptStats] = await db.execute(`
                SELECT 
                    department,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
                    SUM(CASE WHEN status = 'PENDING_FINANCE' OR status = 'PENDING_HOD' OR status = 'PENDING_DIRECTOR' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status LIKE 'REJECTED%' THEN 1 ELSE 0 END) as rejected,
                    SUM(grandTotal) as totalValue
                FROM requisitions 
                GROUP BY department
                ORDER BY totalValue DESC
            `);
            //  unique departments for filter
            const [deptList] = await db.execute('SELECT DISTINCT department FROM requisitions WHERE department IS NOT NULL AND department != ""');
            const departments = deptList.map(d => d.department);
            
            // Parse pending requisitions 
            const parsedPending = pendingRows.map(req => { 
                const parsed = parseRequisition(req); 
                parsed.totalAmount = parsed.items.reduce((sum, item) => { 
                    return sum + (Number(item.total) || Number(item.qty) * Number(item.unitPrice) || 0); 
                }, 0); 
                return parsed; 
            }); 
            
            // Parse all requisitions 
            const parsedAll = allRows.map(req => { 
                const parsed = parseRequisition(req); 
                parsed.totalAmount = parsed.items.reduce((sum, item) => { 
                    return sum + (Number(item.total) || Number(item.qty) * Number(item.unitPrice) || 0); 
                }, 0); 
                return parsed; 
            }); 
            
            // Calculate comprehensive stats
            const totalValue = parsedAll.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
            
            const stats = { 
            highValue: parsedAll.filter(r => Number(r.grandTotal) > 100000).length,
                pendingFinance: parsedPending.length,
                pendingDirector: parsedAll.filter(r => r.status === 'PENDING_DIRECTOR').length,
                fullyApproved: parsedAll.filter(r => r.status === 'APPROVED').length,
                rejected: parsedAll.filter(r => r.status.includes('REJECTED')).length,
                totalValue: totalValue
            }; 
            
        res.render('finance_dashboard', { 
            requisitions: parsedPending,
            allRequisitions: parsedAll,
            departmentStats: deptStats,
            departments: departments,
            stats: stats,
            currentPage: 'finance',
            success: req.query.success,
            error: req.query.error
        });
        } catch (error) { 
            console.error('Error loading finance dashboard:', error); 
            res.render('finance_dashboard', { 
                requisitions: [], 
                allRequisitions: [], 
                departmentStats: [],
                stats: { 
                    pendingFinance: 0,
                    pendingDirector: 0,
                    fullyApproved: 0,
                    rejected: 0,
                    totalValue: 0
                }, 
                currentPage: 'finance', 
                user: req.session.username, 
                error: "Could not load requisitions",
                success: req.query.success
            }); 
        } 
    });



//Finance APPROVAL FORM
    app.get('/finance/approval/:id', isAuthenticated, authorize('finance'), async (req, res) => {
        try {
            const [rows] = await db.execute('SELECT * FROM requisitions WHERE id = ?', [req.params.id]);
            if (!rows[0]) return res.status(404).send("Requisition not found");
            
            const reqData = parseRequisition(rows[0]);
            
            if (reqData.status !== 'PENDING_FINANCE') {
                return res.status(400).send(`
                    <div style="text-align:center; margin-top:50px;">
                        <h2>Requisition Already Processed</h2>
                        <p>Status: ${reqData.status}</p>
                        <a href="/finance/dashboard">Back to Dashboard</a>
                    </div>
                `);
            }
            
            res.render('approve_form', { 
                requisition: reqData, 
                currentPage: 'finance',
                role: 'finance'
            });
        } catch (error) {
            console.error('Error loading finance approval:', error);
            res.status(500).send(`Error loading requisition: ${error.message}`);
        }
    });

// Director Dashboard Route

app.post('/finance/submit-approval/:id', isAuthenticated, authorize('finance'), upload.single('signature_file'), async (req, res) => {
    const { id } = req.params;
    const { action, comments } = req.body || {};
    const signaturePath = req.file ? `/uploads/signatures/${req.file.filename}` : null;
    
    if (action === 'approve' && !signaturePath) {
        return res.status(400).send("Signature file is required for finance approval.");
    }

    try {
        // 1. Fetch requisition AND required user data explicitly (Using Email/Username mapping safely)
        // Adjust the ON clause if your 'requisitions' table tracks creator via 'staffEmail' or 'userId'
        const [rows] = await db.execute(`
            SELECT 
                r.*, 
                u.role AS "requesterRole", 
                u.email AS "requesterEmail", 
                u.username AS "requesterName"
            FROM requisitions r 
            LEFT JOIN users u ON r."staffName" = u.username 
            WHERE r.id = ?`, [id]);

        if (rows.length === 0) return res.status(404).send("Requisition not found");
        
        const requesterRole = rows[0].requesterRole || rows[0].requesterrole || 'staff';
        const requesterEmail = rows[0].requesterEmail || rows[0].requesteremail || '';
        const requesterName = rows[0].requesterName || rows[0].requestername || rows[0].staffName || '';
        let newStatus;

        
        if (action === 'approve') {
            if (requesterRole === 'staff') {
                // Regular staff process ends here at Finance
                newStatus = 'APPROVED'; 
            } else {
                // HODs and Finance staff must go to the Director for final sign-off
                newStatus = 'PENDING_DIRECTOR';
            }
        } else {
            newStatus = 'REJECTED_BY_FINANCE';
        }

        // 3. Handle History
        let history = [];
        try {
            history = typeof rows[0].history === 'string' ? JSON.parse(rows[0].history || '[]') : rows[0].history || [];
        } catch(e) { 
            history = []; 
        }
        
        history.push({
            stage: action === 'approve' ? 'Approved by Finance' : 'Rejected by Finance',
            date: new Date().toISOString(),
            action: action === 'approve' ? 'Approved' : 'Rejected',
            user: req.session.username || 'Unknown',
            comments: comments || '',
            signature: signaturePath || ''
        });
        
        // 4. Update Database
        await db.execute(
            'UPDATE requisitions SET status = ?, financeSignature = ?, history = ? WHERE id = ?',
            [newStatus, signaturePath, JSON.stringify(history), id]
        );

        // 5. Trigger Emails
        try {
            await triggerWorkflowEmail(id, newStatus);
        } catch (mailErr) {
            console.error('❌ Email Notification Failed:', mailErr.message);
        }

        const successMsg = newStatus === 'PENDING_DIRECTOR' 
            ? 'Approved and forwarded to Director' 
            : 'Finance approval completed';

        res.redirect(`/finance/dashboard?success=${encodeURIComponent(successMsg)}`);

    } catch (error) {
        console.error('Error processing finance approval:', error);
        res.status(500).send(`Error processing approval: ${error.message}`);
    }
});


app.get('/director/dashboard', isAuthenticated, authorize('director'), async (req, res) => {
    try {
        //Requisitions pending director's approval
            const [pending] = await db.execute(
                'SELECT * FROM requisitions WHERE status = "PENDING_DIRECTOR" ORDER BY requestDate DESC'
            );
            const parsedPending = pending.map(r => parseRequisition(r));
        // 1. Get ALL approved requisitions for the table
        const [rows] = await db.execute(
            'SELECT * FROM requisitions WHERE status = ? ORDER BY requestDate DESC',
            ['APPROVED']
        );

        // 2. Get Department Aggregated Stats directly from DB for the Charts
        // This is much faster than looping in JS
        const [deptRows] = await db.execute(`
            SELECT 
                IFNULL(department, 'Uncategorized') as dept, 
                SUM(grandTotal) as totalAmount, 
                COUNT(*) as reqCount 
            FROM requisitions 
            WHERE status = 'APPROVED' 
            GROUP BY department
        `);

        //  table rows (Parsing JSON fields for EJS rendering)
        const parsedRequests = rows.map(req => {
            
            const parsed = typeof parseRequisition === 'function' ? parseRequisition(req) : req;
            
                  parsed.grandTotal = parseFloat(req.grandTotal) || 0;
            return parsed;
        });

        // data for Charts
        const deptNames = deptRows.map(r => r.dept);
        const deptAmounts = deptRows.map(r => Number(r.totalAmount) || 0);
        const deptCounts = deptRows.map(r => r.reqCount);

        //  High-Level Stats
        const totalSpendAll = deptAmounts.reduce((a, b) => a + b, 0);
        const highValueCount = parsedRequests.filter(r => r.grandTotal > 100000).length;
        const pendingHighValueCount = parsedPending.filter(r => r.grandTotal > 100000).length;
        const avgSpend = parsedRequests.length > 0 ? (totalSpendAll / parsedRequests.length).toFixed(0) : 0;

        console.log(`📊 Dashboard Stats: Total KES ${totalSpendAll}, Depts: ${deptNames.length}`);

        // Add cache-control headers
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

       
    res.render('director_dashboard', { 
        pendingRequisitions: parsedPending || [],
        visibleRequisitions: parsedRequests,
        requisitions: parsedRequests,
        deptNames,
        deptAmounts,
        deptCounts,
        stats: { 
            total: parsedRequests.length, 
            highValue: highValueCount,
            pendingHighValue: pendingHighValueCount,
            totalSpend: totalSpendAll,
            avgSpend: avgSpend
        },
        reportDate: new Date().toLocaleDateString('en-GB', { 
            day: '2-digit', 
            month: 'short', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }),
        success: req.query.success,
        error: req.query.error,
        timestamp: Date.now()
    });

    } catch (error) {
        console.error('❌ Error loading director dashboard:', error);
        res.render('director_dashboard', { 
            pendingRequisitions: [],
            visibleRequisitions: [],
            requisitions: [],
            deptNames: [],
            deptAmounts: [],
            deptCounts: [],
            stats: { total: 0, highValue: 0, totalSpend: 0, avgSpend: 0 },
            error: "Failed to load director analytics: " + error.message
        });
    }
});


    // Director Review Detail Route 




    app.get('/director/review/:id', isAuthenticated, authorize('director'), async (req, res) => {
        const requisitionId = req.params.id;
        try {
            const [rows] = await db.execute('SELECT * FROM requisitions WHERE id = ?', [req.params.id]);
            
            if (rows.length === 0) {
                return res.status(404).send("Requisition not found");
            }

            const requisition = parseRequisition(rows[0]);

            if (requisition.status !== 'PENDING_DIRECTOR') {
                return res.status(400).send(`
                    <div style="text-align:center; margin-top:50px;">
                        <h2>Requisition Already Processed</h2>
                        <p>Status: ${requisition.status}</p>
                        <a href="/director/dashboard">Back to Dashboard</a>
                    </div>
                `);
            }

            res.render('director_review_detail', {
                role: req.session.role,
                requisition: requisition,
                currentPage: 'director'
            });
        } catch (error) {
            console.error('Error loading director review page:', error);
            res.status(500).send("Internal Server Error");
        }
    });





//View requisition details
    app.get('/requisition/view/:id', isAuthenticated, async (req, res) => {
        try {
            const [rows] = await db.execute('SELECT * FROM requisitions WHERE id = ?', [req.params.id]);
            
            if (rows.length === 0) return res.status(404).send('Requisition not found');

            // Use your helper to parse the JSON history string into an array
            const requisition = parseRequisition(rows[0]);

            res.render('view_details', { 
                role: req.session.role,
                requisition: requisition, 
                user: req.session.username 
            });
        } catch (error) {
            console.error(error);
            res.status(500).send('Server Error');
        }
    });



app.get('/download-receipt/:id', isAuthenticated, async (req, res) => {
    try {
        const requisitionId = req.params.id;

        // 1. Fetch the requisition (contains the 'items' column)
        const [requisitions] = await db.execute('SELECT * FROM requisitions WHERE id = ?', [requisitionId]);
        const r = requisitions[0];

        if (!r) return res.status(404).send("Requisition not found");

        // Normalize the requisition and item VAT values before generating the PDF.
        const normalizedRequisition = parseRequisition(r);

        console.log("Processing PDF for Requisition ID:", normalizedRequisition.id);

        // 3. Render and Generate PDF
        const ejsPath = path.join(__dirname, 'views', 'download.ejs');

        // Helper to load signature file as data URL if present
        function loadSignatureDataURL(sigPath) {
            if (!sigPath) return null;
            try {
                // sigPath may already be a data URL
                if (typeof sigPath === 'string' && sigPath.startsWith('data:')) return sigPath;

                // Normalize leading slash
                const rel = sigPath.startsWith('/') ? sigPath.substring(1) : sigPath;
                const fullPath = path.join(__dirname, rel);
                if (!fs.existsSync(fullPath)) return null;
                const buffer = fs.readFileSync(fullPath);
                const ext = path.extname(fullPath).toLowerCase().replace('.', '') || 'png';
                const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png');
                return `data:${mime};base64,${buffer.toString('base64')}`;
            } catch (e) {
                console.warn('Could not load signature file:', sigPath, e.message);
                return null;
            }
        }

        const hodSignatureImage = loadSignatureDataURL(normalizedRequisition.hodSignature);
        const financeSignatureImage = loadSignatureDataURL(normalizedRequisition.financeSignature);
        const directorSignatureImage = loadSignatureDataURL(normalizedRequisition.directorSignature);
        
        ejs.renderFile(ejsPath, { 
            r: normalizedRequisition, 
            logo: logoBase64,
            itemList: normalizedRequisition.items || [],
            hodSignatureImage,
            financeSignatureImage,
            directorSignatureImage
        }, async (err, html) => {
            if (err) {
                console.error("EJS Error:", err);
                return res.status(500).send("Template Error");
            }
            
            let browser;
            try {
                if (!CHROMIUM_EXEC) throw new Error('Chromium not found. Please ensure chromium is installed.');
                browser = await puppeteer.launch({
                    executablePath: CHROMIUM_EXEC,
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu'
                    ]
                });
                const page = await browser.newPage();
                await page.setContent(html, { waitUntil: 'networkidle0' });
                const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
                await browser.close();
                browser = null;
                
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename="requisition-${requisitionId}.pdf"`);
                res.send(pdfBuffer);
            } catch (pdfError) {
                if (browser) { try { await browser.close(); } catch(e) {} }
                console.error('PDF Generation Failed:', pdfError);
                res.status(500).send(`PDF Generation Failed: ${pdfError.message}`);
            }
        });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).send("Internal Server Error");
    }
});

app.post('/director/submit-approval/:id', isAuthenticated, authorize('director'), upload.single('signature_file'), async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Check if req.body exists (Safety check for Multer)
        if (!req.body) {
            return res.status(400).send("Form data could not be parsed.");
        }

        // 2. Destructure fields
        const { action, comments } = req.body || {};
        
        // 3. Get the signature path (consistent with HOD: /uploads/signatures/filename)
        const signaturePath = req.file ? `/uploads/signatures/${req.file.filename}` : null;

        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).send("Invalid action. Must be 'approve' or 'reject'.");
        }

        if (!req.file && action === 'approve') {
            return res.status(400).send("Signature is required for approval.");
        }

        // 4. Fetch the existing requisition
        const [rows] = await db.execute('SELECT * FROM requisitions WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).send("Requisition not found");

        if (rows[0].status !== 'PENDING_DIRECTOR') {
            return res.status(400).send(`Invalid action. Current status is ${rows[0].status}.`);
        }
        
        // 5. Finalize status
        const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED_BY_DIRECTOR';

        // 6. Handle history safely
        let history = [];
        try {
            history = typeof rows[0].history === 'string' ? JSON.parse(rows[0].history || '[]') : rows[0].history || [];
        } catch(e) {
            history = [];
        }
        
        history.push({
            stage: action === 'approve' ? 'Approved by Director' : 'Rejected by Director',
            date: new Date().toISOString(),
            user: req.session.username,
            comments: comments || '',
            signature: signaturePath
        });
        
        // 7. Update Database
        await db.execute(
            'UPDATE requisitions SET status = ?, directorSignature = ?, history = ? WHERE id = ?',
            [newStatus, signaturePath, JSON.stringify(history), id]
        );

        // 8. Email Notification
        try {
            await triggerWorkflowEmail(id, newStatus);
        } catch (mailErr) {
            console.error('❌ Email Notification Failed:', mailErr.message);
        }

        res.redirect('/director/dashboard?success=Final approval submitted');

    } catch (error) {
        console.error('Error processing director approval:', error);
        res.status(500).send(`Error: ${error.message}`);
    }
});


//  ERROR HANDLING
    app.use((req, res) => {
        res.status(404).send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
               <b> <h1>404 - Page Not Found</h1>
                <p>The page you're looking for doesn't exist.</p>
                <a href="/home">Go Home</a></b>
            </div>
        `);
    });







//SERVER START
const server = http.createServer(app);

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`\n❌ Port ${port} is already in use!`);
            console.error('\nSolutions:');
            console.error('1. Kill existing Node processes:');
            console.error('   Stop-Process -Name node -Force');
            console.error('\n2. Use a different port:');
            console.error('   $env:PORT=3001; node index.js');
            process.exit(1);
        } else {
            console.error('Server error:', err);
        }
    });

    server.listen(port, hostname, () => {
        console.log(`\n✅ Octagon Portal Active: http://${hostname}:${port}/`);
    });