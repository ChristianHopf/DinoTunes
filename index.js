require("dotenv").config();
const { LavalinkManager } = require("lavalink-client");
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // If using text commands
  ],
});

// client.lavalink = new LavalinkManager({
//   nodes: [
//     {
//       authorization: "password",
//       host: "localhost",
//       port: 2333,
//       id: "testnode",
//       requestSignalTimeoutMS: 3000,
//       closeOnError: true,
//       heartBeatInterval: 30_000,
//       enablePingOnStatsCheck: true,
//       retryDelay: 10e3,
//       secure: false,
//       retryAmount: 5,
//     },
//   ],
//   sendToShard: (guildId, payload) =>
//     client.guilds.cache.get(guildId)?.shard?.send(payload),
//   autoSkip: true,
//   client: {
//     id: process.env.CLIENT_ID,
//     username: "DinoTunes",
//   },
//   autoSkipOnResolveError: true,
//   emitNewSongsOnly: true,
//   playerOptions: {
//     maxErrorsPerTime: { threshold: 10_000, maxAmount: 3 },
//   },
// });
client.lavalink = new LavalinkManager({
  nodes: [
      {
          authorization: "password",
          host: "localhost",
          port: 2333,
          id: "testnode",
          // get the previously used session, to restart with "resuming" enabled
          sessionId: previouslyUsedSessions.get("testnode"),
          requestSignalTimeoutMS: 3000,
          closeOnError: true,
          heartBeatInterval: 30_000,
          enablePingOnStatsCheck: true,
          retryDelay: 10e3,
          secure: false,
          retryAmount: 5,
      }
  ],
  sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
  autoSkip: true,
  client: { // client: client.user
      id: envConfig.clientId, // REQUIRED! (at least after the .init)
      username: "TESTBOT",
  },
  autoSkipOnResolveError: true, // skip song, if resolving an unresolved song fails
  emitNewSongsOnly: true, // don't emit "looping songs"
  playerOptions: {
      // These are the default prevention methods
      maxErrorsPerTime: {
          threshold: 10_000,
          maxAmount: 3,
      },
      // only allow an autoplay function to execute, if the previous function was longer ago than this number.
      minAutoPlayMs: 10_000,

      applyVolumeAsFilter: false,
      clientBasedPositionUpdateInterval: 50, // in ms to up-calc player.position
      defaultSearchPlatform: "ytmsearch",
      volumeDecrementer: 0.75, // on client 100% == on lavalink 75%
      requesterTransformer: requesterTransformer,
      onDisconnect: {
          autoReconnect: true, // automatically attempts a reconnect, if the bot disconnects from the voice channel, if it fails, it get's destroyed
          destroyPlayer: false // overrides autoReconnect and directly destroys the player if the bot disconnects from the vc
      },
      onEmptyQueue: {
          // will auto destroy the player after 30s if the queue got empty and autoplay function does not add smt to the queue
          destroyAfterMs: 30_000, // 1 === instantly destroy | don't provide the option, to don't destroy the player
          autoPlayFunction: autoPlayFunction,
      },
      useUnresolvedData: true,
  },
  queueOptions: {
      maxPreviousTracks: 10,
      // only needed if you want and need external storage, don't provide if you don't need to
      queueStore: new myCustomStore(client.redis), // client.redis = new redis()
      // only needed, if you want to watch changes in the queue via a custom class,
      queueChangesWatcher: new myCustomWatcher(client)
  },
  linksAllowed: true,
  // example: don't allow p*rn / youtube links., you can also use a regex pattern if you want.
  // linksBlacklist: ["porn", "youtube.com", "youtu.be"],
  linksBlacklist: [],
  linksWhitelist: [],
  advancedOptions: {
      enableDebugEvents: true,
      maxFilterFixDuration: 600_000, // only allow instafixfilterupdate for tracks sub 10mins
      debugOptions: {
          noAudio: false,
          playerDestroy: {
              dontThrowError: false,
              debugLog: false,
          },
          logCustomSearches: false,
      }
  }
});

client.on("raw", (d) => client.lavalink.sendRawData(d));

// Register slash commands
client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  const commands = [
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Play a song from YouTube or SoundCloud")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("Song name or URL")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stop the music and clear the queue"),
    new SlashCommandBuilder()
      .setName("join")
      .setDescription("Join a voice channel"),
  ];

  await client.application?.commands.set(commands);
});

// Handle slash commands
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === "join") {
    const member = interaction.guild?.members.cache.get(interaction.user.id);
    const voiceChannel = member?.voice.channel;

    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      await interaction.reply("You need to be in a voice channel!");
      return;
    }

    const player = client.lavalink.createPlayer(interaction.guildId);
    await player.connect(voiceChannel.id, { deaf: true });
    await interaction.reply(`Joined ${voiceChannel.name}`);
  }

  if (commandName === "play") {
    const query = options.getString("query");
    const member = interaction.guild?.members.cache.get(interaction.user.id);
    const voiceChannel = member?.voice.channel;

    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      await interaction.reply("You need to be in a voice channel!");
      return;
    }

    const player =
      client.lavalink.getPlayer(interaction.guildId) ||
      client.lavalink.createPlayer(interaction.guildId);
    if (!player.connected) {
      await player.connect(voiceChannel.id, { deaf: true });
    }

    const searchResult = await client.lavalink.search(
      { query, source: query.includes("soundcloud.com") ? "sc" : "yt" },
      interaction.user
    );
    if (!searchResult.tracks.length) {
      await interaction.reply("No results found!");
      return;
    }

    await player.queue.add(searchResult.tracks[0]);
    await interaction.reply(
      `Added to queue: **${searchResult.tracks[0].info.title}**`
    );

    if (!player.playing) {
      await player.play();
    }
  }

  if (commandName === "stop") {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) {
      await interaction.reply("No music is playing!");
      return;
    }

    await player.destroy();
    await interaction.reply("Stopped music and cleared queue.");
  }
});

client.login(process.env.BOT_TOKEN);
