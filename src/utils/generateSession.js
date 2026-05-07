'use strict';

/**
 * Run this script once to generate your TELEGRAM_STRING_SESSION
 * Usage: node src/utils/generateSession.js
 */

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input'); // npm install input

const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
    console.error('🛑 Error: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env first!');
    process.exit(1);
}

const stringSession = new StringSession(""); // Empty for new session

(async () => {
    console.log('--- Telegram Session Generator ---');
    console.log('Connecting to Telegram...');
    
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text('Please enter your phone number (+91...): '),
        password: async () => await input.text('Please enter your 2FA password (if any): '),
        phoneCode: async () => await input.text('Please enter the code you received: '),
        onError: (err) => console.log(err),
    });

    console.log('✅ Login successful!');
    const savedSession = client.session.save();
    
    console.log('\n--- YOUR STRING SESSION (COPY THIS) ---');
    console.log(savedSession);
    console.log('---------------------------------------\n');
    
    console.log('👉 Copy the long string above and paste it into TELEGRAM_STRING_SESSION in your .env file.');
    
    await client.disconnect();
    process.exit(0);
})();
