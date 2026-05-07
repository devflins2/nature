'use strict';

const axios = require('axios');
const { APP_CONFIG } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const { sleep } = require('../utils/retry');

const PIXABAY_BASE_URL = 'https://pixabay.com/api/';
const PIXABAY_VIDEOS_URL = 'https://pixabay.com/api/videos/';

/**
 * Creates an Axios instance configured for Pixabay API
 * @returns {object} Axios instance
 */
function createPixabayClient() {
    return axios.create({
        timeout: 15000,
        headers: {
            'User-Agent': 'NatureMediaUploader/1.0',
        },
    });
}

/**
 * Fetches nature images from Pixabay for a given keyword
 * @param {string} keyword - Search keyword
 * @param {number} perPage - Number of results per page
 * @param {number} page - Page number
 * @returns {Promise<Array>} Array of image objects
 */
async function fetchImages(keyword, perPage = 20, page = 1) {
    const client = createPixabayClient();

    const params = {
        key: process.env.PIXABAY_API_KEY,
        q: keyword,
        image_type: 'photo',
        category: 'nature',
        orientation: 'all',
        min_width: 1920,
        min_height: 1080,
        safesearch: 'true',
        order: 'popular',
        per_page: Math.min(perPage, 200),
        page,
    };

    return await withRetry(
        async () => {
            logger.info(`Fetching images for keyword: "${keyword}" (page ${page})`, true);

            const response = await client.get(PIXABAY_BASE_URL, { params });

            if (!response.data || !response.data.hits) {
                throw new Error(`Invalid API response for keyword: ${keyword}`);
            }

            const items = response.data.hits;
            logger.info(`Found ${items.length} images for "${keyword}" (Total: ${response.data.totalHits})`, true);

            return items.map((item) => ({
                id: item.id,
                pageURL: item.pageURL,
                tags: item.tags,
                webformatURL: item.webformatURL,
                largeImageURL: item.largeImageURL,
                imageWidth: item.imageWidth,
                imageHeight: item.imageHeight,
                imageSize: item.imageSize,
                views: item.views,
                downloads: item.downloads,
                likes: item.likes,
                user: item.user,
                keyword,
                fetchedAt: new Date().toISOString(),
            }));
        },
        {
            maxAttempts: APP_CONFIG.maxRetryAttempts,
            baseDelay: APP_CONFIG.retryDelayMs,
            context: `Pixabay image fetch (${keyword})`,
        }
    );
}

/**
 * Fetches nature videos from Pixabay for a given keyword
 * @param {string} keyword - Search keyword
 * @param {number} perPage - Number of results per page
 * @param {number} page - Page number
 * @returns {Promise<Array>} Array of video objects
 */
async function fetchVideos(keyword, perPage = 20, page = 1) {
    const client = createPixabayClient();

    const params = {
        key: process.env.PIXABAY_API_KEY,
        q: keyword,
        video_type: 'film',
        category: 'nature',
        safesearch: 'true',
        order: 'popular',
        per_page: Math.min(perPage, 200),
        page,
    };

    return await withRetry(
        async () => {
            logger.info(`Fetching videos for keyword: "${keyword}" (page ${page})`, true);

            const response = await client.get(PIXABAY_VIDEOS_URL, { params });

            if (!response.data || !response.data.hits) {
                throw new Error(`Invalid API response for videos keyword: ${keyword}`);
            }

            const items = response.data.hits;
            logger.info(`Found ${items.length} videos for "${keyword}" (Total: ${response.data.totalHits})`, true);

            return items.map((item) => {
                // Select best available video quality (prefer HD)
                const videoUrl = item.videos?.hd?.url
                    || item.videos?.large?.url
                    || item.videos?.medium?.url
                    || null;

                return {
                    id: item.id,
                    pageURL: item.pageURL,
                    tags: item.tags,
                    videos: item.videos,
                    downloadUrl: videoUrl,
                    duration: item.duration,
                    views: item.views,
                    downloads: item.downloads,
                    likes: item.likes,
                    user: item.user,
                    keyword,
                    fetchedAt: new Date().toISOString(),
                };
            }).filter((item) => item.downloadUrl !== null); // Only items with valid download URLs
        },
        {
            maxAttempts: APP_CONFIG.maxRetryAttempts,
            baseDelay: APP_CONFIG.retryDelayMs,
            context: `Pixabay video fetch (${keyword})`,
            shouldRetry: (error) => {
                if (error.response?.status === 401 || error.response?.status === 403) {
                    logger.error("🛑 PIXABAY ERROR: Invalid API Key. Please check PIXABAY_API_KEY in your .env file.");
                    return false;
                }
                return true;
            }
        }
    );
}

/**
 * Fetches all media (images + videos) for all configured keywords
 * @param {number} perKeyword - Items to fetch per keyword
 * @returns {Promise<object>} Object with images and videos arrays
 */
async function fetchAllMedia(perKeyword = APP_CONFIG.resultsPerKeyword) {
    const allImages = [];
    const allVideos = [];
    const keywords = APP_CONFIG.searchKeywords;

    logger.section('FETCHING MEDIA FROM PIXABAY');
    logger.step('Keywords', keywords.join(', '));
    logger.step('Per keyword', String(perKeyword));

    for (let i = 0; i < keywords.length; i++) {
        const keyword = keywords[i];
        logger.progress('Fetching from Pixabay', i + 1, keywords.length, `keyword: "${keyword}"`);

        try {
            // Fetch images
            const images = await fetchImages(keyword, perKeyword);
            allImages.push(...images);
            logger.info(`  Images: +${images.length} (total: ${allImages.length})`, true);

            // Small delay between image and video requests
            await sleep(APP_CONFIG.apiRequestDelayMs / 2);

            // Fetch videos
            const videos = await fetchVideos(keyword, perKeyword);
            allVideos.push(...videos);
            logger.info(`  Videos: +${videos.length} (total: ${allVideos.length})`, true);
        } catch (error) {
            logger.error(`Failed to fetch media for keyword "${keyword}": ${error.message}`, error);
        }

        // Respectful delay between keywords
        if (i < keywords.length - 1) {
            await sleep(APP_CONFIG.apiRequestDelayMs);
        }
    }

    logger.progress('Fetching from Pixabay', keywords.length, keywords.length);

    // Deduplicate by ID (same item might appear in multiple keyword searches)
    const uniqueImages = deduplicateById(allImages);
    const uniqueVideos = deduplicateById(allVideos);

    logger.success(`Fetched ${uniqueImages.length} unique images and ${uniqueVideos.length} unique videos`);

    return { images: uniqueImages, videos: uniqueVideos };
}

/**
 * Removes duplicate items based on their ID
 * @param {Array} items - Array of items with id property
 * @returns {Array} Deduplicated array
 */
function deduplicateById(items) {
    const seen = new Set();
    return items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
}

module.exports = {
    fetchImages,
    fetchVideos,
    fetchAllMedia,
};