import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { MattermostClient } from "./client.js";
import { validateConfig, type ResolvedChannel } from "./config.js";
import {
  makeSearchMessagesTool,
  makeGetThreadContextTool,
  makeListChannelsTool,
  makeGetChannelHistoryTool,
  type ToolContext,
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
    // Guard side effects during capability-discovery passes.
    // Tools must still be registered so OpenClaw's registry snapshot
    // classifies this plugin as a tool provider, not "non-capability".
    if (api.registrationMode !== "full") return;

    // Build context lazily so tools are always registered even when the
    // plugin is not yet configured.  Each tool awaits ctxPromise at
    // execution time and surfaces a helpful error if config is missing.
    const ctxPromise: Promise<ToolContext> = (async () => {
      const config = validateConfig(api.pluginConfig);
      const client = new MattermostClient(config.baseUrl, config.botToken, config.teamId);
      const channelsPromise = resolveChannels(client, config.allowedChannels);
      return { client, channelsPromise };
    })();

    // Log config/resolution errors without blocking registration.
    ctxPromise.catch((err) => {
      console.warn(
        `[mattermost-search] Plugin not configured: ${err}. ` +
        `Set plugins.entries.mattermost-search.config in openclaw.json and restart the gateway.`
      );
    });

    api.registerTool(makeSearchMessagesTool(ctxPromise));
    api.registerTool(makeGetThreadContextTool(ctxPromise));
    api.registerTool(makeListChannelsTool(ctxPromise));
    api.registerTool(makeGetChannelHistoryTool(ctxPromise));
  },
});

