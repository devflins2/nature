'use strict';

const fs = require('fs-extra');
const path = require('path');
const { initCloudinary, APP_CONFIG } = require('../config/cloudinary');
const { metadataService } = require('./metadataService');
const logger = require('../utils/logger');
const { withRetry, isRetryableError, sleep } = require('../utils/retry');
const {
    isValidFile,
    safeRemoveFile,
    getFileSizeFormatted,
} = require('../utils/fileUtils');
const {
    recordSuccessfulUpload,
    recordFailedUpload,
} = require('./metadataService');

// Initialize Cloudinary
const cloudinary = initCloudinary();

/**
 * Stats tracking object
 */
function createStats() {
    return {
        imagesUploaded: 0,
        videosUploaded: 0,
        imagesSkipped: 0,
        videosSkipped: 0,
        failed: 0,
        corrupted: 0,
        totalProcessed: 0,
    };
}

/**
 * Uploads a single image to Cloudinary
 * @param {string} localPath - Local file path
 * @param {object} item - Pixabay item metadata
 * @returns {Promise<object>} Cloudinary upload result
 */
async function uploadImageToCloudinary(localPath, item) {
    const publicId = `${APP_CONFIG.cloudinaryFolders.images}/${item.id}`;
    const tags = item.tags
        ? item.tags.split(',').map((t) => t.trim()).slice(0, 10)
        : ['nature'];

    return await withRetry(
        async () => {
            const result = await cloudinary.uploader.upload(localPath, {
                public_id: publicId,
                resource_type: 'image',
                folder: '', // We include folder in public_id
                tags: [...tags, 'nature', 'pixabay'],
                context: {
                    pixabay_id: String(item.id),
                    pixabay_url: item.pageURL || '',
                    tags: item.tags || '',
                    keyword: item.keyword || '',
                },
                overwrite: false,
                unique_filename: false,
                quality: 'auto:best',
                fetch_format: 'auto',
            });

            return result;
        },
        {
            maxAttempts: APP_CONFIG.maxRetryAttempts,
            baseDelay: APP_CONFIG.retryDelayMs,
            context: `Upload image ${item.id}`,
            shouldRetry: isRetryableError,
        }
    );
}

/**
 * Uploads a single video to Cloudinary
 * @param {string} localPath - Local file path
 * @param {object} item - Pixabay item metadata
 * @returns {Promise<object>} Cloudinary upload result
 */
async function uploadVideoToCloudinary(localPath, item) {
    const publicId = `${APP_CONFIG.cloudinaryFolders.videos}/${item.id}`;
    const tags = item.tags
        ? item.tags.split(',').map((t) => t.trim()).slice(0, 10)
        : ['nature'];

    return await withRetry(
        async () => {
            const result = await cloudinary.uploader.upload(localPath, {
                public_id: publicId,
                resource_type: 'video', // MUST be "video" for video files
                folder: '',
                tags: [...tags, 'nature', 'pixabay'],
                context: {
                    pixabay_id: String(item.id),
                    pixabay_url: item.pageURL || '',
                    tags: item.tags || '',
                    keyword: item.keyword || '',
                    duration: String(item.duration || ''),
                },
                overwrite: false,
                unique_filename: false,
                // Video-specific transformations
                eager: [
                    { format: 'mp4', quality: 'auto' },
                ],
                eager_async: true,
            });

            return result;
        },
        {
            maxAttempts: APP_CONFIG.maxRetryAttempts,
            baseDelay: APP_CONFIG.retryDelayMs,
            context: `Upload video ${item.id}`,
            shouldRetry: (error) => {
                if (error.http_code === 401) {
                    logger.error("🛑 CLOUDINARY ERROR: Invalid API Key or Secret. Check your .env file.");
                    return false;
                }
                if (error.message?.includes('Unknown Cloud')) {
                    logger.error(`🛑 CLOUDINARY ERROR: Cloud name "${APP_CONFIG.cloudinaryFolders.cloud_name}" not found. Check your .env file.`);
                    return false;
                }
                return isRetryableError(error);
            },
        }
    );
}

/**
 * Processes and uploads a batch of media items
 * @param {Array} downloadedItems - Array of {item, localPath} from download service
 * @param {string} type - Media type ('images' or 'videos')
 * @param {object} uploadedIds - Uploaded IDs tracking Set
 * @param {object} stats - Stats tracking object
 * @returns {Promise<void>}
 */
async function uploadBatch(downloadedItems, type, uploadedIds, stats) {
    if (downloadedItems.length === 0) {
        logger.warn(`No ${type} to upload`);
        return;
    }

    logger.step(`Uploading ${type}`, `${downloadedItems.length} items to Cloudinary`);

    const uploadFn = type === 'images' ? uploadImageToCloudinary : uploadVideoToCloudinary;
    const minFileSize = type === 'images' ? 1024 : 10240;

    // Process uploads with limited concurrency
    const chunks = chunkArray(downloadedItems, APP_CONFIG.maxConcurrentUploads);

    let processedCount = 0;

    for (const chunk of chunks) {
        // Process chunk concurrently
        const chunkPromises = chunk.map(async ({ item, localPath }) => {
            stats.totalProcessed++;

            try {
                // Check if already uploaded (duplicate prevention)
                if (uploadedIds[type].has(String(item.id))) {
                    logger.skip(`Already uploaded ${type} ID: ${item.id}`);
                    if (type === 'images') stats.imagesSkipped++;
                    else stats.videosSkipped++;
                    return;
                }

                // Validate file integrity before upload
                const fileValid = await isValidFile(localPath, minFileSize);
                if (!fileValid) {
                    logger.warn(`Corrupted file detected, skipping: ${path.basename(localPath)}`);
                    await safeRemoveFile(localPath);
                    stats.corrupted++;
                    return;
                }

                // Get file size for logging
                const fileSize = await getFileSizeFormatted(localPath);
                logger.step(
                    `Uploading ${type.slice(0, -1)}`,
                    `ID: ${item.id} | Size: ${fileSize} | Tags: ${(item.tags || '').slice(0, 40)}...`
                );

                // Upload to Cloudinary
                const result = await uploadFn(localPath, item);

                // Record successful upload
                await recordSuccessfulUpload(item, result, type, uploadedIds);

                if (type === 'images') stats.imagesUploaded++;
                else stats.videosUploaded++;

                logger.success(`Uploaded ${type.slice(0, -1)} ${item.id} → ${result.secure_url}`);
            } catch (error) {
                logger.error(`Failed to upload ${type.slice(0, -1)} ID ${item.id}: ${error.message}`, error);

                // Record failure for debugging
                await recordFailedUpload(item, type, error);
                stats.failed++;
            } finally {
                processedCount++;
                logger.progress(
                    `Uploading ${type}`,
                    processedCount,
                    downloadedItems.length,
                    `Success: ${type === 'images' ? stats.imagesUploaded : stats.videosUploaded}`
                );
            }
        });

        // Wait for current chunk to complete before starting next
        await Promise.all(chunkPromises);

        // Small delay between chunks to avoid rate limiting
        if (chunks.indexOf(chunk) < chunks.length - 1) {
            await sleep(500);
        }
    }

    logger.progress(`Uploading ${type}`, downloadedItems.length, downloadedItems.length);
}

/**
 * Splits an array into chunks of specified size
 * @param {Array} array - Array to chunk
 * @param {number} size - Chunk size
 * @returns {Array} Array of chunks
 */
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

module.exports = {
    uploadBatch,
    uploadImageToCloudinary,
    uploadVideoToCloudinary,
    createStats,
};