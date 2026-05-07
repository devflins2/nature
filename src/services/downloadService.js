'use strict';

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { APP_CONFIG } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { withRetry, sleep } = require('../utils/retry');
const { isValidFile, safeRemoveFile, generateFileName } = require('../utils/fileUtils');

/**
 * Downloads a file from a URL to a local path
 * @param {string} url - URL to download from
 * @param {string} destPath - Destination file path
 * @returns {Promise<boolean>} True if download succeeded
 */
async function downloadFile(url, destPath) {
    return await withRetry(
        async () => {
            const response = await axios({
                method: 'GET',
                url,
                responseType: 'stream',
                timeout: 60000, // 60 second timeout for downloads
                headers: {
                    'User-Agent': 'NatureMediaUploader/1.0',
                },
                maxRedirects: 5,
            });

            // Check content type to detect issues early
            const contentType = response.headers['content-type'] || '';
            const contentLength = parseInt(response.headers['content-length'] || '0');

            if (contentLength > 0 && contentLength < 1024) {
                throw new Error(`File too small (${contentLength} bytes), likely corrupted`);
            }

            const maxBytes = APP_CONFIG.maxFileSizeMb * 1024 * 1024;
            if (contentLength > maxBytes) {
                throw new Error(`File too large (${(contentLength / (1024 * 1024)).toFixed(1)}MB). Limit is ${APP_CONFIG.maxFileSizeMb}MB.`);
            }

            // Write file to disk using streaming
            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(destPath);

                response.data.on('error', reject);
                writer.on('error', reject);
                writer.on('finish', resolve);

                response.data.pipe(writer);
            });

            // Validate the downloaded file
            const isValid = await isValidFile(destPath, 1024);
            if (!isValid) {
                await safeRemoveFile(destPath);
                throw new Error(`Downloaded file failed validation: ${path.basename(destPath)}`);
            }

            return true;
        },
        {
            maxAttempts: APP_CONFIG.maxRetryAttempts,
            baseDelay: APP_CONFIG.retryDelayMs,
            context: `Download ${path.basename(destPath)}`,
            shouldRetry: (error) => {
                // Don't retry if file validation failed due to content issues
                if (error.message.includes('too small')) return false;
                return true;
            },
        }
    );
}

/**
 * Downloads an image from Pixabay
 * @param {object} imageItem - Pixabay image item
 * @returns {Promise<string|null>} Local file path or null if failed
 */
async function downloadImage(imageItem) {
    const downloadUrl = imageItem.largeImageURL || imageItem.webformatURL;

    if (!downloadUrl) {
        logger.warn(`No download URL for image ID: ${imageItem.id}`);
        return null;
    }

    const fileName = `img_${imageItem.id}_${generateFileName(downloadUrl)}`;
    const destPath = path.join(APP_CONFIG.paths.images, fileName);

    // Check if already downloaded
    const alreadyExists = await isValidFile(destPath);
    if (alreadyExists) {
        logger.info(`Image already downloaded: ${fileName}`, true);
        return destPath;
    }

    try {
        await downloadFile(downloadUrl, destPath);
        logger.info(`Downloaded image: ${fileName}`, true);
        return destPath;
    } catch (error) {
        logger.error(`Failed to download image ${imageItem.id}: ${error.message}`, error);
        await safeRemoveFile(destPath); // Clean up partial download
        return null;
    }
}

/**
 * Downloads a video from Pixabay
 * @param {object} videoItem - Pixabay video item
 * @returns {Promise<string|null>} Local file path or null if failed
 */
async function downloadVideo(videoItem) {
    const downloadUrl = videoItem.downloadUrl;

    if (!downloadUrl) {
        logger.warn(`No download URL for video ID: ${videoItem.id}`);
        return null;
    }

    // Determine file extension from URL
    const urlPath = downloadUrl.split('?')[0];
    const ext = path.extname(urlPath) || '.mp4';
    const fileName = `vid_${videoItem.id}${ext}`;
    const destPath = path.join(APP_CONFIG.paths.videos, fileName);

    // Check if already downloaded
    const alreadyExists = await isValidFile(destPath, 10240); // Videos should be > 10KB
    if (alreadyExists) {
        logger.info(`Video already downloaded: ${fileName}`, true);
        return destPath;
    }

    try {
        await downloadFile(downloadUrl, destPath);
        logger.info(`Downloaded video: ${fileName}`, true);
        return destPath;
    } catch (error) {
        logger.error(`Failed to download video ${videoItem.id}: ${error.message}`, error);
        await safeRemoveFile(destPath); // Clean up partial download
        return null;
    }
}

/**
 * Downloads multiple media files with progress tracking
 * @param {Array} items - Array of media items to download
 * @param {string} type - Media type ('images' or 'videos')
 * @returns {Promise<Array>} Array of {item, localPath} objects for successful downloads
 */
async function downloadBatch(items, type) {
    const results = [];
    const downloadFn = type === 'images' ? downloadImage : downloadVideo;

    logger.step(`Downloading ${type}`, `${items.length} items`);

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        logger.progress(`Downloading ${type}`, i + 1, items.length, `ID: ${item.id}`);

        try {
            const localPath = await downloadFn(item);

            if (localPath) {
                results.push({ item, localPath });
            } else {
                logger.warn(`Skipping download for ${type} ID: ${item.id} (no path returned)`);
            }
        } catch (error) {
            logger.error(`Unexpected error downloading ${type} ID ${item.id}: ${error.message}`, error);
        }

        // Small delay between downloads
        if (i < items.length - 1) {
            await sleep(200);
        }
    }

    logger.progress(`Downloading ${type}`, items.length, items.length);
    logger.success(`Downloaded ${results.length}/${items.length} ${type} successfully`);

    return results;
}

module.exports = {
    downloadImage,
    downloadVideo,
    downloadBatch,
};