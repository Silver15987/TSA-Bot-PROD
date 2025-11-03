/**
 * Migration Script: Add XP fields to existing factions
 * 
 * This script adds the following fields to all existing factions:
 * - xp: 0 (initial XP)
 * - pendingVcXp: 0 (accumulated VC time for XP conversion)
 * - membersWhoGaveXp: [] (empty array, will be populated as members join)
 * - ledger: [] (empty ledger for deposit tracking)
 * 
 * Usage:
 *   npm run migrate:faction-xp
 *   or
 *   tsx scripts/migrate-faction-xp.ts
 */

import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const COSMOS_DB_URI = process.env.COSMOS_DB_URI;
const COSMOS_DB_NAME = process.env.COSMOS_DB_NAME;

if (!COSMOS_DB_URI) {
  console.error('COSMOS_DB_URI environment variable is not set');
  process.exit(1);
}

if (!COSMOS_DB_NAME) {
  console.error('COSMOS_DB_NAME environment variable is not set');
  process.exit(1);
}

async function migrateFactionXp(): Promise<void> {
  const client = new MongoClient(COSMOS_DB_URI!); // Non-null assertion safe due to check above

  try {
    await client.connect();
    console.log('Connected to Cosmos DB');

    const db = client.db(COSMOS_DB_NAME!); // Non-null assertion safe due to check above
    const factionsCollection = db.collection('factions');

    // Find all factions that don't have the xp field
    const factionsToUpdate = await factionsCollection
      .find({
        $or: [
          { xp: { $exists: false } },
          { pendingVcXp: { $exists: false } },
          { membersWhoGaveXp: { $exists: false } },
          { ledger: { $exists: false } },
        ],
      })
      .toArray();

    console.log(`Found ${factionsToUpdate.length} factions to update`);

    if (factionsToUpdate.length === 0) {
      console.log('No factions need updating. Migration complete.');
      return;
    }

    let updated = 0;
    let errors = 0;

    for (const faction of factionsToUpdate) {
      try {
        const updateFields: any = {
          $set: {
            updatedAt: new Date(),
          },
        };

        // Add fields that don't exist
        if (!faction.xp && faction.xp !== 0) {
          updateFields.$set.xp = 0;
        }

        if (!faction.pendingVcXp && faction.pendingVcXp !== 0) {
          updateFields.$set.pendingVcXp = 0;
        }

        if (!faction.membersWhoGaveXp) {
          // Initialize with owner ID if owner exists
          updateFields.$set.membersWhoGaveXp = faction.ownerId ? [faction.ownerId] : [];
        }

        if (!faction.ledger) {
          updateFields.$set.ledger = [];
        }

        const result = await factionsCollection.updateOne(
          { _id: faction._id },
          updateFields
        );

        if (result.modifiedCount > 0) {
          updated++;
          console.log(`✓ Updated faction ${faction.id} (${faction.name})`);
        } else {
          console.log(`- No changes needed for faction ${faction.id}`);
        }
      } catch (error) {
        errors++;
        console.error(`✗ Error updating faction ${faction.id}:`, error);
      }
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Total factions found: ${factionsToUpdate.length}`);
    console.log(`Successfully updated: ${updated}`);
    console.log(`Errors: ${errors}`);
    console.log('\nMigration complete!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('Disconnected from Cosmos DB');
  }
}

// Run migration
migrateFactionXp()
  .then(() => {
    console.log('Migration script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
