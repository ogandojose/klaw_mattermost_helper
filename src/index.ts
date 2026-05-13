import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { MattermostClient } from "./client.js";
import { validateConfig, type ResolvedChannel } from "./config.js";
import {
  makeSearchMessagesTool,
  makeGetThreadContextTool,
  makeListChannelsTool,
  makeGetChannelHistoryTool,
} from "./tools.js";

async function resolveChannels(
  client: MattermostClient,
  allowedChannelNames: string[]
): Promise<ResolvedChannel[]> {
  const resolved: ResolvedChannel[] = [];
  for (const nameOrId of allowedChannelNames) {
    try {
      const ch = await client.getChannel(nameOrId);
      resolved.push({ id: ch.id, name: ch.name, displayName: ch.display_name });
    } catch {
      try {
        const ch = await client.resolveChannelName(nameOrId);
        resolved.push({ id: ch.id, name: ch.name, displayName: ch.display_name });
      } catch (err) {
        console.warn(`[mattermost-search] Could not resolve channel "${nameOrId}" — skipping: ${err}`);
      }
    }
  }
  if (resolved.length === 0) {
    throw new Error(
      "[mattermost-search] No channels could be resolved from config.allowedChannels. " +
        "Check that channel names/IDs are correct and the bot has access to them."
    );
  }
  console.log(
    `[mattermost-search] Resolved ${resolved.length} channel(s): ` +
      resolved.map((c) => `#${c.displayName}`).join(", ")
  );
  return resolved;
}

export default definePluginEntry({
  id: "mattermost-search",
  name: "Mattermost Search",
  description: "Search and explore Mattermost channels and conversations",

  register(api) {
    // Skip side-effect work during capability-discovery passes.
    if (api.registrationMode !== "full") return;

    // api.config contains the value from plugins.entries.mattermost-search.config
    const rawConfig = (api as unknown as Record<string, unknown>)["config"];
    let config;
    try {
      config = validateConfig(rawConfig);
    } catch (err) {
      console.warn(`[mattermost-search] Plugin not configured: ${err}. Set plugins.entries.mattermost-search.config in openclaw.json and restart the gateway.`);
      return;
    }

    const client = new MattermostClient(config.baseUrl, config.botToken, config.teamId);

    // Kick off channel resolution in the background.
    // Each tool awaits this promise before executing, so resolution happens
    // on the first tool call rather than blocking plugin registration.
    const channelsPromise = resolveChannels(client, config.allowedChannels);

    const ctx = { client, channelsPromise };

    api.registerTool(makeSearchMessagesTool(ctx));
    api.registerTool(makeGetThreadContextTool(ctx));
    api.registerTool(makeListChannelsTool(ctx));
    api.registerTool(makeGetChannelHistoryTool(ctx));
  },
});

