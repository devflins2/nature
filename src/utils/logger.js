'use strict';

const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgBlue: '\x1b[44m',
    bgGreen: '\x1b[42m',
};

/**
 * Formats current timestamp for logging
 * @returns {string} Formatted timestamp
 */
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Creates a formatted progress bar string
 * @param {number} current - Current progress value
 * @param {number} total - Total value
 * @param {number} width - Width of the progress bar
 * @returns {string} Progress bar string
 */
function createProgressBar(current, total, width = 30) {
    if (total === 0) return '[' + '░'.repeat(width) + '] 0%';

    const percentage = Math.min(Math.round((current / total) * 100), 100);
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `[${bar}] ${percentage}%`;
}

const logger = {
    /**
     * Logs an info message
     * @param {string} message - Message to log
     * @param {boolean} verbose - Only log if verbose mode is enabled
     */
    info(message, verbose = false) {
        if (verbose && process.env.VERBOSE_LOGGING !== 'true') return;
        console.log(
            `${COLORS.dim}[${getTimestamp()}]${COLORS.reset} ${COLORS.cyan}ℹ${COLORS.reset} ${message}`
        );
    },

    /**
     * Logs a success message
     * @param {string} message - Message to log
     */
    success(message) {
        console.log(
            `${COLORS.dim}[${getTimestamp()}]${COLORS.reset} ${COLORS.green}✔${COLORS.reset} ${message}`
        );
    },

    /**
     * Logs a warning message
     * @param {string} message - Message to log
     */
    warn(message) {
        console.warn(
            `${COLORS.dim}[${getTimestamp()}]${COLORS.reset} ${COLORS.yellow}⚠${COLORS.reset} ${message}`
        );
    },

    /**
     * Logs an error message
     * @param {string} message - Message to log
     * @param {Error} [error] - Optional error object
     */
    error(message, error = null) {
        console.error(
            `${COLORS.dim}[${getTimestamp()}]${COLORS.reset} ${COLORS.red}✖${COLORS.reset} ${message}`
        );
        if (error && process.env.VERBOSE_LOGGING === 'true') {
            console.error(`${COLORS.red}  Stack: ${error.stack}${COLORS.reset}`);
        }
    },

    /**
     * Logs a section header
     * @param {string} title - Section title
     */
    section(title) {
        const line = '═'.repeat(60);
        console.log(`\n${COLORS.bright}${COLORS.blue}${line}${COLORS.reset}`);
        console.log(
            `${COLORS.bright}${COLORS.blue}  ${title}${COLORS.reset}`
        );
        console.log(`${COLORS.bright}${COLORS.blue}${line}${COLORS.reset}\n`);
    },

    /**
     * Logs progress with a visual progress bar
     * @param {string} label - Progress label
     * @param {number} current - Current count
     * @param {number} total - Total count
     * @param {string} [extra] - Extra info to display
     */
    progress(label, current, total, extra = '') {
        const bar = createProgressBar(current, total);
        const extraText = extra ? ` | ${extra}` : '';
        process.stdout.write(
            `\r${COLORS.dim}[${getTimestamp()}]${COLORS.reset} ${COLORS.magenta}⟳${COLORS.reset} ${label} ${bar} (${current}/${total})${extraText}   `
        );
        if (current >= total) {
            process.stdout.write('\n');
        }
    },

    /**
     * Logs a step within a process
     * @param {string} step - Step name
     * @param {string} detail - Step detail
     */
    step(step, detail) {
        console.log(
            `${COLORS.dim}[${getTimestamp()}]${COLORS.reset} ${COLORS.yellow}→${COLORS.reset} ${COLORS.bright}${step}:${COLORS.reset} ${detail}`
        );
    },

    /**
     * Logs a skip message
     * @param {string} message - Message to log
     */
    skip(message) {
        console.log(
            `${COLORS.dim}[${getTimestamp()}]${COLORS.reset} ${COLORS.dim}⊘ SKIP:${COLORS.reset} ${message}`
        );
    },

    /**
     * Logs retry attempt information
     * @param {number} attempt - Current attempt number
     * @param {number} max - Maximum attempts
     * @param {string} reason - Reason for retry
     */
    retry(attempt, max, reason) {
        console.log(
            `${COLORS.dim}[${getTimestamp()}]${COLORS.reset} ${COLORS.yellow}↺ RETRY${COLORS.reset} (${attempt}/${max}): ${reason}`
        );
    },

    /**
     * Prints final summary statistics
     * @param {object} stats - Statistics object
     */
    summary(stats) {
        const line = '─'.repeat(50);
        console.log(`\n${COLORS.bright}${line}${COLORS.reset}`);
        console.log(`${COLORS.bright}  📊 FINAL SUMMARY${COLORS.reset}`);
        console.log(`${COLORS.bright}${line}${COLORS.reset}`);
        console.log(`  ${COLORS.green}✔ Images uploaded:  ${stats.imagesUploaded}${COLORS.reset}`);
        console.log(`  ${COLORS.green}✔ Videos uploaded:  ${stats.videosUploaded}${COLORS.reset}`);
        console.log(`  ${COLORS.yellow}⊘ Images skipped:  ${stats.imagesSkipped}${COLORS.reset}`);
        console.log(`  ${COLORS.yellow}⊘ Videos skipped:  ${stats.videosSkipped}${COLORS.reset}`);
        console.log(`  ${COLORS.red}✖ Failed uploads:  ${stats.failed}${COLORS.reset}`);
        console.log(`  ${COLORS.red}✖ Corrupted files: ${stats.corrupted}${COLORS.reset}`);
        console.log(`  ${COLORS.cyan}ℹ Total processed: ${stats.totalProcessed}${COLORS.reset}`);
        console.log(`${COLORS.bright}${line}${COLORS.reset}\n`);
    },
};

module.exports = logger;
