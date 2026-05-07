const { initCloudinary } = require('../config/cloudinary');
const { Media } = require('../config/db');
const logger = require('../utils/logger');

const cloudinary = initCloudinary();

/**
 * Syncs existing Cloudinary resources to MongoDB
 */
async function syncCloudinary() {
    try {
        logger.section('🔄 AUTO-SYNCING CLOUDINARY');
        
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
                    const uniqueId = resource.public_id;
                    const pixabayId = resource.context?.custom?.pixabay_id || uniqueId.split('/').pop();
                    const type = resourceType === 'image' ? 'images' : 'videos';

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
                        } catch (err) {
                            if (err.code !== 11000) logger.error('Sync Error', err);
                        }
                    }
                }
                nextCursor = result.next_cursor;
            } while (nextCursor);
            
            logger.success(`Finished ${resourceType}s. Synced ${totalSynced} new items.`);
        }
    } catch (error) {
        logger.error('Auto-sync failed:', error.message);
    }
}

// Support direct execution too
if (require.main === module) {
    const { connectDB } = require('../config/db');
    connectDB().then(() => syncCloudinary()).then(() => process.exit(0));
}

module.exports = { syncCloudinary };
