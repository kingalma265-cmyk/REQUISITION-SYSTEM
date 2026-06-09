const nodemailer = require("nodemailer");
var { SendMailClient } = require("zeptomail");
require('dotenv').config();


// Initialize Nodemailer Transporter
// If using ZeptoMail SMTP, use: smtppro.zoho.com
const transporter = nodemailer.createTransport({
    host: "smtp.zeptomail.com", 
    port: 465,            // Port 465 is generally more reliable for SSL/TLS
    secure: true,           // true for 465, false for 587
    debug: true,            // Include SMTP traffic in the logs
    logger: true,           // Log communication to the console
    auth: {
        user: "emailapikey", 
        pass: "wSsVR61+8hL4B/h0mjWlL+c/mVRdAQikHUV8jFqnunH9Fv+Xocdvlk3JAQLxHfUeQ2RgEzMTorN7y08G1WJYj9kunlkECCiF9mqRe1U4J3x17qnvhDzIXmpekhCKKYsNwwVomWBoFssm+g==", // Use the token from your .env file
    },
    tls: {
        // Use modern TLS versions, NOT SSLv3
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

const sendPasswordResetEmail = async (recipientEmail, resetLink) => {
    try {
        const mailOptions = {
            from: `"Octagon Requisition System" <support@octagonafrica.com>`,
            to: recipientEmail,
            subject: "Password Reset Request",
            html: `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; max-width: 500px; margin: auto;">
                    <h2 style="color: #0056b3;">Password Reset</h2>
                    <p>You requested a password reset for your Octagon Requisition account.</p>
                    <p>Click the button below to set a new password. This link will expire in 1 hour.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" 
                           style="background-color: #0056b3; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                            Reset Password
                        </a>
                    </div>
                    <p style="font-size: 12px; color: #666;">If you did not request this, please ignore this email.</p>
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