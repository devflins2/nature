'use strict';

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs-extra');
const path = require('path');
const { APP_CONFIG } = require('../config/cloudinary');
const logger = require('../utils/logger');

const { sleep } = require('../utils/retry');

let client = null;

/**
 * Initialize the Telegram client (Singleton)
 */
async function initTelegram() {
    if (client && client.connected) return client;

    const { apiId, apiHash, stringSession } = APP_CONFIG.telegram;

    if (!apiId || !apiHash) {
        throw new Error('Missing Telegram API_ID or API_HASH in .env');
    }

    const session = new StringSession(stringSession || '');
    client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 15,
        useWSS: true,
        autoReconnect: true,
    });

    try {
        await client.connect();
        logger.info('Telegram: Connected and Authenticated');
    } catch (err) {
        logger.error('Telegram: Connection failed', err);
        client = null;
        throw err;
    }
    
    return client;
}

/**
 * Send media to Telegram
 */
async function sendMediaToTelegram(localPath, item, type) {
    if (!APP_CONFIG.telegram.enabled) return;

    try {
        const client = await initTelegram();
        const chatId = APP_CONFIG.telegram.chatId;

        if (!chatId) {
            logger.warn('TELEGRAM_CHAT_ID is missing. Skipping Telegram post.');
            return;
        }

        const tagsString = Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || 'nature');
        const caption = `🌿 **${item.title || 'Nature Media'}**\n\n` +
                        `🏷 **Tags:** ${tagsString}\n\n` +
                        `🔗 [View on Pixabay](${item.pageURL || item.pixabayUrl})`;

        logger.step('Telegram', `Uploading ${item.id}...`);

        await client.sendFile(chatId, {
            file: localPath,
            caption: caption,
            parseMode: 'markdown',
            supportsStreaming: true,
        });

        logger.success(`Telegram: Success ${item.id}`);
        
        // Anti-Flood Delay: Wait 2 seconds between uploads
        await sleep(2000);

    } catch (error) {
        logger.error(`Telegram upload failed for ${item.id}: ${error.message}`);
        
        if (error.message.includes('AUTH_KEY') || error.message.includes('406')) {
            logger.warn('Auth Key issue detected. Resetting client...');
            client = null;
        }
        
        // Wait a bit more on failure
        await sleep(5000);
    }
}

module.exports = {
    sendMediaToTelegram,
    initTelegram
};
