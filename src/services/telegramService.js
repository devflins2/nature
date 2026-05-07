'use strict';

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs-extra');
const path = require('path');
const { APP_CONFIG } = require('../config/cloudinary');
const logger = require('../utils/logger');

let client = null;

/**
 * Initialize the Telegram client
 */
async function initTelegram() {
    if (client && client.connected) return client;

    const { apiId, apiHash, stringSession } = APP_CONFIG.telegram;

    if (!apiId || !apiHash) {
        throw new Error('Missing Telegram API_ID or API_HASH in .env');
    }

    const session = new StringSession(stringSession || '');
    client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 10,
        useWSS: true,
    });

    await client.connect();
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

        logger.step('Telegram', `Uploading ${type.slice(0, -1)} to chat ${chatId}...`);

        // Use sendFile for everything - it's more reliable for both images and videos
        await client.sendFile(chatId, {
            file: localPath,
            caption: caption,
            parseMode: 'markdown',
            supportsStreaming: true,
            forceDocument: false, // Upload as media, not file
        });

        logger.success(`Posted to Telegram: ${item.id}`);
    } catch (error) {
        logger.error(`Telegram upload failed for ${item.id}: ${error.message}`);
        // If session expired or failed, clear client so it re-inits next time
        if (error.message.includes('AUTH_KEY') || error.message.includes('SESSION')) {
            client = null;
        }
    }
}

module.exports = {
    sendMediaToTelegram,
    initTelegram
};
