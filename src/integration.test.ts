/**
 * Integration test — hits a real Mattermost instance.
 *
 * Required env vars:
 *   MM_BASE_URL      e.g. https://chat.canonical.com
 *   MM_BOT_TOKEN     personal access / bot token
 *   MM_TEAM_ID       team ID
 *   MM_CHANNEL       channel name or ID to test against
 *
 * Run with:
 *   MM_BASE_URL=https://chat.canonical.com \
 *   MM_BOT_TOKEN=xxx \
 *   MM_TEAM_ID=sqmc4sz45prypmkfctwynm5yjr \
 *   MM_CHANNEL=rake \
 *   npx tsx src/integration.test.ts
 */

import { MattermostClient } from "./client.js";
import {
  makeListChannelsTool,
  makeSearchMessagesTool,
  makeGetChannelHistoryTool,
} from "./tools.js";
import type { ResolvedChannel } from "./config.js";

const baseUrl   = process.env.MM_BASE_URL   ?? "";
const botToken  = process.env.MM_BOT_TOKEN  ?? "";
const teamId    = process.env.MM_TEAM_ID    ?? "";
const channelId = process.env.MM_CHANNEL    ?? "";

if (!baseUrl || !botToken || !teamId || !channelId) {
  console.error("Missing required env vars: MM_BASE_URL, MM_BOT_TOKEN, MM_TEAM_ID, MM_CHANNEL");
  process.exit(1);
}

const client = new MattermostClient(baseUrl, botToken, teamId);

// Resolve the channel live
console.log(`\nResolving channel "${channelId}"…`);
const ch = await client.resolveChannelName(channelId).catch(() => client.getChannel(channelId));
const channel: ResolvedChannel = { id: ch.id, name: ch.name, displayName: ch.display_name };
console.log(`  → #${channel.displayName}  id: ${channel.id}`);

const ctx = Promise.resolve({ client, channelsPromise: Promise.resolve([channel]) });

// list_channels
console.log("\n[mattermost_list_channels]");
const listResult = await makeListChannelsTool(ctx).execute("test", {});
console.log(listResult.content[0].text);

// get_channel_history (last 5 messages)
console.log("\n[mattermost_get_channel_history] last 5 messages");
const histResult = await makeGetChannelHistoryTool(ctx).execute("test", {
  channelId: channel.id,
  limit: 5,
});
console.log(histResult.content[0].text);

// search_messages
console.log("\n[mattermost_search_messages] query: \"the\"");
const searchResult = await makeSearchMessagesTool(ctx).execute("test", { query: "the", limit: 3 } as never);
console.log(searchResult.content[0].text);

console.log("\nDone.\n");
