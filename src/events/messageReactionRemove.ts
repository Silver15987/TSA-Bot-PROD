import { Events, MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import { database } from '../database/client';
import logger from '../core/logger';

export default {
  name: Events.MessageReactionRemove,
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

      // Try to remove the role
      try {
        const guild = reaction.message.guild;
        if (!guild) return;

        const member = await guild.members.fetch(user.id);
        const role = await guild.roles.fetch(reactionRole.roleId);

        if (!role) {
          logger.warn(`Role ${reactionRole.roleId} not found for reaction role on message ${messageId}`);
          return;
        }

        // Check if member has the role
        if (!member.roles.cache.has(role.id)) {
          logger.debug(`User ${user.id} doesn't have role ${role.id}`);
          return;
        }

        await member.roles.remove(role);
        logger.info(`Removed role ${role.name} from user ${user.id} via reaction role in guild ${guildId}`);

        // Try to DM the user (optional)
        try {
          await user.send(`❌ The **${role.name}** role has been removed from you in **${guild.name}**.`);
        } catch (error) {
          // Ignore DM errors (user might have DMs disabled)
          logger.debug(`Could not DM user ${user.id} about role removal:`, error);
        }
      } catch (error) {
        logger.error(`Failed to remove role for reaction role on message ${messageId}:`, error);
      }
    } catch (error) {
      logger.error('Error in messageReactionRemove event:', error);
    }
  },
};
