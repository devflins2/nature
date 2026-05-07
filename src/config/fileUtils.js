'use strict';

const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

/**
 * Ensures all required directories exist
 * @param {object} paths - Paths configuration object
 * @returns {Promise<void>}
 */
async function ensureDirectories(paths) {
    const dirs = Object.values(paths);
    for (const dir of dirs) {
        await fs.ensureDir(dir);
        logger.info(`Directory ensured: ${dir}`, true);
    }
    logger.success('All required directories are ready');
}

/**
 * Checks if a file exists and has a minimum size (to detect corrupted files)
 * @param {string} filePath - Path to the file
 * @param {number} minSizeBytes - Minimum acceptable file size in bytes
 * @returns {Promise<boolean>} True if file is valid
 */
async function isValidFile(filePath, minSizeBytes = 1024) {
    try {
        const exists = await fs.pathExists(filePath);
        if (!exists) return false;

        const stats = await fs.stat(filePath);
        if (stats.size < minSizeBytes) {
            logger.warn(`File too small (${stats.size} bytes), likely corrupted: ${path.basename(filePath)}`);
            return false;
        }

        return true;
    } catch (error) {
        logger.error(`Error checking file validity: ${filePath}`, error);
        return false;
    }
}

/**
 * Safely removes a file if it exists
 * @param {string} filePath - Path to the file
 * @returns {Promise<void>}
 */
async function safeRemoveFile(filePath) {
    try {
        const exists = await fs.pathExists(filePath);
        if (exists) {
            await fs.remove(filePath);
            logger.info(`Removed file: ${path.basename(filePath)}`, true);
        }
    } catch (error) {
        logger.warn(`Could not remove file ${filePath}: ${error.message}`);
    }
}

/**
 * Gets file size in human-readable format
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} Human-readable file size
 */
async function getFileSizeFormatted(filePath) {
    try {
        const stats = await fs.stat(filePath);
        const bytes = stats.size;

        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    } catch {
        return 'Unknown size';
    }
}

/**
 * Generates a safe filename from a URL
 * @param {string} url - URL to extract filename from
 * @param {string} prefix - Optional prefix
 * @returns {string} Safe filename
 */
function generateFileName(url, prefix = '') {
    const urlPath = url.split('?')[0]; // Remove query params
    const ext = path.extname(urlPath) || '.jpg';
    const baseName = path.basename(urlPath, ext);
    const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    return prefix ? `${prefix}_${safeName}${ext}` : `${safeName}${ext}`;
}

/**
 * Calculates MD5-like hash from string (simple version using content)
 * @param {string} str - String to hash
 * @returns {string} Hash string
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}

module.exports = {
    ensureDirectories,
    isValidFile,
    safeRemoveFile,
    getFileSizeFormatted,
    generateFileName,
    simpleHash,
};