import { database } from '../src/database/client';
import logger from '../src/core/logger';

/**
 * One-time script to fetch user names and their faction associations
 */

const USER_IDS = [
  '1316806186225373317', '839163389786849281', '1312529130738290841', '1048269357588938862',
  '1256251156036845629', '697503594139615353', '1359836608169250917', '778868759263182869',
  '695730864532750396', '1115913149875507211', '700215194957381634', '1430390205629595816',
  '1426287604587823235', '1351860534714040320', '768111834510131220', '733373637666668544',
  '689415287002628100', '1367381226838822952', '1177291469174882365', '755700490552999949',
  '1333877895306936420', '1222821576311832577', '1433758588148518984', '1434462831427850330',
  '1365632890729271376', '1160861903296401478', '1314240909617139773', '1427139663541305404',
  '1137564967491612683', '1127517513350131733', '771008422006358088', '1434379710313529344',
  '1356578400952913942', '804353588532477953', '589504638022189162', '1432058903935582209',
  '610810240660930560', '1210905816912109649', '1236503136944783380', '1408802530091339806',
  '747735202671099955', '1396486514019401854', '312638763723522059', '1090511193631883314',
  '1321114770463527034', '904989491138265119', '1404582698047115375', '852842559586697236',
  '1414505535016931469', '1005052298885603329', '879073600932573215', '1138807912907669524',
  '758973881330696203', '1178441908863905935', '1410354127023636481', '1384139045428269218',
  '1434408928263012352', '1317084242915754057', '1378422459275149574', '1090581859521548319',
  '806940061823402045', '1112646368591355964', '766672835409608705', '1393640727396876460',
  '1302557761145671700', '1434409610244132895', '733031975706820739', '1107166321625546783',
  '1122763816267165796', '1224752821610479703', '505621136411852800', '909674811041652767',
  '1313138045784035358', '539806372645175332', '296234175953108993', '750058456534220811',
  '1392732043548557413', '1195170560125190219', '463895593580756993', '906195737682018315',
  '1107917873600544769', '1116708404690419843', '246259493111857152', '1028276750549004371',
  '1430892347453083669', '913808384376053810', '1415018194128605224', '1011577464868311080'
];

interface UserFactionInfo {
  userId: string;
  username: string;
  factionId: string | null;
  factionName: string | null;
}

async function fetchUserFactions(): Promise<void> {
  try {
    // Connect to database
    logger.info('Connecting to database...');
    await database.connect();
    logger.info('Database connected successfully');

    const results: UserFactionInfo[] = [];
    const notFound: string[] = [];

    // Fetch all users in batch
    logger.info(`Fetching information for ${USER_IDS.length} users...`);
    const users = await database.users.find({ id: { $in: USER_IDS } }).toArray();

    // Create a map of users by ID for quick lookup
    const userMap = new Map(users.map(user => [user.id, user]));

    // Get all unique faction IDs
    const factionIds = [...new Set(users
      .map(user => user.currentFaction)
      .filter(factionId => factionId !== null))] as string[];

    // Fetch all factions in batch
    const factions = await database.factions.find({ id: { $in: factionIds } }).toArray();
    const factionMap = new Map(factions.map(faction => [faction.id, faction]));

    // Process each user ID
    for (const userId of USER_IDS) {
      const user = userMap.get(userId);

      if (!user) {
        notFound.push(userId);
        continue;
      }

      const factionName = user.currentFaction
        ? factionMap.get(user.currentFaction)?.name || 'Unknown Faction'
        : null;

      results.push({
        userId: user.id,
        username: user.username,
        factionId: user.currentFaction,
        factionName,
      });
    }

    // Output results
    console.log('\n=== USER FACTION REPORT ===\n');
    
    // Group by faction
    const byFaction = new Map<string, UserFactionInfo[]>();
    const noFaction: UserFactionInfo[] = [];

    for (const result of results) {
      if (result.factionName) {
        if (!byFaction.has(result.factionName)) {
          byFaction.set(result.factionName, []);
        }
        byFaction.get(result.factionName)!.push(result);
      } else {
        noFaction.push(result);
      }
    }

    // Print by faction
    const sortedFactions = Array.from(byFaction.keys()).sort();
    for (const factionName of sortedFactions) {
      const members = byFaction.get(factionName)!;
      console.log(`\n📋 ${factionName} (${members.length} members)`);
      console.log('─'.repeat(60));
      for (const member of members) {
        console.log(`  • ${member.username} (ID: ${member.userId})`);
      }
    }

    // Print users without faction
    if (noFaction.length > 0) {
      console.log(`\n\n❌ No Faction (${noFaction.length} users)`);
      console.log('─'.repeat(60));
      for (const user of noFaction) {
        console.log(`  • ${user.username} (ID: ${user.userId})`);
      }
    }

    // Print users not found
    if (notFound.length > 0) {
      console.log(`\n\n⚠️  Not Found in Database (${notFound.length} users)`);
      console.log('─'.repeat(60));
      for (const userId of notFound) {
        console.log(`  • User ID: ${userId}`);
      }
    }

    // Summary statistics
    console.log('\n\n=== SUMMARY ===');
    console.log(`Total users queried: ${USER_IDS.length}`);
    console.log(`Users found: ${results.length}`);
    console.log(`Users not found: ${notFound.length}`);
    console.log(`Users with faction: ${results.length - noFaction.length}`);
    console.log(`Users without faction: ${noFaction.length}`);
    console.log(`Total factions: ${byFaction.size}`);
    console.log('\n');

    // Also output as JSON for easy processing
    console.log('\n=== JSON OUTPUT ===\n');
    console.log(JSON.stringify({
      found: results,
      notFound,
      summary: {
        totalQueried: USER_IDS.length,
        found: results.length,
        notFound: notFound.length,
        withFaction: results.length - noFaction.length,
        withoutFaction: noFaction.length,
        totalFactions: byFaction.size
      }
    }, null, 2));

  } catch (error) {
    logger.error('Error fetching user factions:', error);
    console.error('Error:', error);
    process.exit(1);
  } finally {
    // Disconnect from database
    await database.disconnect();
    logger.info('Database disconnected');
  }
}

// Run the script
fetchUserFactions()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });




