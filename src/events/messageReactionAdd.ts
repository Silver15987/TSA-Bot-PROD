import { Events, MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import { database } from '../database/client';
import logger from '../core/logger';
import { factionManager } from '../modules/factions/services/factionManager';

export default {
  name: Events.MessageReactionAdd,
  async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
    try {
      // Ignore bot reactions
      if (user.bot) return;

      // Fetch partial data if needed
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          logger.error('Failed to fetch reaction:', error);
          return;
        }
      }

      if (user.partial) {
        try {
          await user.fetch();
        } catch (error) {
          logger.error('Failed to fetch user:', error);
          return;
        }
      }

      const messageId = reaction.message.id;
      const guildId = reaction.message.guildId;

      if (!guildId) return;

      // Get emoji string (handle both unicode and custom emojis)
      const emoji = reaction.emoji.id ? reaction.emoji.id : reaction.emoji.name;

      if (!emoji) return;

      // Check if this is a reaction role (simple or balanced)
      const reactionRole = await database.reactionRoles.findOne({
        messageId,
        emoji,
        guildId,
      });

      if (!reactionRole) return;

      // Try to assign the role
      try {
        const guild = reaction.message.guild;
        if (!guild) return;

        const member = await guild.members.fetch(user.id);

        // If this is a balanced configuration (roleIds present), use balanced logic
        if (reactionRole.roleIds && reactionRole.roleIds.length > 0) {
          await handleBalancedFactionAssignment(guildId, guild, member.id, reactionRole.roleIds);
          return;
        }

        // Fallback: simple reaction role behavior
        const role = await guild.roles.fetch(reactionRole.roleId);

        if (!role) {
          logger.warn(`Role ${reactionRole.roleId} not found for reaction role on message ${messageId}`);
          return;
        }

        // Check if member already has the role
        if (member.roles.cache.has(role.id)) {
          logger.debug(`User ${user.id} already has role ${role.id}`);
          return;
        }

        await member.roles.add(role);
        logger.info(`Assigned role ${role.name} to user ${user.id} via reaction role in guild ${guildId}`);

        // Try to DM the user (optional)
        try {
          await user.send(`✅ You have been given the **${role.name}** role in **${guild.name}**!`);
        } catch (error) {
          // Ignore DM errors (user might have DMs disabled)
          logger.debug(`Could not DM user ${user.id} about role assignment:`, error);
        }
      } catch (error) {
        logger.error(`Failed to assign role for reaction role on message ${messageId}:`, error);
      }
    } catch (error) {
      logger.error('Error in messageReactionAdd event:', error);
    }
  },
};

async function handleBalancedFactionAssignment(
  guildId: string,
  guild: any,
  userId: string,
  roleIds: string[]
): Promise<void> {
  try {
    // Check if user already has a faction in the database
    const existingFaction = await factionManager.getUserFaction(userId, guildId);
    if (existingFaction) {
      logger.debug(`User ${userId} already has a faction (${existingFaction.id}), skipping balanced assignment.`);
      return;
    }

    // Filter only roles that still exist in the guild
    const existingRoles: string[] = [];
    for (const roleId of roleIds) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (role) {
        existingRoles.push(roleId);
      }
    }

    if (existingRoles.length === 0) {
      logger.warn(`No valid roles found for balanced assignment in guild ${guildId}`);
      return;
    }

    // Count members per role using Discord role membership
    const counts: { roleId: string; count: number }[] = [];
    for (const roleId of existingRoles) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) continue;
      counts.push({
        roleId,
        count: role.members.size,
      });
    }

    if (counts.length === 0) {
      logger.warn(`No membership counts available for balanced assignment in guild ${guildId}`);
      return;
    }

    // Choose the role with the fewest members (tie-breaker: first in list)
    counts.sort((a, b) => a.count - b.count);
    const targetRoleId = counts[0].roleId;

    const member = await guild.members.fetch(userId);
    const targetRole = await guild.roles.fetch(targetRoleId);
    if (!targetRole) {
      logger.warn(`Target role ${targetRoleId} not found during balanced assignment in guild ${guildId}`);
      return;
    }

    // Assign Discord role
    if (!member.roles.cache.has(targetRoleId)) {
      await member.roles.add(targetRoleId);
    }

    // Link to faction document (by roleId)
    const faction = await database.factions.findOne({
      guildId,
      roleId: targetRoleId,
      disbanded: { $ne: true },
    });

    if (!faction) {
      logger.warn(
        `No faction found for role ${targetRoleId} during balanced assignment in guild ${guildId}`
      );
      return;
    }

    // Add to faction members and update or create user record
    await factionManager.addMember(faction.id, guildId, userId);
    await database.users.updateOne(
      { id: userId, guildId },
      {
        $set: {
          id: userId,
          guildId,
          currentFaction: faction.id,
          factionJoinDate: new Date(),
          updatedAt: new Date(),
        },
        $setOnInsert: {
          // Minimal sensible defaults for new users
          totalVcTime: 0,
          dailyVcTime: 0,
          weeklyVcTime: 0,
          monthlyVcTime: 0,
          coins: 0,
          totalCoinsEarned: 0,
          dailyCoinsEarned: 0,
          weeklyCoinsEarned: 0,
          monthlyCoinsEarned: 0,
          lastActiveDate: new Date(),
          currentStreak: 0,
          longestStreak: 0,
          factionCoinsDeposited: 0,
          factionVcTime: 0,
          lifetimeFactionVcTime: 0,
          lastDailyReset: new Date(),
          lastWeeklyReset: new Date(),
          lastMonthlyReset: new Date(),
          createdAt: new Date(),
        },
      }
    );

    logger.info(
      `Balanced assignment: user ${userId} added to faction ${faction.id} via role ${targetRoleId} in guild ${guildId}`
    );
  } catch (error) {
    logger.error('Error in balanced faction assignment:', error);
  }
}

