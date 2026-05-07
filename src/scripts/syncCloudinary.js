require('dotenv').config();
const { initCloudinary, APP_CONFIG } = require('../config/cloudinary');
const { connectDB, Media } = require('../config/db');
const logger = require('../utils/logger');

const cloudinary = initCloudinary();

/**
 * Syncs existing Cloudinary resources to MongoDB
 */
async function sync() {
    try {
        logger.section('🔄 SYNCING CLOUDINARY WITH MONGODB');
        
        await connectDB();
        
        const resourceTypes = ['image', 'video'];
        
        for (const resourceType of resourceTypes) {
            logger.info(`Fetching ${resourceType}s from Cloudinary...`);
            
            let nextCursor = null;
            let totalSynced = 0;

            do {
                const result = await cloudinary.api.resources({
                    resource_type: resourceType,
                    max_results: 500,
                    next_cursor: nextCursor,
                    context: true,
                    tags: true
                });

                for (const resource of result.resources) {
                    // Use public_id as unique identifier to avoid collisions
                    const uniqueId = resource.public_id;
                    const pixabayId = resource.context?.custom?.pixabay_id || uniqueId.split('/').pop();
                    
                    const type = resourceType === 'image' ? 'images' : 'videos';

                    // Check if already in DB by either Cloudinary Public ID OR Pixabay ID
                    const exists = await Media.findOne({ 
                        $or: [
                            { cloudinaryPublicId: uniqueId },
                            { pixabayId: pixabayId }
                        ]
                    });
                    
                    if (!exists) {
                        try {
                            await Media.create({
                                pixabayId: pixabayId,
                                type,
                                title: resource.context?.custom?.caption || resource.context?.custom?.tags || uniqueId.split('/').pop(),
                                tags: resource.tags || [],
                                pixabayUrl: resource.context?.custom?.pixabay_url || '',
                                cloudinaryUrl: resource.secure_url,
                                cloudinaryPublicId: uniqueId,
                                cloudinaryFormat: resource.format,
                                cloudinaryWidth: resource.width,
                                cloudinaryHeight: resource.height,
                                uploadedAt: new Date(resource.created_at)
                            });
                            totalSynced++;
                            logger.info(`+ Synced: ${uniqueId}`);
                        } catch (err) {
                            if (err.code === 11000) {
                                logger.skip(`Duplicate ID ${pixabayId} found. Skipping.`);
                            } else {
                                throw err;
                            }
                        }
                    } else {
                        // Optionally update URL if it changed
                        exists.cloudinaryUrl = resource.secure_url;
                        await exists.save();
                    }
                }

                nextCursor = result.next_cursor;
            } while (nextCursor);

            logger.success(`Finished syncing ${resourceType}s. Total: ${totalSynced}`);
        }

        logger.success('✅ Sync completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ DETAILED SYNC ERROR:', error);
        if (error.error) console.error('Cloudinary Error Detail:', error.error);
        process.exit(1);
    }
}

sync();
