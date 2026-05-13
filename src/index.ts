import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { MattermostClient } from "./client.js";
import { validateConfig, type ResolvedChannel } from "./config.js";
import {
  makeSearchMessagesTool,
  makeGetThreadContextTool,
  makeListChannelsTool,
  makeGetChannelHistoryTool,
} from "./tools.js";

export default definePluginEntry({
  id: "mattermost-search",
  name: "Mattermost Search",
  description: "Search and explore Mattermost channels and conversations",

  async register(api) {
    // Skip side-effect work during capability-discovery passes.
    if (api.registrationMode !== "full") return;

    // api.config contains the value from plugins.entries.mattermost-search.config
    const rawConfig = (api as unknown as Record<string, unknown>)["config"];
    const config = validateConfig(rawConfig);

    const client = new MattermostClient(config.baseUrl, config.botToken, config.teamId);

    // Resolve each configured channel name or ID at startup.
    // Non-fatal for individual failures so a typo doesn't block the whole plugin.
    const allowedChannels: ResolvedChannel[] = [];
    for (const nameOrId of config.allowedChannels) {
      try {
        // Attempt to treat the value as an opaque channel ID first.
        const ch = await client.getChannel(nameOrId);
        allowedChannels.push({ id: ch.id, name: ch.name, displayName: ch.display_name });
      } catch {
        try {
          // Fall back to resolving it as a channel URL-slug name.
          const ch = await client.resolveChannelName(nameOrId);
          allowedChannels.push({ id: ch.id, name: ch.name, displayName: ch.display_name });
        } catch (err) {
          console.warn(
            `[mattermost-search] Could not resolve channel "${nameOrId}" — skipping: ${err}`
          );
        }
      }
    }

    if (allowedChannels.length === 0) {
      throw new Error(
        "[mattermost-search] No channels could be resolved from config.allowedChannels. " +
          "Check that channel names/IDs are correct and the bot has access to them."
      );
    }

    console.log(
      `[mattermost-search] Ready. Allowed channels (${allowedChannels.length}): ` +
        allowedChannels.map((c) => `#${c.displayName}`).join(", ")
    );

    const ctx = { client, allowedChannels };

    api.registerTool(makeSearchMessagesTool(ctx));
    api.registerTool(makeGetThreadContextTool(ctx));
    api.registerTool(makeListChannelsTool(ctx));
    api.registerTool(makeGetChannelHistoryTool(ctx));
  },
});
