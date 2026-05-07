require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');

const { APP_CONFIG } = require('./config/cloudinary');
const { connectDB } = require('./config/db');
const { fetchAllMedia: fetchPixabay } = require('./services/pixabayService');
const { fetchAllMedia: fetchPexels } = require('./services/pexelsService');
const { downloadBatch } = require('./services/downloadService');
const { uploadBatch, createStats } = require('./services/uploadService');
const { loadUploadedIds, getMetadataSummary, recordSuccessfulUpload } = require('./services/metadataService');
const { ensureDirectories } = require('./utils/fileUtils');
const { sendMediaToTelegram } = require('./services/telegramService');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for JSON parsing
app.use(express.json());

// Serve static gallery files
app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../dashboard.html')));
app.get('/health', (req, res) => res.send('OK'));

// API to fetch media from MongoDB (High Speed + Pagination)
app.get('/api/media', async (req, res) => {
    try {
        const { Media } = require('./config/db');
        const limit = parseInt(req.query.limit) || 40;
        const offset = parseInt(req.query.offset) || 0;
        
        // Fetch with pagination for super-fast response
        const images = await Media.find({ type: 'images' })
            .sort({ uploadedAt: -1 })
            .skip(offset)
            .limit(limit);
            
        const videos = await Media.find({ type: 'videos' })
            .sort({ uploadedAt: -1 })
            .skip(offset)
            .limit(limit);

        res.json({ images, videos });
    } catch (err) {
        console.error("API Fetch Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Background Sync Task: Merges existing Cloudinary assets into DB every 15 mins
const syncCloudinaryToDB = async () => {
    try {
        const cloudinary = require('cloudinary').v2;
        const { Media } = require('./config/db');
        if (!process.env.CLOUDINARY_URL) return;

        cloudinary.config(true);
        console.log("[Sync] Checking Cloudinary for existing assets...");
        
        const fetchAndSync = async (resourceType) => {
            const cloudRes = await cloudinary.api.resources({ 
                resource_type: resourceType,
                type: 'upload', 
                max_results: 500,
                context: true 
            });

            for (const r of cloudRes.resources) {
                const url = r.secure_url;
                const exists = await Media.findOne({ cloudinaryUrl: url });
                if (!exists) {
                    await Media.create({
                        pixabayId: r.context?.custom?.pixabay_id || r.public_id.split('/').pop(),
                        title: r.context?.custom?.caption || r.public_id.split('/').pop(),
                        cloudinaryUrl: url,
                        type: r.resource_type === 'image' ? 'images' : 'videos',
                        uploadedAt: r.created_at,
                        cloudinaryFormat: r.format,
                        tags: r.tags || []
                    });
                    console.log(`[Sync] Added missing ${r.resource_type}: ${url}`);
                }
            }
        };

        await fetchAndSync('image');
        await fetchAndSync('video');
        console.log("[Sync] Cloudinary background sync complete.");
    } catch (err) {
        console.error("[Sync] Background sync failed:", err.message);
    }
};

// Run sync on startup and every 15 minutes
syncCloudinaryToDB();
setInterval(syncCloudinaryToDB, 15 * 60 * 1000);

// Admin Auth Check
app.post('/api/auth', (req, res) => {
    const { user, pass } = req.body;
    if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
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
    
    // Start Express server IMMEDIATELY for Render
    app.listen(PORT, () => {
        logger.success(`Server is running on port ${PORT}`);
    });

    // 1. Setup
    await ensureDirectories(APP_CONFIG.paths);
    await connectDB();

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
    
    // Fetch media from multiple sources
    const pixabayData = await fetchPixabay(APP_CONFIG.resultsPerKeyword);
    const pexelsData = await fetchPexels(APP_CONFIG.resultsPerKeyword);

    const images = [...pixabayData.images, ...pexelsData.images];
    const videos = [...pixabayData.videos, ...pexelsData.videos];

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
    ].sort(() => 0.5 - Math.random()); // SHUFFLE to mix images and videos

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
                // Record in DB with a placeholder URL so we don't try to re-upload it to Cloudinary
                const { Media } = require('./config/db');
                await Media.create({
                    pixabayId: item.id,
                    title: item.title || item.tags?.[0] || 'Nature Media',
                    cloudinaryUrl: 'skipped_due_to_size',
                    type: type,
                    uploadedAt: new Date(),
                    tags: item.tags || []
                });
                uploadedIds[type].add(String(item.id));
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