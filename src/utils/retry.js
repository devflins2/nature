'use strict';

const logger = require('./logger');

/**
 * Sleeps for the specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates exponential backoff delay
 * @param {number} attempt - Current attempt number (1-indexed)
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffDelay(attempt, baseDelay) {
    // Exponential backoff: baseDelay * 2^(attempt-1) + small random jitter
    const exponential = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 500;
    return Math.min(exponential + jitter, 30000); // Cap at 30 seconds
}

/**
 * Retries an async function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts
 * @param {number} options.baseDelay - Base delay between retries in ms
 * @param {string} options.context - Context string for logging
 * @param {Function} [options.shouldRetry] - Function to determine if error should trigger retry
 * @returns {Promise<*>} Result of the function
 * @throws {Error} If all attempts fail
 */
async function withRetry(fn, options = {}) {
    const {
        maxAttempts = 3,
        baseDelay = 2000,
        context = 'Operation',
        shouldRetry = () => true,
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const result = await fn(attempt);
            if (attempt > 1) {
                logger.success(`${context} succeeded on attempt ${attempt}/${maxAttempts}`);
            }
            return result;
        } catch (error) {
            lastError = error;

            // Check if we should retry this type of error
            if (!shouldRetry(error)) {
                logger.error(`${context} failed with non-retryable error: ${error.message}`);
                throw error;
            }

            if (attempt < maxAttempts) {
                const delay = calculateBackoffDelay(attempt, baseDelay);
                logger.retry(attempt, maxAttempts, error.message);
                logger.info(`  Waiting ${Math.round(delay)}ms before retry...`, true);
                await sleep(delay);
            } else {
                logger.error(`${context} failed after ${maxAttempts} attempts: ${error.message}`, error);
            }
        }
    }

    throw lastError;
}

/**
 * Determines if a Cloudinary/HTTP error should be retried
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error is retryable
 */
function isRetryableError(error) {
    // Don't retry authentication errors
    if (error.http_code === 401 || error.http_code === 403) return false;
    // Don't retry invalid file errors
    if (error.http_code === 400) return false;
    // Retry rate limits, server errors, and network issues
    if (error.http_code === 429) return true;
    if (error.http_code >= 500) return true;
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
    if (error.message?.includes('timeout')) return true;
    if (error.message?.includes('network')) return true;
    return true; // Default to retrying
}

module.exports = { withRetry, isRetryableError, sleep };
