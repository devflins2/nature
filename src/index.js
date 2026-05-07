require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');

const { APP_CONFIG } = require('./config/cloudinary');
const { connectDB } = require('./config/db');
const { fetchAllMedia } = require('./services/pixabayService');
const { downloadBatch } = require('./services/downloadService');
const { uploadBatch, createStats } = require('./services/uploadService');
const { loadUploadedIds, getMetadataSummary, recordSuccessfulUpload } = require('./services/metadataService');
const { ensureDirectories } = require('./utils/fileUtils');
const { sendMediaToTelegram } = require('./services/telegramService');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static gallery files
app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../dashboard.html')));
app.get('/health', (req, res) => res.send('OK'));

// API to fetch media (Hybrid: Live Cloudinary + Stored Telegram Files)
app.get('/api/media', async (req, res) => {
    try {
        const cloudinary = require('cloudinary').v2;
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
        });

        // 1. Fetch live from Cloudinary
        const [imgRes, vidRes] = await Promise.all([
            cloudinary.api.resources({ resource_type: 'image', max_results: 500, context: true, tags: true }),
            cloudinary.api.resources({ resource_type: 'video', max_results: 500, context: true, tags: true })
        ]);

        // 2. Fetch skipped videos from MongoDB
        const { Media } = require('./config/db');
        const skippedMedia = await Media.find({ cloudinaryUrl: 'skipped_due_to_size' });

        // Map Cloudinary resources
        const cloudImages = imgRes.resources.map(r => ({
            pixabayId: r.context?.custom?.pixabay_id || r.public_id.split('/').pop(),
            title: r.context?.custom?.caption || r.public_id.split('/').pop(),
            cloudinaryUrl: r.secure_url,
            cloudinaryWidth: r.width,
            cloudinaryHeight: r.height,
            uploadedAt: r.created_at,
            tags: r.tags || []
        }));

        const cloudVideos = vidRes.resources.map(r => ({
            pixabayId: r.context?.custom?.pixabay_id || r.public_id.split('/').pop(),
            title: r.context?.custom?.caption || r.public_id.split('/').pop(),
            cloudinaryUrl: r.secure_url,
            uploadedAt: r.created_at,
            tags: r.tags || []
        }));

        // Combine with skipped items
        const images = cloudImages;
        const videos = [...cloudVideos, ...skippedMedia].sort((a, b) => 
            new Date(b.uploadedAt || b.created_at) - new Date(a.uploadedAt || a.created_at)
        );

        res.json({ images, videos });
    } catch (err) {
        console.error("Hybrid Fetch Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Global logs for dashboard
let activityLogs = [];
const MAX_LOGS = 50;

function addActivityLog(message, type = 'info') {
    const logEntry = {
        message,
        type,
        time: new Date().toLocaleTimeString(),
        timestamp: new Date()
    };
    activityLogs.unshift(logEntry);
    if (activityLogs.length > MAX_LOGS) activityLogs.pop();
}

// API for logs
app.get('/api/logs', (req, res) => res.json(activityLogs));

// Integrate with logger
const originalInfo = logger.info;
logger.info = (msg, ...args) => { addActivityLog(msg, 'info'); originalInfo(msg, ...args); };
const originalSuccess = logger.success;
logger.success = (msg, ...args) => { addActivityLog(msg, 'success'); originalSuccess(msg, ...args); };
const originalWarn = logger.warn;
logger.warn = (msg, ...args) => { addActivityLog(msg, 'warn'); originalWarn(msg, ...args); };
const originalError = logger.error;
logger.error = (msg, ...args) => { addActivityLog(msg, 'error'); originalError(msg, ...args); };
/**
 * Main application entry point
 */
async function main() {
    logger.section('🌿 NATURE MEDIA UPLOADER — STARTING');
    
    // 1. Setup
    await ensureDirectories(APP_CONFIG.paths);
    await connectDB();

    // Auto-Sync Cloudinary on start
    const { syncCloudinary } = require('./scripts/syncCloudinary');
    await syncCloudinary();

    // Start Express server for Render health checks and Gallery
    app.listen(PORT, () => {
        logger.success(`Server is running on port ${PORT}`);
        logger.info(`Gallery available at: http://localhost:${PORT}`);
    });

    // Start the automation loop
    runAutomationLoop();
}

/**
 * Automation loop that runs periodically
 */
async function runAutomationLoop() {
    while (true) {
        try {
            await runPipeline();
        } catch (err) {
            logger.error('Pipeline error:', err);
        }

        const waitMinutes = 15;
        logger.info(`Sleeping for ${waitMinutes} minutes before next run...`);
        await new Promise(resolve => setTimeout(resolve, waitMinutes * 60 * 1000));
    }
}

/**
 * Single execution of the scrape → download → upload pipeline
 */
async function runPipeline() {
    const startTime = Date.now();
    logger.section('🚀 STARTING SCRAPE PIPELINE');

    // Load existing upload tracking
    const uploadedIds = await loadUploadedIds();
    
    // Fetch media from Pixabay
    const { images, videos } = await fetchAllMedia(APP_CONFIG.resultsPerKeyword);

    // Filter out already-uploaded items
    const newImages = images.filter(img => !uploadedIds.images.has(String(img.id)));
    const newVideos = videos.filter(vid => !uploadedIds.videos.has(String(vid.id)));

    logger.step('New images', String(newImages.length));
    logger.step('New videos', String(newVideos.length));

    if (newImages.length === 0 && newVideos.length === 0) {
        logger.warn('Nothing new to process.');
        return;
    }

    const stats = createStats();
    const allNewMedia = [
        ...newImages.map(item => ({ item, type: 'images' })),
        ...newVideos.map(item => ({ item, type: 'videos' }))
    ];

    // Process items one-by-one to save RAM on Render
    for (let i = 0; i < allNewMedia.length; i++) {
        const { item, type } = allNewMedia[i];
        const id = String(item.id);
        
        // Check if already uploaded (Universal Duplicate Prevention)
        if (uploadedIds[type].has(id)) {
            logger.warn(`ID ${id} already processed. Skipping everything.`);
            continue;
        }

        logger.step(`[${i + 1}/${allNewMedia.length}]`, `Processing ${type.slice(0, -1)}: ${item.id}`);

        try {
            const downloadResult = await downloadBatch([item], type);
            if (downloadResult.length === 0) continue;

            const { localPath } = downloadResult[0];
            const stats_info = await fs.stat(localPath);
            const fileSizeMB = stats_info.size / (1024 * 1024);
            
            // Cloudinary limit 100MB for free tier
            let cloudinaryResult = null;
            if (fileSizeMB <= 100) {
                const results = await uploadBatch([{ item, localPath }], type, uploadedIds, stats);
                if (results && results.length > 0) cloudinaryResult = results[0];
            } else {
                logger.warn(`Skipping Cloudinary for ${item.id}: File too large (${fileSizeMB.toFixed(1)}MB)`);
                // Record in DB even if skipped Cloudinary (for tracking)
                await recordSuccessfulUpload(item, { secure_url: 'skipped_due_to_size' }, type, uploadedIds);
            }
            
            // Telegram Upload (Always try Telegram)
            await sendMediaToTelegram(localPath, item, type);

            // Cleanup local file immediately
            await fs.remove(localPath); 
            logger.step('Cleanup', `Deleted local file: ${path.basename(localPath)}`);

        } catch (err) {
            logger.error(`Error processing item ${item.id}:`, err);
        }
    }

    await printFinalSummary(startTime, stats);
}

async function printFinalSummary(startTime, stats) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const metaSummary = await getMetadataSummary();

    logger.section('📊 EXECUTION SUMMARY');
    logger.step('Total Processed', String(stats.totalProcessed || 0));
    logger.step('Success', String(stats.success || 0));
    logger.step('Failed', String(stats.failed || 0));
    logger.step('DB Total Images', String(metaSummary.totalImages));
    logger.step('DB Total Videos', String(metaSummary.totalVideos));
    logger.step('Time elapsed', `${elapsed}s`);
}

function handleFatalError(error) {
    logger.error('FATAL ERROR', error);
    // On Render, we might want to stay alive even if a loop fails, 
    // but a truly fatal error should exit so Render restarts it.
    process.exit(1);
    logger.error('FATAL ERROR — Process terminated unexpectedly', error);
    logger.error(error.message);

    if (error.message.includes('Missing required environment variables')) {
        logger.warn('Please copy .env.example to .env and fill in your API credentials.');
    }

    process.exit(1);
}

process.on('uncaughtException', handleFatalError);
process.on('unhandledRejection', (reason) => {
    handleFatalError(reason instanceof Error ? reason : new Error(String(reason)));
});

// ─────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────
main().catch(handleFatalError);