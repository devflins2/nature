'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * MongoDB Media Schema
 * Stores information about already uploaded Pixabay items
 */
const mediaSchema = new mongoose.Schema({
    pixabayId: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['images', 'videos'], required: true },
    title: String,
    tags: [String],
    pixabayUrl: String,
    cloudinaryUrl: String,
    uploadedAt: { type: Date, default: Date.now },
});

const Media = mongoose.model('Media', mediaSchema);

/**
 * Connects to MongoDB
 */
async function connectDB() {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
        logger.error('MONGODB_URI is missing in .env file!');
        logger.warn('Persistent tracking will not work. Duplicates may occur on restart.');
        return null;
    }

    try {
        await mongoose.connect(uri);
        logger.success('Connected to MongoDB successfully');
        return mongoose.connection;
    } catch (error) {
        logger.error('MongoDB connection error:', error);
        return null;
    }
}

module.exports = { connectDB, Media };
