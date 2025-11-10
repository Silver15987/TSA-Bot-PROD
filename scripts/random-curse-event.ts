import 'dotenv/config';
import { EmbedBuilder, TextChannel, NewsChannel, ChannelType } from 'discord.js';
import { database } from '../src/database/client';
import { BotClient } from '../src/core/client';
import { roleStatusManager } from '../src/modules/roles/services/roleStatusManager';
import { roleActionLogger } from '../src/modules/roles/services/roleActionLogger';
import logger from '../src/core/logger';

type Args = {
  guildId: string;
  count: number;
  curseType: 'earning_rate' | 'instant_loss';
  amount: number;
  durationHours: number;
  witchName: string;
  announcementChannelId?: string;
  onlyTrackedCategories?: boolean;
  dryRun?: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--guild' && argv[i + 1]) {
      args.guildId = argv[++i];
    } else if (token === '--count' && argv[i + 1]) {
      args.count = parseInt(argv[++i], 10);
    } else if (token === '--type' && argv[i + 1]) {
      args.curseType = argv[++i] as 'earning_rate' | 'instant_loss';
    } else if (token === '--amount' && argv[i + 1]) {
      args.amount = parseInt(argv[++i], 10);
    } else if (token === '--duration' && argv[i + 1]) {
      args.durationHours = parseInt(argv[++i], 10);
    } else if (token === '--witch' && argv[i + 1]) {
      args.witchName = argv[++i];
    } else if (token === '--channel' && argv[i + 1]) {
      args.announcementChannelId = argv[++i];
    } else if (token === '--tracked-only') {
      args.onlyTrackedCategories = true;
    } else if (token === '--dry-run') {
      args.dryRun = true;
    }
  }

  // Validate required args
  if (!args.guildId) {
    console.error('❌ --guild is required');
    process.exit(1);
  }
  if (!args.count || args.count < 1) {
    console.error('❌ --count is required and must be >= 1');
    process.exit(1);
  }
  if (!args.curseType || !['earning_rate', 'instant_loss'].includes(args.curseType)) {
    console.error('❌ --type is required and must be "earning_rate" or "instant_loss"');
    process.exit(1);
  }
  if (!args.amount || args.amount < 1) {
    console.error('❌ --amount is required and must be >= 1');
    process.exit(1);
  }

  return {
    guildId: args.guildId,
    count: args.count,
    curseType: args.curseType,
    amount: args.amount,
    durationHours: args.durationHours || 12,
    witchName: args.witchName || 'Sylvia',
    announcementChannelId: args.announcementChannelId,
    onlyTrackedCategories: args.onlyTrackedCategories || false,
    dryRun: args.dryRun || false,
  };
}

/**
 * Get all users currently in voice channels
 */
async function getUsersInVoiceChannels(
  guild: any,
  onlyTrackedCategories: boolean
): Promise<Map<string, { userId: string; channelId: string; channelName: string }>> {
  const usersInVC = new Map<string, { userId: string; channelId: string; channelName: string }>();

  let voiceChannels;
  
  if (onlyTrackedCategories) {
    // Import categoryValidator dynamically to avoid circular dependencies
    const { categoryValidator } = await import('../src/modules/voiceTracking/services/categoryValidator');
    
    if (!categoryValidator.isTrackingEnabled(guild.id)) {
      console.warn('⚠️  VC tracking is disabled, but --tracked-only was specified');
      return usersInVC;
    }

    const trackedCategoryIds = categoryValidator.getTrackedCategoryIds(guild.id);
    
    // Filter voice channels by tracked categories
    voiceChannels = guild.channels.cache.filter(
      (ch: any) =>
        ch.type === ChannelType.GuildVoice &&
        ch.parentId !== null &&
        trackedCategoryIds.includes(ch.parentId)
    );
  } else {
    // Get all voice channels
    voiceChannels = guild.channels.cache.filter(
      (ch: any) => ch.type === ChannelType.GuildVoice
    );
  }

  // Iterate through all voice channels and collect members
  for (const channel of voiceChannels.values()) {
    if (channel.type !== ChannelType.GuildVoice) continue;

    for (const member of channel.members.values()) {
      // Skip bots
      if (member.user.bot) continue;

      // Only add if not already added (user might be in multiple channels, but we only need them once)
      if (!usersInVC.has(member.id)) {
        usersInVC.set(member.id, {
          userId: member.id,
          channelId: channel.id,
          channelName: channel.name,
        });
      }
    }
  }

  return usersInVC;
}

async function main() {
  const args = parseArgs(process.argv);

  console.log('🧙 Random Curse Event Script (Voice Channel Edition)');
  console.log('====================================================');
  console.log(`Guild ID: ${args.guildId}`);
  console.log(`Count: ${args.count}`);
  console.log(`Curse Type: ${args.curseType}`);
  console.log(`Amount: ${args.amount}${args.curseType === 'earning_rate' ? '%' : ' coins'}`);
  console.log(`Duration: ${args.durationHours} hours`);
  console.log(`Witch Name: ${args.witchName}`);
  console.log(`Announcement Channel: ${args.announcementChannelId || 'None'}`);
  console.log(`Only Tracked Categories: ${args.onlyTrackedCategories ? 'Yes' : 'No'}`);
  console.log(`Dry Run: ${args.dryRun ? 'Yes' : 'No'}`);
  console.log('');

  // Connect DB
  await database.connect();
  console.log('✅ Connected to database');

  // Login bot
  const client = new BotClient();
  await client.start();
  console.log('✅ Bot client started');

  try {
    // Get guild
    const guild = await client.guilds.fetch(args.guildId).catch(() => null);
    if (!guild) {
      console.error(`❌ Guild ${args.guildId} not found`);
      process.exit(1);
    }

    // Fetch all members to ensure voice state is cached
    console.log('📡 Fetching guild members...');
    await guild.members.fetch();
    console.log('✅ Guild members fetched');

    // Get users currently in voice channels
    console.log('🔍 Finding users in voice channels...');
    const usersInVC = await getUsersInVoiceChannels(guild, args.onlyTrackedCategories);
    console.log(`📊 Found ${usersInVC.size} users currently in voice channels`);

    if (usersInVC.size === 0) {
      console.error('❌ No users found in voice channels.');
      process.exit(1);
    }

    // Get user data from database for users in VC
    const userIds = Array.from(usersInVC.keys());
    const dbUsers = await database.users.find({
      id: { $in: userIds },
      guildId: args.guildId,
    }).toArray();

    console.log(`💾 Found ${dbUsers.length} users in database (out of ${userIds.length} in VC)`);

    if (dbUsers.length === 0) {
      console.error('❌ No users found in database for users in voice channels.');
      process.exit(1);
    }

    // Filter out users who don't have enough coins for instant_loss curse
    let eligibleUsers = dbUsers;
    if (args.curseType === 'instant_loss') {
      eligibleUsers = dbUsers.filter(user => user.coins >= args.amount);
      console.log(`💰 ${eligibleUsers.length} users have enough coins (>= ${args.amount.toLocaleString()})`);

      if (eligibleUsers.length === 0) {
        console.error(`❌ No users have enough coins (${args.amount.toLocaleString()}) for this curse.`);
        process.exit(1);
      }

      if (eligibleUsers.length < args.count) {
        console.warn(`⚠️  Only ${eligibleUsers.length} users have enough coins. Will curse ${eligibleUsers.length} users instead of ${args.count}.`);
      }
    }

    // Randomly select users
    const shuffled = [...eligibleUsers].sort(() => Math.random() - 0.5);
    const selectedUsers = shuffled.slice(0, Math.min(args.count, eligibleUsers.length));

    console.log(`🎲 Selected ${selectedUsers.length} users to curse`);

    if (selectedUsers.length === 0) {
      console.error('❌ No users selected for cursing.');
      process.exit(1);
    }

    if (args.dryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made');
      console.log('Selected users:');
      for (const user of selectedUsers) {
        const vcInfo = usersInVC.get(user.id);
        try {
          const discordUser = await client.users.fetch(user.id);
          console.log(
            `  - ${discordUser.username} (${user.id}) - ${user.coins.toLocaleString()} coins` +
            (vcInfo ? ` [In VC: ${vcInfo.channelName}]` : '')
          );
        } catch {
          console.log(
            `  - ${user.id} - ${user.coins.toLocaleString()} coins` +
            (vcInfo ? ` [In VC: ${vcInfo.channelName}]` : '')
          );
        }
      }
      console.log('\n✅ Dry run complete');
      return;
    }

    // System user ID for event curses
    const systemWitchId = `system_random_witch_${args.witchName.toLowerCase()}`;
    const expiresAt = new Date(Date.now() + args.durationHours * 60 * 60 * 1000);

    // Apply curses to selected users
    const cursedUsers: Array<{ userId: string; username: string; success: boolean }> = [];

    for (const user of selectedUsers) {
      try {
        // Apply instant loss immediately if curse type is instant_loss
        if (args.curseType === 'instant_loss') {
          await database.users.updateOne(
            { id: user.id, guildId: args.guildId },
            { $inc: { coins: -args.amount }, $set: { updatedAt: new Date() } }
          );
        }

        // Apply curse status
        const statusId = await roleStatusManager.applyStatus({
          guildId: args.guildId,
          userId: systemWitchId,
          targetUserId: user.id,
          roleType: 'witch',
          effectType: 'curse',
          expiresAt,
          metadata: {
            curseType: args.curseType,
            amount: args.amount,
            curseStrength: 0, // Event curse, no strength calculation
            castAt: new Date(),
            eventName: `Random Witch ${args.witchName}`,
            isEvent: true,
          },
        });

        if (statusId) {
          // Try to get username
          let username = user.id;
          try {
            const discordUser = await client.users.fetch(user.id);
            username = discordUser.username;
          } catch {
            // Use ID if fetch fails
          }

          cursedUsers.push({
            userId: user.id,
            username,
            success: true,
          });

          // Log action
          await roleActionLogger.logAction({
            userId: systemWitchId,
            guildId: args.guildId,
            roleType: 'witch',
            abilityName: 'curse',
            success: true,
            targetUserId: user.id,
            amount: args.amount,
            metadata: {
              curseType: args.curseType,
              durationHours: args.durationHours,
              eventName: `Random Witch ${args.witchName}`,
              isEvent: true,
            },
          });

          const vcInfo = usersInVC.get(user.id);
          console.log(
            `✅ Cursed ${username} (${user.id})` +
            (vcInfo ? ` [Was in VC: ${vcInfo.channelName}]` : '')
          );
        } else {
          console.error(`❌ Failed to apply curse to ${user.id}`);
          cursedUsers.push({
            userId: user.id,
            username: user.id,
            success: false,
          });
        }
      } catch (error) {
        logger.error(`Error cursing user ${user.id}:`, error);
        console.error(`❌ Error cursing user ${user.id}:`, error);
        cursedUsers.push({
          userId: user.id,
          username: user.id,
          success: false,
        });
      }
    }

    // Build announcement embed
    const curseDescription = args.curseType === 'earning_rate'
      ? `Earning rate reduced by ${args.amount}% for ${args.durationHours} hours`
      : `Lost ${args.amount.toLocaleString()} coins instantly (curse active for ${args.durationHours} hours)`;

    const announcementEmbed = new EmbedBuilder()
      .setTitle(`🧙 Random Witch ${args.witchName} Has Struck!`)
      .setDescription(
        `**${cursedUsers.filter(u => u.success).length}** user${cursedUsers.filter(u => u.success).length !== 1 ? 's have' : ' has'} been cursed!\n\n` +
        `**Effect:** ${curseDescription}\n\n` +
        `*The mysterious witch ${args.witchName} has cast her spell upon those in voice channels...*`
      )
      .setColor(0x9b59b6)
      .setTimestamp();

    // Add cursed users list (if not too many)
    if (cursedUsers.filter(u => u.success).length <= 20) {
      const cursedList = cursedUsers
        .filter(u => u.success)
        .map(u => `<@${u.userId}>`)
        .join(', ');
      announcementEmbed.addFields({
        name: 'Cursed Users',
        value: cursedList || 'None',
      });
    } else {
      announcementEmbed.addFields({
        name: 'Cursed Users',
        value: `${cursedUsers.filter(u => u.success).length} users have been cursed!`,
      });
    }

    // Send announcement to channel if specified
    if (args.announcementChannelId) {
      try {
        const channel = await client.channels.fetch(args.announcementChannelId).catch(() => null);
        if (channel && (channel instanceof TextChannel || channel instanceof NewsChannel)) {
          await channel.send({ embeds: [announcementEmbed] });
          console.log(`📢 Sent announcement to channel ${args.announcementChannelId}`);
        } else {
          console.warn(`⚠️  Channel ${args.announcementChannelId} not found or not a text channel`);
        }
      } catch (error) {
        logger.error('Error sending announcement:', error);
        console.error(`❌ Error sending announcement:`, error);
      }
    }

    // Send DM to each cursed user
    console.log('\n📨 Sending DMs to cursed users...');
    let dmSuccess = 0;
    let dmFailed = 0;

    for (const user of cursedUsers.filter(u => u.success)) {
      try {
        const discordUser = await client.users.fetch(user.userId);
        const dmEmbed = new EmbedBuilder()
          .setTitle(`🧙 You've Been Cursed!`)
          .setDescription(
            `**Random Witch ${args.witchName}** has cast a curse upon you!\n\n` +
            `**Effect:** ${curseDescription}\n\n` +
            `*Use \`/status\` to view your active debuffs.*`
          )
          .setColor(0x9b59b6)
          .setTimestamp();

        await discordUser.send({ embeds: [dmEmbed] });
        dmSuccess++;
      } catch (error) {
        // User might have DMs disabled, continue anyway
        dmFailed++;
        logger.debug(`Could not send DM to user ${user.userId}`);
      }
    }

    console.log(`✅ Sent ${dmSuccess} DMs (${dmFailed} failed)`);

    // Summary
    const successCount = cursedUsers.filter(u => u.success).length;
    const failCount = cursedUsers.filter(u => !u.success).length;

    console.log('\n📊 Summary');
    console.log('==========');
    console.log(`✅ Successfully cursed: ${successCount} users`);
    if (failCount > 0) {
      console.log(`❌ Failed to curse: ${failCount} users`);
    }
    console.log(`📨 DMs sent: ${dmSuccess} (${dmFailed} failed)`);
    console.log(`📢 Announcement: ${args.announcementChannelId ? 'Sent' : 'Not sent'}`);
    console.log('\n✅ Random curse event complete!');

  } catch (error) {
    logger.error('Fatal error in random curse event:', error);
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await database.disconnect();
    await client.stop();
    console.log('\n👋 Disconnected');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
