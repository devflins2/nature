'use strict';

const axios = require('axios');
const { APP_CONFIG } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { withRetry, sleep } = require('../utils/retry');

const PEXELS_BASE_URL = 'https://api.pexels.com/v1/';
const PEXELS_VIDEOS_URL = 'https://api.pexels.com/videos/';

/**
 * Creates an Axios instance configured for Pexels API
 * @returns {object} Axios instance
 */
function createPexelsClient() {
    const apiKey = APP_CONFIG.pexelsApiKey;
    return axios.create({
        timeout: 15000,
        headers: {
            'Authorization': apiKey,
            'User-Agent': 'NatureMediaUploader/1.0',
        },
    });
}

/**
 * Fetches nature images from Pexels
 * @param {string} keyword - Search keyword
 * @param {number} perPage - Number of results per page
 * @param {number} page - Page number
 * @returns {Promise<Array>} Array of image objects
 */
async function fetchImages(keyword, perPage = 20, page = 1) {
    if (!APP_CONFIG.pexelsApiKey) return [];
    const client = createPexelsClient();

    return await withRetry(
        async () => {
            logger.info(`[Pexels] Fetching images for: "${keyword}" (page ${page})`, true);

            const response = await client.get(`${PEXELS_BASE_URL}search`, {
                params: {
                    query: `${keyword} nature`,
                    per_page: perPage,
                    page,
                }
            });

            if (!response.data || !response.data.photos) {
                throw new Error(`Invalid Pexels response for keyword: ${keyword}`);
            }

            const items = response.data.photos;
            logger.info(`[Pexels] Found ${items.length} images for "${keyword}"`, true);

            return items.map((item) => ({
                id: `pex_${item.id}`,
                originalId: item.id,
                pageURL: item.url,
                tags: keyword.split(' '),
                webformatURL: item.src.large,
                largeImageURL: item.src.original,
                imageWidth: item.width,
                imageHeight: item.height,
                user: item.photographer,
                source: 'pexels',
                keyword,
                fetchedAt: new Date().toISOString(),
            }));
        },
        {
            maxAttempts: APP_CONFIG.maxRetryAttempts,
            baseDelay: APP_CONFIG.retryDelayMs,
            context: `Pexels image fetch (${keyword})`,
        }
    );
}

/**
 * Fetches nature videos from Pexels
 * @param {string} keyword - Search keyword
 * @param {number} perPage - Number of results per page
 * @param {number} page - Page number
 * @returns {Promise<Array>} Array of video objects
 */
async function fetchVideos(keyword, perPage = 20, page = 1) {
    if (!APP_CONFIG.pexelsApiKey) return [];
    const client = createPexelsClient();

    return await withRetry(
        async () => {
            logger.info(`[Pexels] Fetching videos for: "${keyword}" (page ${page})`, true);

            const response = await client.get(`${PEXELS_VIDEOS_URL}search`, {
                params: {
                    query: `${keyword} nature`,
                    per_page: perPage,
                    page,
                }
            });

            if (!response.data || !response.data.videos) {
                throw new Error(`Invalid Pexels response for videos keyword: ${keyword}`);
            }

            const items = response.data.videos;
            logger.info(`[Pexels] Found ${items.length} videos for "${keyword}"`, true);

            return items.map((item) => {
                // Select best available video quality
                const videoFile = item.video_files.find(f => f.quality === 'hd') 
                               || item.video_files.find(f => f.quality === 'sd')
                               || item.video_files[0];

                return {
                    id: `pex_${item.id}`,
                    originalId: item.id,
                    pageURL: item.url,
                    tags: keyword.split(' '),
                    downloadUrl: videoFile?.link,
                    duration: item.duration,
                    user: item.user.name,
                    source: 'pexels',
                    keyword,
                    fetchedAt: new Date().toISOString(),
                };
            }).filter((item) => item.downloadUrl);
        },
        {
            maxAttempts: APP_CONFIG.maxRetryAttempts,
            baseDelay: APP_CONFIG.retryDelayMs,
            context: `Pexels video fetch (${keyword})`,
        }
    );
}

/**
 * Fetches all media from Pexels for random keywords
 */
async function fetchAllMedia(perKeyword = APP_CONFIG.resultsPerKeyword) {
    if (!APP_CONFIG.pexelsApiKey) {
        logger.warn('[Pexels] Skipping: PEXELS_API_KEY not found in .env');
        return { images: [], videos: [] };
    }

    const allImages = [];
    const allVideos = [];
    
    const shuffledKeywords = [...APP_CONFIG.searchKeywords].sort(() => 0.5 - Math.random());
    const keywords = shuffledKeywords.slice(0, APP_CONFIG.keywordsPerCycle);

    logger.section('FETCHING MEDIA FROM PEXELS');

    for (let i = 0; i < keywords.length; i++) {
        const keyword = keywords[i];
        const randomPage = Math.floor(Math.random() * 5) + 1; // Random page 1-5

        try {
            const images = await fetchImages(keyword, perKeyword, randomPage);
            allImages.push(...images);

            await sleep(APP_CONFIG.apiRequestDelayMs / 2);

            const videos = await fetchVideos(keyword, perKeyword, randomPage);
            allVideos.push(...videos);
        } catch (error) {
            logger.error(`[Pexels] Failed for "${keyword}": ${error.message}`);
        }

        if (i < keywords.length - 1) await sleep(APP_CONFIG.apiRequestDelayMs);
    }

    return { images: allImages, videos: allVideos };
}

module.exports = {
    fetchImages,
    fetchVideos,
    fetchAllMedia,
};
