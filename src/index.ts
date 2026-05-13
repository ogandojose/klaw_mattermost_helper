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
    // In full mode: initialise client and start resolving channels.
    // In discovery mode: reject immediately so tools are registered (required
    // for capability-snapshot / non-capability classification) but never
    // actually executed, and no network side effects are triggered.
    const ctxPromise: Promise<ToolContext> = api.registrationMode === "full"
      ? (async () => {
          const config = validateConfig(api.pluginConfig);
          const client = new MattermostClient(config.baseUrl, config.botToken, config.teamId);
          const channelsPromise = resolveChannels(client, config.allowedChannels);
          return { client, channelsPromise };
        })()
      : Promise.reject(new Error("discovery-only load — not executed"));

    // Suppress unhandled-rejection noise; log config errors in full mode.
    ctxPromise.catch((err) => {
      if (api.registrationMode === "full") {
        console.warn(
          `[mattermost-search] Plugin not configured: ${err}. ` +
          `Set plugins.entries.mattermost-search.config in openclaw.json and restart the gateway.`
        );
      }
    });

    // Always register tools so OpenClaw's registry snapshot classifies
    // this plugin as a tool provider (plain-capability, not non-capability).
    api.registerTool(makeSearchMessagesTool(ctxPromise));
    api.registerTool(makeGetThreadContextTool(ctxPromise));
    api.registerTool(makeListChannelsTool(ctxPromise));
    api.registerTool(makeGetChannelHistoryTool(ctxPromise));
  },
});

