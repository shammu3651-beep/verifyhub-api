require('dotenv').config();

/**
 * Centrally sends emails via the external email microservice
 * @param {Object} payload - Email parameters containing to, subject, html, text, type, otp
 */
const sendEmailViaService = async ({ to, subject, html, text, type, otp }) => {
    try {
        const emailApiUrl = process.env.EMAIL_API_URL || 'https://email-testtt.vercel.app/api/send-email';
        const apiKey = process.env.VERCEL_EMAIL_API_KEY;

        // Perform security delivery call to email server
        const response = await fetch(emailApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ to, subject, html, text, type, otp })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Failed to dispatch via microservice');
        }
        return { success: true, data };
    } catch (error) {
        console.error('❌ Email Dispatch Gateway Error:', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = { sendEmailViaService };
