import { Events, MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import { database } from '../database/client';
import logger from '../core/logger';

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

      // Check if this is a reaction role
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
