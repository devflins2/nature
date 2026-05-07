const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
    console.error('❌ Error: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env first!');
    process.exit(1);
}

(async () => {
    console.log('--- TELEGRAM SESSION GENERATOR ---');
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text('📞 Enter your phone number (with country code, e.g. +91...): '),
        password: async () => await input.text('🔑 Enter your 2FA password (if any): '),
        phoneCode: async () => await input.text('📩 Enter the OTP you received on Telegram: '),
        onError: (err) => console.log('❌ Error:', err.message),
    });

    const sessionString = client.session.save();
    console.log('\n✅ LOGIN SUCCESSFUL!');
    console.log('\n--- YOUR NEW TELEGRAM_STRING_SESSION ---');
    console.log(sessionString);
    console.log('----------------------------------------\n');
    console.log('Copy the string above and paste it into your .env file.');
    
    await client.disconnect();
    process.exit(0);
})();
