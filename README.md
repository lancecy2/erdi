# Discord Verification Bot

JavaScript Discord bot that:

- Posts a verification button.
- Uses Discord OAuth2 authorization with `identify` and `guilds.join`.
- Gives verified users the Members role so they can see the server.
- Stores authorized users locally.
- Lets admins run `/join-authorized user_id:<id>` to add someone who already authorized the bot.
- Posts an order ticket panel.
- Opens private order tickets that ask for the item through a dropdown and then ask for an Order ID.
- Lets staff use `/done` in a ticket to post professional completed-order embeds in the ticket and orders channel.
- Adds a staff-only close ticket button after delivery.

## Discord Setup

1. Go to the Discord Developer Portal and create an application.
2. Open **Bot**, create the bot, and copy the bot token.
3. Turn on **Server Members Intent** and **Message Content Intent** for the bot.
4. Open **OAuth2 > General** and copy the client ID and client secret.
5. Add this redirect URL:

   ```text
   http://localhost:3000/oauth/callback
   ```

   If you use ngrok or another public tunnel, add that callback too:

   ```text
   https://your-ngrok-url.ngrok-free.app/oauth/callback
   ```

6. Invite the bot with these permissions:

   - Manage Roles
   - Manage Channels
   - Create Public Threads is not needed
   - Send Messages
   - Use Slash Commands

   OAuth2 scopes for the invite: `bot` and `applications.commands`.

7. Create a role called `Members`.
8. Put the bot role above the `Members` role in your server role settings.
9. Set your channel permissions:
   - For channels new users should not see, deny `View Channel` for `@everyone`.
   - Allow `View Channel` for `Members`.
   - Leave your verification channel visible to `@everyone`.

## Local Setup

Copy `.env.example` to `.env` and fill in the values:

```text
BOT_TOKEN=...
CLIENT_ID=...
CLIENT_SECRET=...
GUILD_ID=...
BASE_URL=http://localhost:3000
PORT=3000
MEMBER_ROLE_ID=...
ORDERS_CHANNEL_ID=...
STAFF_ROLE_ID=...
TICKET_CATEGORY_ID=...
OWNER_IDS=...
```

For real users outside your computer, use a public URL for `BASE_URL`, such as ngrok, and add its `/oauth/callback` URL in the Developer Portal.

`ORDERS_CHANNEL_ID` is required for `/done`.
`STAFF_ROLE_ID` is optional, but recommended so staff can see new tickets and use `/done`.
`TICKET_CATEGORY_ID` is optional; set it if you want ticket channels created under a specific category.

## Commands

Register slash commands:

```powershell
npm run register
```

Start the bot:

```powershell
npm start
```

In Discord:

- `!verify` posts the verify button in the current channel.
- `/setup-verify` posts the verify button in the current channel.
- `/setup-ticket` posts the ticket button in the current channel. Users select their item from a dropdown before entering their Order ID.
- `/setup-legit` posts the legit check reaction message in the current channel.
- `/done item_name:<item> quantity:<amount>` posts a completed-order embed in your orders channel. For Donut Money, quantity is millions: `100` becomes `100M`, `1000` becomes `1B`.
- `/authorized-list` shows who has authorized.
- `/join-authorized user_id:<id>` adds an authorized user to the server.

Only users with **Manage Server** permission, or users listed in `OWNER_IDS`, can post the verification panel or run admin commands.
Only users with `STAFF_ROLE_ID`, **Manage Channels** permission, or `OWNER_IDS` can use `/done`.

Available `/done` items:

- Skeleton Spawner
- Donut Money - quantity is in millions (M)
- Piglin Head
- Dragon Head
- Elytra

## Moving Authorized Users To Another Server

This bot can only add people who already authorized it through the verification button. To bring those authorized users into another server:

1. Invite the same bot application to the other server.
2. Make sure the bot has permission to add members and manage the role you want to give.
3. Change `GUILD_ID` in `.env` to the new server ID.
4. Change `MEMBER_ROLE_ID` to the Members role ID from the new server.
5. Restart the bot.
6. Use `/join-authorized user_id:<id>` for each user from `/authorized-list`.

Do this slowly. Discord can rate-limit member joins, and users can revoke authorization at any time.

## Important Notes

Discord requires real user consent for `guilds.join`. This bot only adds users who clicked the OAuth verify button and authorized the app.

The bot stores access and refresh tokens in `data/authorized-users.json`. Keep that file private.
## Verified order tickets

When a buyer clicks the ticket panel button, the bot asks for their Order ID first. It checks the `orders` collection in MongoDB and only creates the private ticket if the order exists with status `paid` or `confirmed`. If the Order ID is missing or not completed, the bot replies that the order does not exist.

Setup:

1. Keep `MONGODB_URI` set in `.env`, or set `STORE_API_BASE_URL` and `STAFF_TOKEN` to use the website API.
2. Run `npm run register` after changing slash commands.
3. Restart the bot with `npm start`.

If your PC/network blocks MongoDB SRV DNS lookups, set `STORE_API_BASE_URL` to your deployed store URL and set any non-empty `STAFF_TOKEN` value. The bot will try MongoDB first, then fall back to the website API.
