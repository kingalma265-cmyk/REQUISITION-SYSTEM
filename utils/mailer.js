const nodemailer = require("nodemailer");
var { SendMailClient } = require("zeptomail");
require('dotenv').config();


// Initialize Nodemailer Transporter
// If using ZeptoMail SMTP, use: smtppro.zoho.com
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.zeptomail.com",
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== 'false',
    auth: {
        user: process.env.SMTP_USER || "emailapikey",
        pass: process.env.SMTP_PASSWORD || "",
    },
    tls: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});


const sendNotification = async (recipientEmail, recipientName, requisitionId, subject, message, link = "http://localhost:3000/login") => {
    try {
        const mailOptions = {
            from: `"Octagon Requisition System" <support@octagonafrica.com>`,
            to: recipientEmail,
            subject: subject,
            html: `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; border: 1px solid #e0e0e0; border-radius: 10px; max-width: 600px; margin: auto; color: #333;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #0056b3; margin: 0;">Octagon Africa</h2>
                        <p style="color: #666; font-size: 14px;">Requisition Portal Notification</p>
                    </div>
                    
                    <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; border-left: 5px solid #0056b3;">
                        <p>Hello <strong>${recipientName}</strong>,</p>
                        <p style="line-height: 1.6;">${message}</p>
                    </div>

                    <div style="text-align: center; margin-top: 30px;">
                       <a href="${link}" 
               style="background-color: #0056b3; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                View Requisition Details
            </a>
                    </div>
                    
                    <hr style="margin-top: 40px; border: 0; border-top: 1px solid #eee;">
                    <p style="font-size: 11px; color: #999; text-align: center;">
                        This is an automated system notification. Please do not reply directly to this email.<br>
                        &copy; ${new Date().getFullYear()} Octagon Africa Ltd.
                    </p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent to ${recipientEmail}: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
        
    } catch (error) {
        console.error("❌ SMTP Error Captured:");
        console.error(`   - Message: ${error.message}`);
        console.error(`   - Command: ${error.command || 'N/A'}`);
        console.error(`   - Response: ${error.response || 'No response from server'}`);
        console.error(`   - Response Code: ${error.responseCode || 'N/A'}`);
        console.error("   - Full Stack:", error.stack);
        return { success: false, error: error.message };
    }
};

const sendPasswordResetEmail = async (recipientEmail, otp, tempPassword) => {
    try {
        const mailOptions = {
            from: `"Octagon Requisition System" <support@octagonafrica.com>`,
            to: recipientEmail,
            subject: "Password Reset OTP",
            html: `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; max-width: 500px; margin: auto;">
                    <h2 style="color: #0056b3;">Password Reset</h2>
                    <p>You requested a password reset for your Octagon Requisition account.</p>
                    <div style="background: #f0f7ff; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; border: 2px solid #0056b3;">
                        <p style="font-size: 14px; color: #333; margin-bottom: 10px;">Your One-Time Password (OTP)</p>
                        <div style="font-size: 36px; font-weight: bold; color: #0056b3; letter-spacing: 8px; margin: 10px 0;">${otp}</div>
                        <p style="font-size: 12px; color: #666;">Valid for 10 minutes</p>
                    </div>
                    <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 15px 0;">
                        <p style="font-size: 13px; color: #856404; margin: 0;">
                            <strong>Temporary Password:</strong> <code style="font-size: 16px; background: #fff; padding: 4px 8px; border-radius: 4px;">${tempPassword}</code>
                        </p>
                        <p style="font-size: 12px; color: #856404; margin: 5px 0 0 0;">Use this to log in directly, or use the OTP above to reset your password.</p>
                    </div>
                    <div style="text-align: center; margin: 25px 0;">
                        <p style="font-size: 14px; color: #333;">How to reset:</p>
                        <p style="font-size: 13px; color: #666;">1. Go to the Verify OTP page<br>2. Enter your email and the OTP above<br>3. Set a new password</p>
                    </div>
                    <hr style="border: 0; border-top: 1px solid #eee;">
                    <p style="font-size: 12px; color: #999; text-align: center;">If you did not request this, please ignore this email.</p>
                </div>
            `
        };
        await transporter.sendMail(mailOptions);
        return { success: true };
    } catch (error) {
        console.error("Reset Email Error:", error);
        return { success: false, error: error.message };
    }
};

module.exports = { sendNotification, sendPasswordResetEmail };