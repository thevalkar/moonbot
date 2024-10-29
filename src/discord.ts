import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  TextChannel,
  SlashCommandBuilder,
  REST,
  Routes,
  ActivityType,
} from "discord.js"
import sql from "./lib/postgres"
import { configDotenv } from "dotenv"
import { decrypt, getSolanaPrice, heliusRpcUrl } from "./lib/utils"
import { Connection, Keypair } from "@solana/web3.js"
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes"
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token"
configDotenv()

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN as string

const GUILD_ID = "1215040919313580132"
const ROLE_ID = "1262242684224147487"
const LOGS_CHANNEL_ID = "1219020566640726076"

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
})
client.login(DISCORD_BOT_TOKEN)

if (!client) process.exit(1)

client.on("ready", () => {
  console.log(`Logged in as ${client.user?.tag}!`)
})

const connection = new Connection(heliusRpcUrl)
// Handle messages
// client.on(Events.MessageCreate, async (message: Message) => {
//   console.log(message.content)

//   const guild = message.guild
//   const user = message.author // Example: Getting the message author. Adjust as needed.

//   // verify if its not a bot
//   if (user.bot || !message.member) return

//   if (!message.member.roles.cache.has(ROLE_ID)) {
//     try {
//       await message.member.roles.add(ROLE_ID)
//       // send a message to another channel
//       const channel = guild?.channels.cache.get(LOGS_CHANNEL_ID) as TextChannel

//       channel.send(`Added the role to ${user.username}`)
//     } catch (e) {
//       // Handle errors here
//       console.error(e)

//       const channel = guild?.channels.cache.get(LOGS_CHANNEL_ID) as TextChannel

//       channel.send(`Failed to add the role to ${user.username}`)
//     }
//   } else {
//     console.log(`User ${user.username} already has the role`)
//   }
// })

// const usersToGiveRole = [
// ]

// give role to users
// client.on(Events.ClientReady, async () => {
//   const guild = client.guilds.cache.get(GUILD_ID)

//   if (!guild) {
//     console.error("Guild not found")
//     return
//   }

//   const role = guild.roles.cache.get(ROLE_ID)

//   if (!role) {
//     console.error("Role not found")
//     return
//   }

//   await guild.members.fetch()
//   console.log(guild.members.cache.size)
//   for (const username of usersToGiveRole) {
//     const member = guild.members.cache.find(
//       (member) => member.user.username === username
//     )

//     if (!member) {
//       console.error(`User ${username} not found`)
//       continue
//     }

//     if (!member.roles.cache.has(ROLE_ID)) {
//       try {
//         await member.roles.add(ROLE_ID)
//         console.log(`Added the role to ${username}`)
//       } catch (e) {
//         // Handle errors here
//         console.error(e)
//         console.log(`Failed to add the role to ${username}`)
//       }
//     } else {
//       console.log(`User ${username} already has the role`)
//     }
//   }
// })

// client.on(Events.ClientReady, async () => {
//   const guild = client.guilds.cache.get(GUILD_ID)

//   if (!guild) {
//     console.error("Guild not found")
//     return
//   }

//   const OG_ROLE = "1262242684224147487"
//   const role = guild.roles.cache.get(OG_ROLE)

//   if (!role) {
//     console.error("Role not found")
//     return
//   }

//   await guild.members.fetch()
//   console.log(guild.members.cache.size)

//   const ogMembers = []

//   for (const [, { user }] of guild.members.cache) {
//     const member = guild.members.cache.find(
//       (member) => member.user.id === user.id
//     )

//     if (!member) {
//       console.error(`User ${user.id} not found`)
//       continue
//     }

//     if (member.roles.cache.has(OG_ROLE)) {
//       ogMembers.push(user.username)
//     }
//     // if (!member.roles.cache.has(ROLE_ID)) {
//     //   try {
//     //     await member.roles.add(ROLE_ID)
//     //     console.log(`Added the role to ${username}`)
//     //   } catch (e) {
//     //     // Handle errors here
//     //     console.error(e)
//     //     console.log(`Failed to add the role to ${username}`)
//     //   }
//     // } else {
//     //   console.log(`User ${username} already has the role`)
//     // }
//   }

//   console.log(ogMembers)
// })

// FAQ msg
// client.on(Events.ClientReady, async () => {
//   const guild = client.guilds.cache.get(GUILD_ID)

//   const faqChannelId = "1268638132262146151"
//   const channel = guild?.channels.cache.get(faqChannelId) as TextChannel
//   channel.send({
//     embeds: [
//       {
//         title: "FAQ",
//         description: "Please read the FAQ before asking questions",
//         fields: [
//           {
//             name: "Q: How does Moonbot work?",
//             value:
//               "A: Simply deposit some SOL into your Moonbot wallet. Once deposited, type `/enable` in the Discord server and the bot will start sniping tokens automatically. Type `/enable` again to disable. The bot's algorithm handles both buying and selling of tokens without any manual intervention.",
//           },
//           {
//             name: "Q: What is the recommended budget?",
//             value: `A: Recommended budget: 1-2 SOL per week, or 0.15-0.3 SOL per day, to start.

// The recommended budget is the amount of SOL you should deposit to your Moonbot wallet to snipe tokens. It is calculated based on the entry size and the average number of tokens the bot buys per day.

// If you deposit less than the recommended amount, the bot will have less chance of profiting.`,
//           },
//           {
//             name: "Q: What is the Moonbot wallet?",
//             value:
//               "A: The Moonbot wallet is your personal wallet. You can deposit and withdraw SOL just like any other wallet. It uses AES256 encryption for security but should be treated as a hot wallet. Withdraw your SOL once you have enough and keep only what you want to spend with the bot. The wallet is not stored in the database and is used in runtime with powerful encryption.",
//           },
//           {
//             name: "Q: How do I activate the bot?",
//             value:
//               "A: If you have a balance in your wallet, type `/enable` in the Discord server and the bot will start sniping tokens. If your wallet is empty, deposit SOL to enable the bot. Your Moonbot wallet address can be copied for deposits.",
//           },
//           // {
//           //   name: "Q: What are the fees and plans available?",
//           //   value:
//           //     "A: **Trial Plan:** No upfront payment, fixed settings, lasts for a week. The minimum entry size is 0.002 SOL to avoid excessive token account rent fees.\n**Premium Plan:** No usage fee besides membership payment, allows adjustable settings such as entry size, and includes additional features.",
//           // },
//           // {
//           //   name: "Q: How are profits and losses estimated?",
//           //   value:
//           //     "A: Moonbot's benchmarks show an average of 70% profit per week, with potential for higher gains up to 150% in good weeks. The maximum estimated loss in a bad week is around 20%. We have enough data to support these estimates, and the bot's early buying strategy ensures that even in bad weeks, some value is retained. Also, you'll never lose your whole investment, with the maximum risk estimated at 20% per week.",
//           // },
//           // {
//           //   name: "Q: What is the token account rent fee?",
//           //   value:
//           //     "A: For each token bought, a 0.002 SOL fee is incurred for the token account rent from the Solana Blockchain, not from Moonbot. This fee will be returned when the token is sold and the token account is closed. While this can decrease your wallet SOL throughout the week, you shouldn't worry as you will get it back. This fee is accounted for in our weekly profit and loss estimations.",
//           // },
//           // {
//           //   name: "Q: How does the sell strategy work?",
//           //   value:
//           //     "A: Moonbot uses an algorithm to sell tokens automatically. After the tokens are sold, the token accounts are closed, and the account rent fee is returned. This ensures you get back the SOL spent on token account rent.",
//           // },
//           {
//             name: "Q: Why does my SOL balance decrease during the week?",
//             value:
//               "A: You may notice your wallet SOL decreasing throughout the week due to the token account rent fees (0.002 SOL per token) from the Solana Blockchain. This is normal and shouldn't be a concern as these fees are returned when the bot sells the tokens and closes the token accounts. Don't worry if your balance starts going down; it's normal and lots of SOL can be redeemed back once the bot starts selling.",
//           },
//           // {
//           //   name: "Q: Can I deposit tokens into my Moonbot wallet?",
//           //   value:
//           //     "A: Yes, you can deposit tokens into your Moonbot wallet, but it is generally unnecessary. The main function of the wallet is to facilitate SOL transactions for sniping tokens.",
//           // },
//           // {
//           //   name: "Q: What are the default settings in the trial plan?",
//           //   value:
//           //     "A: In the trial plan, settings are fixed. The buy strategy is automatic with a default entry size of 0.002 SOL per token purchase. The recommended budget is 3 SOL per week, or 0.7 SOL per day. These settings are designed to provide an optimal balance between cost and performance.",
//           // },
//           {
//             name: "Q: What is the sell strategy?",
//             value:
//               "A: The sell strategy is automatic and based on benchmark data. While you can sell tokens on your own, it is recommended to follow the automatic strategy for optimal results.",
//           },
//           // {
//           //   name: "Q: What are the benefits of the premium plan?",
//           //   value:
//           //     "A: The premium plan, which will be available soon, allows you to adjust settings such as entry size and removes the per-use fee in favor of a membership payment. It also includes additional features as the product matures.",
//           // },
//           {
//             name: "Q: How should I manage my wallet security?",
//             value:
//               "A: Even though the Moonbot wallet uses AES256 encryption, treat it as a hot wallet. Only keep the SOL you intend to use with the bot in this wallet. Regularly withdraw any excess SOL to ensure your funds are secure.",
//           },
//           // {
//           //   name: "Q: How can I ensure the bot doesn't run out of balance?",
//           //   value:
//           //     "A: It's important not to let the bot run out of SOL balance. The bot could miss a highly profitable token if it runs out of funds at a critical time. Make sure you leave enough balance for the day or, even better, for the whole week as the recommended budget suggests. If your balance starts going down, it's mostly because of the Solana fees, which can be redeemed. For those with a low budget, we are working on improving the sell script to redeem SOL daily.",
//           // },
//           {
//             name: "Q: What should I do if I have more questions?",
//             value:
//               "A: Feel free to ask any questions you may have about Moonbot, its wallet, plans, profits, or any other details. We're here to help!",
//           },
//         ],
//         author: {
//           name: "Moonbot",
//           icon_url: "https://www.mooners.xyz/moonbot480.png",
//         },
//         thumbnail: {
//           url: "https://i.imgur.com/NJeRMPu.jpeg",
//           width: 64,
//           height: 64,
//         },
//       },
//     ],
//   })
// })

// const DISCORD_APPLICATION_ID = "1219008065718714429"
// ;(async () => {
//   const rest = new REST().setToken(DISCORD_BOT_TOKEN)

//   const command = new SlashCommandBuilder()
//     .setName("wallet")
//     .setDescription("Get information about your Moonbot wallet")
//   console.log(command.toJSON())

//   const command2 = new SlashCommandBuilder()
//     .setName("enable")
//     .setDescription("Enable or disable Moonbot")
//   console.log(command2.toJSON())

//   await rest.put(
//     Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, GUILD_ID),
//     { body: [command.toJSON(), command2.toJSON()] }
//   )
// })()

const MOONBOTTER_ROLE_ID = "1266172172402036848"
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  await interaction.deferReply({ ephemeral: true })

  try {
    const userId = interaction.user.id

    const allUsers = await sql`SELECT for_user from moonbot_invite_codes`
    const forUser = allUsers.find(
      (user) => user.for_user.indexOf(userId) !== -1
    )?.for_user

    if (!forUser) {
      interaction.editReply({
        content: "You need to have an invite code to use Moonbot!",
      })
      return true
    }

    switch (interaction.commandName) {
      case "enable":
        const isEnabled = (
          await sql`
          SELECT enabled from moonbot_invite_codes where for_user = ${forUser}
        `
        )[0]?.enabled

        console.log(forUser, "isEnabled", isEnabled, "will enable", !isEnabled)
        // If enabled, disabled it. If disabled, enable it
        if (isEnabled) {
          await sql`
            UPDATE moonbot_invite_codes
            SET enabled = false
            WHERE for_user = ${forUser}
          `

          // Remove role
          const guild = client.guilds.cache.get(GUILD_ID)
          const member = guild?.members.cache.get(userId)
          member?.roles.remove(MOONBOTTER_ROLE_ID)
          interaction.editReply({
            content: "Moonbot has been disabled for your account!",
          })
        } else {
          await sql`
            UPDATE moonbot_invite_codes
            SET enabled = true
            WHERE for_user = ${forUser}
          `
          // Add role
          const guild = client.guilds.cache.get(GUILD_ID)
          const member = guild?.members.cache.get(userId)
          member?.roles.add(MOONBOTTER_ROLE_ID)
          interaction.editReply({
            content: "Moonbot has been enabled for your account!",
          })
        }

        return true

      case "wallet":
        const solanaPrice = await getSolanaPrice()
        // Fetch the user's wallet information
        const userWallet = await sql`
          SELECT keypair FROM moonbot_invite_codes WHERE for_user = ${forUser} AND enabled = true
        `

        if (!userWallet.length) {
          interaction.editReply({
            content: "No active wallet found for your account!",
          })
          return true
        }

        const decryptedKeypair = await decrypt(userWallet[0].keypair)
        const kp = Keypair.fromSecretKey(bs58.decode(decryptedKeypair))
        const solBalance = (await connection.getBalance(kp.publicKey)) / 1e9

        const walletTokenAccounts =
          await connection.getParsedTokenAccountsByOwner(kp.publicKey, {
            programId: TOKEN_PROGRAM_ID,
          })

        const tokens: { mint: string; amount: number }[] = []
        walletTokenAccounts.value.forEach((tokenAccount) => {
          const { info } = tokenAccount.account.data.parsed
          const amount = info.tokenAmount.uiAmount
          if (amount > 0) {
            tokens.push({ mint: info.mint, amount })
          }
        })

        const rentValue = walletTokenAccounts.value.length * 0.002

        const tokenMintsArray = tokens.map((token) => token.mint)
        const tokenPrices = await sql<
          { token_mint: string; price: number }[]
        >`SELECT DISTINCT ON (token_mint) token_mint, price FROM token_prices WHERE token_mint IN ${sql(
          tokenMintsArray
        )} ORDER BY token_mint, timestamp DESC`

        const tokenPricesByMint: { [mint: string]: number } = {}
        tokenPrices.forEach(({ token_mint, price }) => {
          tokenPricesByMint[token_mint] = price
        })

        let tokenValue = 0
        tokens.forEach((token) => {
          const price = tokenPricesByMint[token.mint] || 0
          tokenValue += token.amount * price
        })

        const totalBalance = solBalance + rentValue + tokenValue

        const balanceInUsd = totalBalance * solanaPrice

        // Sort tokens by value and get top 5
        const topTokens = tokens
          .map((token) => ({
            ...token,
            value: token.amount * (tokenPricesByMint[token.mint] || 0),
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)

        // Respond with the wallet's value information
        interaction.editReply({
          embeds: [
            {
              color: 0x0099ff,
              title: "💼 Wallet Information",
              description: "Here are the details of your wallet:",
              fields: [
                {
                  name: "Address",
                  value: `${kp.publicKey.toBase58()}`,
                  inline: false,
                },
                {
                  name: "💰 SOL Balance",
                  value: `${solBalance.toFixed(2)} SOL`,
                  inline: true,
                },
                {
                  name: "🪙 Token Value",
                  value: `${tokenValue.toFixed(2)} SOL`,
                  inline: true,
                },
                {
                  name: "🏠 Rent Value",
                  value: `${rentValue.toFixed(2)} SOL`,
                  inline: true,
                },
                {
                  name: "🔢 Total Balance",
                  value: `**${totalBalance.toFixed(2)} SOL (${Intl.NumberFormat(
                    "en-US",
                    {
                      style: "currency",
                      currency: "USD",
                      notation: "compact",
                    }
                  ).format(balanceInUsd)})**`,
                  inline: true,
                },
                {
                  name: "🏆 Top 5 Tokens",
                  value:
                    topTokens
                      .map(
                        (token, index) =>
                          `**${index + 1}.** \`${
                            token.mint
                          }\`-  **${token.value.toFixed(
                            2
                          )} SOL** (${Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: "USD",
                            notation: "compact",
                          }).format(token.value * solanaPrice)})`
                      )
                      .join("\n") || "No tokens",
                  inline: false,
                },
              ],
            },
          ],
        })
        return true

      default:
        break
    }
  } catch (error) {
    console.error(error)
    if (interaction.replied || interaction.deferred) {
      interaction.editReply({
        content: "There was an error while executing this command!",
      })
    } else {
      interaction.editReply({
        content: "There was an error while executing this command!",
      })
    }
  }
})
// Map through all members and add moonbotter role if they have it enabled
// client.on(Events.ClientReady, async () => {
//   const guild = client.guilds.cache.get(GUILD_ID)
//   if (!guild) {
//     console.error("Guild not found")
//     return
//   }

//   const allUsers =
//     await sql`SELECT for_user from moonbot_invite_codes WHERE enabled = true`
//   console.log(allUsers.length, "enabled users")
//   for (const user of allUsers) {
//     const isEnabled = user.enabled
//     console.log(user.for_user, isEnabled)
//     const allMembers = await guild.members.fetch()
//     const member = allMembers.find(
//       (member) => user.for_user.indexOf(member.user.id) !== -1
//     )
//     if (member) {
//       member.roles.add(MOONBOTTER_ROLE_ID)
//     }
//   }
// })

// Access msg
// client.on(Events.ClientReady, async () => {
//   const guild = client.guilds.cache.get(GUILD_ID)

//   const accessChannelId = "1273034410526244984"
//   const channel = guild?.channels.cache.get(accessChannelId) as TextChannel
//   channel.send({
//     embeds: [
//       {
//         title: "Access",
//         // description: "Please read the FAQ before asking questions",
//         fields: [
//           {
//             name: "Mooners Signals",
//             value:
//               "Discord | [Telegram](https://t.me/findmooners) | [Website](https://www.mooners.xyz/app)",
//           },
//           {
//             name: "Moonbot (Sniper Bot)",
//             value:
//               "[Join the Waitlist](https://tally.so/r/3ELko4) (Private Access)",
//           },
//         ],
//         author: {
//           name: "Mooners",
//           icon_url: "https://www.mooners.xyz/mooners480.png",
//         },
//         thumbnail: {
//           url: "https://symbl-world.akamaized.net/i/webp/1c/fa12713b68f7c9c6eb58882a0e40f8.webp",
//           width: 64,
//           height: 64,
//         },
//       },
//     ],
//   })
// })

// // Links message
// client.on(Events.ClientReady, async () => {
//   const guild = client.guilds.cache.get(GUILD_ID)

//   const accessChannelId = "1262358090586521640"
//   const channel = guild?.channels.cache.get(accessChannelId) as TextChannel
//   channel.send({
//     embeds: [
//       {
//         title: "Links",
//         // description: "Please read the FAQ before asking questions",
//         fields: [
//           {
//             name: "Website",
//             value: "[mooners.xyz](https://www.mooners.xyz/)",
//           },
//           {
//             name: "Telegram",
//             value: "[t.me/findmooners](https://t.me/findmooners)",
//           },
//           {
//             name: "Twitter/X",
//             value: "[x.com/thevalkar](https://x.com/thevalkar)",
//           },
//           {
//             name: "Moonbot (Sniper Bot) Waitlist",
//             value: "[Join the Waitlist](https://tally.so/r/3ELko4)",
//           },
//         ],
//         author: {
//           name: "Mooners",
//           icon_url: "https://www.mooners.xyz/mooners480.png",
//         },
//         thumbnail: {
//           url: "https://images.emojiterra.com/google/android-12l/512px/1f517.png",
//           width: 64,
//           height: 64,
//         },
//       },
//     ],
//   })
// })

// client.on(Events.ClientReady, async () => {
//   console.log("Client ready")
//   client.user?.setActivity({
//     name: "Moonbot intern",
//     type: ActivityType.Custom,
//   })
// })
