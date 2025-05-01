require("dotenv").config();
const { LavalinkManager } = require("lavalink-client");
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
} = require("discord.js");
const { joinVoiceChannel } = require("@discordjs/voice");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // If using text commands
  ],
});

// create lavalink client
client.lavalink = new LavalinkManager({
  nodes: [
    {
      // Important to have at least 1 node
      authorization: "password",
      host: "localhost",
      port: 2333,
      id: "testnode",
    },
  ],
  sendToShard: (guildId, payload) =>
    client.guilds.cache.get(guildId)?.shard?.send(payload),
  client: {
    id: process.env.CLIENT_ID,
    username: "DinoTunes",
  },
  // everything down below is optional
  autoSkip: true,
  playerOptions: {
    clientBasedPositionUpdateInterval: 150,
    defaultSearchPlatform: "ytmsearch",
    volumeDecrementer: 0.75,
    //requesterTransformer: requesterTransformer,
    onDisconnect: {
      autoReconnect: true,
      destroyPlayer: false,
    },
    onEmptyQueue: {
      destroyAfterMs: 30_000,
      //autoPlayFunction: autoPlayFunction,
    },
  },
  queueOptions: {
    maxPreviousTracks: 25,
  },
});

client.on("raw", (d) => client.lavalink.sendRawData(d));

// above the lavalinkManager + client were created
client.on("raw", (d) => client.lavalink.sendRawData(d));
client.on("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await client.lavalink.init({ ...client.user });

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

// Register slash commands
// client.once("ready", async () => {
//   console.log(`Logged in as ${client.user?.tag}`);
//   const commands = [
//     new SlashCommandBuilder()
//       .setName("play")
//       .setDescription("Play a song from YouTube or SoundCloud")
//       .addStringOption((option) =>
//         option
//           .setName("query")
//           .setDescription("Song name or URL")
//           .setRequired(true)
//       ),
//     new SlashCommandBuilder()
//       .setName("stop")
//       .setDescription("Stop the music and clear the queue"),
//     new SlashCommandBuilder()
//       .setName("join")
//       .setDescription("Join a voice channel"),
//   ];

//   await client.application?.commands.set(commands);
// });

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

    // Join channel
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    // Start player
    const player = client.lavalink.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
    });

    await player.connect(voiceChannel.id, { deaf: true });
    await interaction.channel.send(`Joined ${voiceChannel.name}`);
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

    const searchResult = await player.search(
      // { query, source: query.includes("soundcloud.com") ? "sc" : "yt" },
      // { query, source: "ytsearch" },
      query,
      interaction.user
    );
    console.log(searchResult);
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
