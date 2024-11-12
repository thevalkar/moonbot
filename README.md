# Moonbot Token Sniper Bot

![Moonbot Logo](https://www.mooners.xyz/mooners480.png)

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Contributing](#contributing)
- [Code of Conduct](#code-of-conduct)
- [License](#license)

## Introduction

Moonbot Token Sniper Bot is a sophisticated tool designed for the Solana blockchain ecosystem. It monitors transactions in real-time, detects potential token purchases, and executes automated buy operations based on predefined criteria. Additionally, it integrates with Discord and Telegram to provide real-time notifications and manage user interactions through invite codes.

## Features

- **Real-Time Transaction Monitoring:** Listens to Solana transactions via POST requests (a webhook) and processes them to identify token purchases.
- **Automated Token Sniping:** Executes buy operations for tokens that meet specific criteria such as Fairly Distributed Value (FDV) thresholds.
- **Discord Integration:** Provides a Discord bot for managing invite codes, enabling/disabling access, and sending notifications to designated channels.
- **Telegram Integration:** Sends real-time alerts to Telegram threads corresponding to different transaction sources.
- **Database Management:** Utilizes PostgreSQL to store and manage token data, signals, and user invite codes.
- **Encryption:** Encrypts sensitive information such as keypairs using AES-256-CBC encryption for enhanced security.
- **Retry Mechanism:** Implements robust retry logic for transaction submissions to handle network or API failures gracefully.

## Architecture

The project is structured into several key components:

1. **Transaction Handler (`src/index.ts`):** Listens to incoming transactions, parses them, and determines whether to execute buy operations or send notifications.
2. **Utilities (`src/lib/utils.ts`):** Contains helper functions for interacting with the Solana blockchain, fetching token data, calculating prices, and managing retries.
3. **Database Interface (`src/lib/postgres.ts`):** Manages all interactions with the PostgreSQL database, including querying and inserting data.
4. **Discord Bot (`src/discord.ts`):** Handles Discord interactions, command processing, and sending notifications to Discord channels.
5. **Configuration (`.env.template`):** Manages environment variables required for secure operations.

## Prerequisites

Before setting up Moonbot, ensure you have the following:

- **Node.js** (v14 or later)
- **npm** or **yarn**
- **PostgreSQL** database
- **Solana Wallet** with necessary permissions
- **Discord Account** for bot integration
- **Telegram Account** for bot notifications

## Installation

1. **Clone the Repository**

   ```bash
   git clone https://github.com/thevalkar/moonbot.git
   cd moonbot
   ```

2. **Install Dependencies**

   Using npm:

   ```bash
   npm install
   ```

   Using yarn:

   ```bash
   yarn install
   ```

3. **Set Up the Database**

   Ensure PostgreSQL is installed and running. Create a new database for the project.

   ```bash
   createdb moonbot_db
   ```

   Run the schema setup using the `schema.sql` file:

   ```bash
   psql -d moonbot_db -f schema.sql
   ```

   This command will execute the SQL statements in `schema.sql` to set up the necessary tables and structures in your database.

## Configuration

1. **Environment Variables**

   Create a `.env` file in the root directory based on the provided `.env.template`.

   ```bash
   cp .env.template .env
   ```

   Populate the `.env` file with your configuration:

   ```env
    KEYPAIR_ENCRYPTION_KEY=
    KEYPAIR_ENCRYPTION_IV=
    DATABASE_URL=postgres://postgres:password@localhost:5432/database
    DISCORD_BOT_TOKEN=
    TELEGRAM_BOT_TOKEN=
    HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=api_key
    JITO_PAYER_KEYPAIR=[...,...,...]
    API_PORT=443
    HTTPS_KEY_PATH=/etc/letsencrypt/archive/server.com/privkey1.pem
    HTTPS_CERT_PATH=/etc/letsencrypt/archive/server.com/fullchain1.pem
   ```
   - **KEYPAIR_ENCRYPTION_KEY:** Hex-encoded key for encrypting keypairs.
   - **KEYPAIR_ENCRYPTION_IV:** Hex-encoded initialization vector for encryption.
   - **DATABASE_URL:** PostgreSQL connection string.
   - **DISCORD_BOT_TOKEN:** Token for Discord bot integration.
   - **TELEGRAM_BOT_TOKEN:** Token for Telegram bot integration.
   - **HELIUS_RPC_URL:** RPC endpoint for Solana interactions.
   - **JITO_PAYER_KEYPAIR:** Jito payer keypair for sending bundles.
   - **API_PORT:** Port to run the API
   - **HTTPS_KEY_PATH:** Absolute path for HTTPS cert key
   - **HTTPS_CERT_PATH:** Absolute path for HTTPS cert

2. **Configure Discord Bot**

   Ensure your Discord bot has the necessary permissions and is added to your server. Update the `GUILD_ID`, `ROLE_ID`, and channel IDs in the code if necessary.

3. **Configure Telegram Bot**

   Set up a Telegram bot via BotFather and obtain the bot token. Update the `TELEGRAM_BOT_TOKEN` in your `.env` file.

## Usage

1. **Start the Server**

   Using npm:

   ```bash
   npm start
   ```

   Using yarn:

   ```bash
   yarn start
   ```

   The server will start on the specified port (default is 45000).

2. **Interacting via Discord**

   - **Enable/Disable Moonbot:** Use the `/enable` command in Discord to toggle access.
   - **Notifications:** Receive real-time notifications in designated Discord channels when potential token purchases are detected.

3. **Interacting via Telegram**

   Receive alerts and updates in corresponding Telegram threads based on transaction sources like Raydium, Pumpfun, and Moonshot.

4. **Webhook Integration**

   The Express server listens for incoming webhook transactions. Send a POST request to the server's root endpoint (`/`) with transaction data to trigger processing.

## Contributing

Contributions are welcome! Please follow these steps:

1. **Fork the Repository**

2. **Create a Feature Branch**

   ```bash
   git checkout -b feature/YourFeature
   ```

3. **Commit Your Changes**

   ```bash
   git commit -m "Add some feature"
   ```

4. **Push to the Branch**

   ```bash
   git push origin feature/YourFeature
   ```

5. **Open a Pull Request**

## Code of Conduct

Please read our [Code of Conduct](./CODE_OF_CONDUCT.md) to understand the standards we expect from our community members.

## License

This project is licensed under the [MIT License](./LICENSE).

---

**Disclaimer:** Use this bot responsibly. The developers are not liable for any losses or damages caused by the use of this bot.
