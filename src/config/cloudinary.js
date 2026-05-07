'use strict';

const cloudinary = require('cloudinary').v2;
require('dotenv').config();

/**
 * Validates that all required environment variables are present
 * @throws {Error} If any required env vars are missing
 */
function validateConfig() {
  const required = [
    'PIXABAY_API_KEY',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join('\n')}\n\nPlease check your .env file.`
    );
  }
}

/**
 * Initializes and returns Cloudinary configuration
 * @returns {object} Cloudinary instance
 */
function initCloudinary() {
  validateConfig();

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  return cloudinary;
}

/**
 * App-wide configuration object
 */
const APP_CONFIG = {
  resultsPerKeyword: parseInt(process.env.RESULTS_PER_KEYWORD) || 10,
  maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3,
  retryDelayMs: parseInt(process.env.RETRY_DELAY_MS) || 2000,
  apiRequestDelayMs: parseInt(process.env.API_REQUEST_DELAY_MS) || 1000,
  maxConcurrentUploads: parseInt(process.env.MAX_CONCURRENT_UPLOADS) || 3,
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB) || 50,
  keywordsPerCycle: parseInt(process.env.KEYWORDS_PER_CYCLE) || 8,
  pexelsApiKey: process.env.PEXELS_API_KEY,
  verboseLogging: process.env.VERBOSE_LOGGING === 'true',
  telegram: {
    enabled: process.env.ENABLE_TELEGRAM === 'true',
    apiId: parseInt(process.env.TELEGRAM_API_ID),
    apiHash: process.env.TELEGRAM_API_HASH,
    chatId: process.env.TELEGRAM_CHAT_ID,
    stringSession: process.env.TELEGRAM_STRING_SESSION
  },
  searchKeywords: [
    'nature',
    'forest',
    'river',
    'mountain',
    'waterfall',
    'rain',
    'sunset',
    'ocean',
    'trees',
    'roses',
    'flowers',
    'wildlife',
    'landscape',
    'jungle',
    'lake',
    'beach',
    'snow',
    'autumn',
    'spring',
    'sky',
    'animals',
    'birds',
    'butterfly',
    'clouds',
    'stars',
    'moon',
    'sun',
    'plants',
    'leaves',
    'grass',
    'insects',
    'fish',
    'coral',
    'underwater',
    'storm',
    'thunder',
    'lightning',
    'fog',
    'mist',
    'hills',
    'valleys',
    'caves',
    'islands',
  ],
  paths: {
    downloadsBase: './downloads',
    images: './downloads/images',
    videos: './downloads/videos',
    metadata: './metadata',
  },
  cloudinaryFolders: {
    images: 'nature/photos',
    videos: 'nature/videos',
  },
};

module.exports = { initCloudinary, APP_CONFIG };