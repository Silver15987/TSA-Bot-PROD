import { Client, TextChannel, NewsChannel, VoiceChannel, EmbedBuilder } from 'discord.js';
import { configManager } from '../../../core/configManager';
import logger from '../../../core/logger';

/**
 * Faction Announcement Service
 * Handles all faction-related announcements and messages
 */
export class FactionAnnouncementService {
  /**
   * Default welcome messages if none are configured
   */
  private readonly DEFAULT_WELCOME_MESSAGES = [
    "🎉 Welcome to the squad, {user}! {role}, rally up!",
    "⚔️ A new warrior has joined! Welcome {user}! {role}, show them the ropes!",
    "🔥 {user} just leveled up to our faction! {role}, let's go!",
    "🌟 The prophecy has been fulfilled! {user} is here! {role}, gather 'round!",
    "💎 {user} has entered the chat! {role}, make some noise!",
    "🚀 Buckle up {role}, {user} just joined the ride!",
    "👑 Bow down! {user} has graced us with their presence! {role}, assemble!",
    "⚡ {user} activated their faction membership card! {role}, it's party time!",
    "🎯 New target acquired: {user}! {role}, welcome them properly!",
    "🛡️ The shield wall grows stronger! Welcome {user}! {role}, unite!"
  ];

  /**
   * Send welcome message to faction VC when new member joins
   */
  async sendWelcomeMessage(
    client: Client,
    guildId: string,
    factionChannelId: string,
    factionRoleId: string,
    newMemberUsername: string
  ): Promise<void> {
    try {
      const channel = await client.channels.fetch(factionChannelId).catch(() => null);

      if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel || channel instanceof VoiceChannel)) {
        logger.warn(`Faction channel ${factionChannelId} not found or not a text/announcement channel`);
        return;
      }

      // Get configured welcome messages or use defaults
      const config = configManager.getConfig(guildId);
      const welcomeMessages = config.factions?.welcomeMessages?.length > 0
        ? config.factions.welcomeMessages
        : this.DEFAULT_WELCOME_MESSAGES;

      // Pick random message
      const randomMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];

      // Replace placeholders
      const message = randomMessage
        .replace(/{user}/g, newMemberUsername)
        .replace(/{role}/g, `<@&${factionRoleId}>`);

      await channel.send(message);

      logger.info(`Sent welcome message to faction channel ${factionChannelId} for ${newMemberUsername}`);
    } catch (error) {
      logger.error('Error sending faction welcome message:', error);
    }
  }

  /**
   * Send faction creation announcement
   */
  async sendFactionCreatedAnnouncement(
    client: Client,
    guildId: string,
    factionName: string,
    ownerUsername: string,
    factionRoleId: string
  ): Promise<void> {
    try {
      const channelId = this.getAnnouncementChannelId(guildId);
      if (!channelId) {
        logger.debug('No announcement channel configured for faction creation');
        return;
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel || channel instanceof VoiceChannel)) {
        logger.warn(`Announcement channel ${channelId} not found or not a text/announcement channel`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🏰 New Faction Created!')
        .setDescription(
          `**${factionName}** has been founded!\n\n` +
          `👑 **Founder:** ${ownerUsername}\n` +
          `🎭 **Role:** <@&${factionRoleId}>\n\n` +
          `A new power rises! Will you join them or challenge them?`
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      logger.info(`Sent faction creation announcement for ${factionName}`);
    } catch (error) {
      logger.error('Error sending faction creation announcement:', error);
    }
  }

  /**
   * Send faction disbanded announcement
   */
  async sendFactionDisbandedAnnouncement(
    client: Client,
    guildId: string,
    factionName: string,
    reason: 'manual' | 'upkeep_failure',
    memberCount: number
  ): Promise<void> {
    try {
      const channelId = this.getAnnouncementChannelId(guildId);
      if (!channelId) {
        logger.debug('No announcement channel configured for faction disband');
        return;
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel || channel instanceof VoiceChannel)) {
        logger.warn(`Announcement channel ${channelId} not found or not a text/announcement channel`);
        return;
      }

      const reasonText = reason === 'manual'
        ? '👋 The faction was manually disbanded by its leader.'
        : '💸 The faction ran out of funds and could not pay the daily upkeep.';

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('⚰️ Faction Disbanded')
        .setDescription(
          `**${factionName}** has fallen...\n\n` +
          `${reasonText}\n\n` +
          `👥 **Final Member Count:** ${memberCount}\n\n` +
          `The faction's legacy will be remembered in the archives.`
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      logger.info(`Sent faction disbanded announcement for ${factionName} (reason: ${reason})`);
    } catch (error) {
      logger.error('Error sending faction disbanded announcement:', error);
    }
  }

  /**
   * Send low treasury warning to faction VC
   */
  async sendLowTreasuryWarning(
    client: Client,
    factionChannelId: string,
    factionRoleId: string,
    currentTreasury: number,
    upkeepCost: number,
    daysRemaining: number
  ): Promise<void> {
    try {
      const channel = await client.channels.fetch(factionChannelId).catch(() => null);

      if (!channel || !(channel instanceof TextChannel || channel instanceof VoiceChannel)) {
        logger.warn(`Faction channel ${factionChannelId} not found for low treasury warning`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('⚠️ Low Treasury Warning!')
        .setDescription(
          `<@&${factionRoleId}> **ATTENTION!**\n\n` +
          `Your faction treasury is running low!\n\n` +
          `💰 **Current Treasury:** ${currentTreasury.toLocaleString()} coins\n` +
          `💸 **Daily Upkeep:** ${upkeepCost.toLocaleString()} coins\n` +
          `📅 **Days Remaining:** ~${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}\n\n` +
          `⚠️ **If the treasury cannot cover the upkeep cost, the faction will be automatically disbanded!**\n\n` +
          `Use \`/faction deposit\` to add coins to the treasury.`
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      logger.info(`Sent low treasury warning to faction channel ${factionChannelId}`);
    } catch (error) {
      logger.error('Error sending low treasury warning:', error);
    }
  }

  /**
   * Send insufficient funds message before auto-disband
   */
  async sendInsufficientFundsMessage(
    client: Client,
    factionChannelId: string,
    factionRoleId: string,
    currentTreasury: number,
    upkeepCost: number
  ): Promise<void> {
    try {
      const channel = await client.channels.fetch(factionChannelId).catch(() => null);

      if (!channel || !(channel instanceof TextChannel || channel instanceof VoiceChannel)) {
        logger.warn(`Faction channel ${factionChannelId} not found for insufficient funds message`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('💀 FACTION DISBANDED - Insufficient Funds')
        .setDescription(
          `<@&${factionRoleId}>\n\n` +
          `Your faction has been **automatically disbanded** due to insufficient funds.\n\n` +
          `💰 **Treasury Balance:** ${currentTreasury.toLocaleString()} coins\n` +
          `💸 **Required Upkeep:** ${upkeepCost.toLocaleString()} coins\n` +
          `❌ **Shortfall:** ${(upkeepCost - currentTreasury).toLocaleString()} coins\n\n` +
          `The faction could not pay the daily upkeep cost and has been dissolved.\n\n` +
          `All members have been removed. You may create a new faction or join another.`
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });

      logger.info(`Sent insufficient funds message to faction channel ${factionChannelId}`);
    } catch (error) {
      logger.error('Error sending insufficient funds message:', error);
    }
  }

  /**
   * Get announcement channel ID from config
   */
  private getAnnouncementChannelId(guildId: string): string | null {
    try {
      const config = configManager.getConfig(guildId);
      return config.factions?.announcementChannelId || null;
    } catch (error) {
      logger.error('Error getting announcement channel ID:', error);
      return null;
    }
  }
}

export const factionAnnouncementService = new FactionAnnouncementService();
