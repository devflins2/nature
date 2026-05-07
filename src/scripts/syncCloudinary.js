const { initCloudinary } = require('../config/cloudinary');
const { Media } = require('../config/db');
const logger = require('../utils/logger');

const cloudinary = initCloudinary();

/**
 * Syncs ALL existing Cloudinary resources to MongoDB with high resilience
 */
async function syncCloudinary() {
    try {
        logger.section('🔄 STARTING BULLETPROOF SYNC');
        
        const resourceTypes = ['image', 'video'];
        
        for (const resourceType of resourceTypes) {
            logger.info(`Scanning ${resourceType}s...`);
            
            let nextCursor = null;
            let totalSynced = 0;
            let totalSkipped = 0;

            do {
                const result = await cloudinary.api.resources({
                    resource_type: resourceType,
                    max_results: 500,
                    next_cursor: nextCursor,
                    context: true,
                    tags: true
                });

                for (const resource of result.resources) {
                    try {
                        const uniqueId = resource.public_id;
                        
                        // Try multiple ways to get Pixabay ID
                        const pixabayId = resource.context?.custom?.pixabay_id || 
                                         resource.context?.pixabay_id || 
                                         resource.tags?.find(t => !isNaN(t)) || 
                                         uniqueId.split('/').pop();
                        
                        const type = resourceType === 'image' ? 'images' : 'videos';

                        // Check if already in DB
                        const exists = await Media.findOne({ 
                            $or: [
                                { cloudinaryPublicId: uniqueId },
                                { pixabayId: pixabayId }
                            ]
                        });
                        
                        if (!exists) {
                            await Media.create({
                                pixabayId: String(pixabayId),
                                type,
                                title: resource.context?.custom?.caption || resource.context?.caption || uniqueId.split('/').pop(),
                                tags: resource.tags || [],
                                pixabayUrl: resource.context?.custom?.pixabay_url || resource.context?.pixabay_url || '',
                                cloudinaryUrl: resource.secure_url,
                                cloudinaryPublicId: uniqueId,
                                cloudinaryFormat: resource.format,
                                cloudinaryWidth: resource.width,
                                cloudinaryHeight: resource.height,
                                uploadedAt: new Date(resource.created_at)
                            });
                            totalSynced++;
                        } else {
                            totalSkipped++;
                        }
                    } catch (err) {
                        // Skip individual file error and continue
                        logger.warn(`[Sync] Skipping ${resource.public_id} due to error: ${err.message}`);
                    }
                }
                
                nextCursor = result.next_cursor;
                logger.info(`[Sync] Progress: ${totalSynced} new, ${totalSkipped} existing...`);
            } while (nextCursor);
            
            logger.success(`[Sync] ${resourceType}s: Finished!`);
        }
        logger.success('✅ Global sync complete!');
    } catch (error) {
        logger.error('Sync process failed:', error.message);
    }
}

if (require.main === module) {
    const { connectDB } = require('../config/db');
    connectDB().then(() => syncCloudinary()).then(() => process.exit(0));
}

module.exports = { syncCloudinary };
