'use strict';

const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const { APP_CONFIG } = require('../config/cloudinary');
const { Media } = require('../config/db');

const METADATA_FILES = {
    images: path.join(APP_CONFIG.paths.metadata, 'images_metadata.json'),
    videos: path.join(APP_CONFIG.paths.metadata, 'videos_metadata.json'),
    uploadedIds: path.join(APP_CONFIG.paths.metadata, 'uploaded_ids.json'),
    failedUploads: path.join(APP_CONFIG.paths.metadata, 'failed_uploads.json'),
};

/**
 * Loads metadata from a JSON file
 */
async function loadMetadataFile(filePath, defaultValue = []) {
    try {
        const exists = await fs.pathExists(filePath);
        if (!exists) return defaultValue;
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        return defaultValue;
    }
}

/**
 * Saves metadata to a JSON file
 */
async function saveMetadataFile(filePath, data) {
    try {
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        logger.error(`Could not save local metadata: ${error.message}`);
    }
}

/**
 * Loads the set of already uploaded Pixabay IDs
 * Uses MongoDB if available, otherwise falls back to local files
 */
async function loadUploadedIds() {
    try {
        // Try MongoDB first
        const dbItems = await Media.find({}, 'pixabayId type');
        if (dbItems && dbItems.length > 0) {
            const images = new Set();
            const videos = new Set();
            dbItems.forEach(item => {
                if (item.type === 'images') images.add(item.pixabayId);
                else videos.add(item.pixabayId);
            });
            logger.info('Loaded upload history from MongoDB');
            return { images, videos };
        }
    } catch (err) {
        logger.warn('Could not load from MongoDB, trying local files...');
    }

    // Fallback to local files
    const data = await loadMetadataFile(METADATA_FILES.uploadedIds, { images: [], videos: [] });
    return {
        images: new Set(data.images || []),
        videos: new Set(data.videos || []),
    };
}

/**
 * Records a successful upload in MongoDB and local tracking
 */
async function recordSuccessfulUpload(mediaItem, cloudinaryResult, type, uploadedIds) {
    const pixabayId = String(mediaItem.id);
    
    const metadata = {
        pixabayId,
        type,
        title: mediaItem.tags || 'Nature',
        tags: mediaItem.tags ? mediaItem.tags.split(',').map((t) => t.trim()) : [],
        pixabayUrl: mediaItem.pageURL || mediaItem.pixabayUrl,
        cloudinaryUrl: cloudinaryResult.secure_url,
        uploadedAt: new Date(),
    };

    // 1. Save to MongoDB
    try {
        await Media.findOneAndUpdate(
            { pixabayId },
            metadata,
            { upsert: true, new: true }
        );
        logger.success(`MongoDB: Recorded Pixabay ID ${pixabayId}`);
    } catch (err) {
        logger.error(`MongoDB recording failed: ${err.message}`);
    }

    // 2. Local Fallback/Gallery Support
    try {
        const existingMetadata = await loadMetadataFile(METADATA_FILES[type], []);
        existingMetadata.push({ ...metadata, uploadedAt: metadata.uploadedAt.toISOString() });
        await saveMetadataFile(METADATA_FILES[type], existingMetadata);

        uploadedIds[type].add(pixabayId);
        const data = {
            images: Array.from(uploadedIds.images),
            videos: Array.from(uploadedIds.videos),
            lastUpdated: new Date().toISOString(),
        };
        await saveMetadataFile(METADATA_FILES.uploadedIds, data);
    } catch (err) {
        logger.warn('Local metadata backup failed');
    }
}

/**
 * Records a failed upload attempt locally
 */
async function recordFailedUpload(mediaItem, type, error) {
    try {
        const existingFailed = await loadMetadataFile(METADATA_FILES.failedUploads, []);
        const failRecord = {
            pixabayId: String(mediaItem.id),
            type,
            errorMessage: error.message,
            failedAt: new Date().toISOString(),
        };
        existingFailed.push(failRecord);
        await saveMetadataFile(METADATA_FILES.failedUploads, existingFailed);
    } catch (err) {
        // Ignore
    }
}

/**
 * Loads and returns a summary
 */
async function getMetadataSummary() {
    let stats = { totalImages: 0, totalVideos: 0 };
    
    try {
        stats.totalImages = await Media.countDocuments({ type: 'images' });
        stats.totalVideos = await Media.countDocuments({ type: 'videos' });
    } catch (err) {
        const images = await loadMetadataFile(METADATA_FILES.images, []);
        const videos = await loadMetadataFile(METADATA_FILES.videos, []);
        stats.totalImages = images.length;
        stats.totalVideos = videos.length;
    }

    return {
        ...stats,
        totalUploadedIds: stats.totalImages + stats.totalVideos,
        metadataFiles: METADATA_FILES,
    };
}

module.exports = {
    loadUploadedIds,
    recordSuccessfulUpload,
    recordFailedUpload,
    getMetadataSummary,
    loadMetadataFile,
    saveMetadataFile,
    METADATA_FILES,
};