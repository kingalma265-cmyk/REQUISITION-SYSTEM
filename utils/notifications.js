const db = require('../config/db'); 
const { sendNotification } = require('./mailer');

/**
 * Automatically notifies the correct people based on the requisition status
 * @param {number} requisitionId 
 * @param {string} status
 */
async function triggerWorkflowEmail(requisitionId, status) {
    try {
        const [reqs] = await db.execute('SELECT department, staffName, grandTotal FROM requisitions WHERE id = ?', [requisitionId]);
        if (reqs.length === 0) return;
        const { department, staffName, grandTotal } = reqs[0];

        const [staffRows] = await db.execute('SELECT email, username FROM users WHERE username = ?', [staffName]);
        const requester = staffRows[0]; // This is our staff member

        const formatRequisitionId = (id) => `OCT #${id}`;
        const formattedId = formatRequisitionId(requisitionId);
        let subject = `Requisition ${formattedId} Update`;
        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        let link = `${baseUrl}/requisition/view/${requisitionId}`;

        // Helper functions to get users by role and department
        const getHODs = async (dept) => {
            const [hods] = await db.execute('SELECT email, username FROM users WHERE role = "hod" AND department = ?', [dept]);
            return hods;
        };
        const getFinanceUsers = async () => {
            const [financeUsers] = await db.execute('SELECT email, username FROM users WHERE role = "finance"');
            return financeUsers;
        };
        const getDirectorUsers = async () => {
            const [directorUsers] = await db.execute('SELECT email, username FROM users WHERE role = "director"');
            return directorUsers;
        };

        switch (status) {
            case 'PENDING_HOD':
                // Notify HOD
                const hodsForDept = await getHODs(department);
                for (const hod of hodsForDept) {
                    await sendNotification(hod.email, hod.username, requisitionId, subject,
                        `A new requisition for KES ${Number(grandTotal).toLocaleString()} from ${staffName} is pending your approval.`, link);
                }
                // Notify Staff
                if (requester) {
                    await sendNotification(requester.email, requester.username, requisitionId, "Submission Received",
                        `Your requisition ${formattedId} is now with your HOD.`, link);
                }
                break;

            case 'PENDING_FINANCE':
                // Notify Finance
                const financeUsers = await getFinanceUsers();
                for (const financeUser of financeUsers) {
                    await sendNotification(financeUser.email, financeUser.username, requisitionId, subject,
                        `Requisition ${formattedId} from ${staffName} has been approved by HOD and is pending your financial verification.`, link);
                }
                // Notify HOD (who just approved it, or if Director sent it here)
                const hodsNotified = await getHODs(department);
                for (const hod of hodsNotified) {
                    await sendNotification(hod.email, hod.username, requisitionId, subject,
                        `Requisition ${formattedId} from ${staffName}, which you approved, has now moved to Finance for verification.`, link);
                }
                // Notify Staff
                if (requester) {
                    await sendNotification(requester.email, requester.username, requisitionId, "HOD Approved",
                        `Your requisition ${formattedId} was approved by the HOD and moved to Finance.`, link);
                }
                break;

            case 'PENDING_DIRECTOR':
                // Notify Director
                const directorUsers = await getDirectorUsers();
                for (const directorUser of directorUsers) {
                    await sendNotification(directorUser.email, directorUser.username, requisitionId, subject,
                        `Requisition ${formattedId} from ${staffName} has been cleared by Finance and requires your final approval.`, link);
                }
                // Notify Finance (who just approved it)
                const financeUsersNotified = await getFinanceUsers();
                for (const financeUser of financeUsersNotified) {
                    await sendNotification(financeUser.email, financeUser.username, requisitionId, subject,
                        `Requisition ${formattedId} from ${staffName}, which you cleared, has now moved to the Director for final approval.`, link);
                }
                // Notify Staff
                if (requester) {
                    await sendNotification(requester.email, requester.username, requisitionId, "Finance Cleared",
                        `Your requisition ${formattedId} has cleared Finance and is now with the Director.`, link);
                }
                break;

            case 'APPROVED':
                // Notify Staff
                if (requester) {
                    await sendNotification(requester.email, requester.username, requisitionId, "Requisition Approved",
                        `Your requisition ${formattedId} has been fully APPROVED!`, link);
                }
                // Notify HOD
                const hodsApproved = await getHODs(department);
                for (const hod of hodsApproved) {
                    await sendNotification(hod.email, hod.username, requisitionId, "Requisition Approved",
                        `Requisition ${formattedId} from ${staffName}, which you approved, has been fully APPROVED.`, link);
                }
                // Notify Finance
                const financeUsersApproved = await getFinanceUsers();
                for (const financeUser of financeUsersApproved) {
                    await sendNotification(financeUser.email, financeUser.username, requisitionId, "Requisition Approved",
                        `Requisition ${formattedId} from ${staffName}, which you cleared, has been fully APPROVED.`, link);
                }
                break;

            case 'REJECTED_BY_HOD': // Make sure these match your DB status strings exactly
            case 'REJECTED_BY_FINANCE':
            case 'REJECTED_BY_DIRECTOR':
                const rejectionReason = status.replace(/_/g, ' ').toLowerCase();
                // Notify Staff
                if (requester) {
                    await sendNotification(requester.email, requester.username, requisitionId, "Requisition Rejected",
                        `Your requisition ${formattedId} has been ${rejectionReason}. Please check the details for comments.`, link);
                }
                // Notify HOD (if rejected by Finance or Director)
                if (status !== 'REJECTED_BY_HOD') { // HOD doesn't need to be notified if they were the one rejecting
                    const hodsRejected = await getHODs(department);
                    for (const hod of hodsRejected) {
                        await sendNotification(hod.email, hod.username, requisitionId, "Requisition Rejected",
                            `Requisition ${formattedId} from ${staffName}, which you approved, has been ${rejectionReason}.`, link);
                    }
                }
                // Notify Finance (if rejected by Director)
                if (status === 'REJECTED_BY_DIRECTOR') {
                    const financeUsersRejected = await getFinanceUsers();
                    for (const financeUser of financeUsersRejected) {
                        await sendNotification(financeUser.email, financeUser.username, requisitionId, "Requisition Rejected",
                            `Requisition ${formattedId} from ${staffName}, which you cleared, has been ${rejectionReason}.`, link);
                    }
                }
                break;
        }
    } catch (error) {
        console.error("Workflow Notification Error:", error);
    }
}
module.exports = { triggerWorkflowEmail };