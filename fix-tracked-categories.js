/**
 * Quick fix script to add faction category to tracked categories
 * This will update your server config to track BOTH study and faction categories
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

async function fixTrackedCategories() {
  const client = new MongoClient(process.env.COSMOS_DB_URI);

  try {
    await client.connect();
    console.log('Connected to database');

    const db = client.db(process.env.COSMOS_DB_NAME);
    const serverConfigs = db.collection('serverConfigs');

    // Get current config
    const config = await serverConfigs.findOne({});

    if (!config) {
      console.error('No server config found!');
      return;
    }

    console.log('\nCurrent config:');
    console.log('- Guild ID:', config.guildId);
    console.log('- Current tracked categories:', config.vcTracking.trackedCategoryIds || config.vcTracking.trackedCategoryId);
    console.log('- Faction category:', config.factions.factionCategoryId);
    console.log('- Version:', config.version);

    // Prepare the new tracked categories array
    const studyCategory = '719217565263593482';
    const factionCategory = config.factions.factionCategoryId || '1429838249718841394';
    const newTrackedCategories = [studyCategory, factionCategory];

    console.log('\nUpdating to track BOTH categories:');
    console.log('- Study category:', studyCategory);
    console.log('- Faction category:', factionCategory);

    // Update the config
    const result = await serverConfigs.updateOne(
      { guildId: config.guildId },
      {
        $set: {
          'vcTracking.trackedCategoryIds': newTrackedCategories,
          updatedAt: new Date(),
          updatedBy: 'fix-script',
        },
        $unset: {
          'vcTracking.trackedCategoryId': '', // Remove old field if it exists
        },
        $inc: {
          version: 1,
        },
      }
    );

    console.log('\nUpdate result:', result.modifiedCount > 0 ? '✅ SUCCESS' : '❌ FAILED');

    // Verify the update
    const updatedConfig = await serverConfigs.findOne({ guildId: config.guildId });
    console.log('\nVerification:');
    console.log('- New tracked categories:', updatedConfig.vcTracking.trackedCategoryIds);
    console.log('- New version:', updatedConfig.version);

    console.log('\n✅ Done! Now restart your bot or use the reload webhook to refresh the config.');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('Database connection closed');
  }
}

fixTrackedCategories();
