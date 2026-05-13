export interface Config {
  botToken: string;
  baseUrl: string;
  teamId: string;
  allowedChannels: string[];
}

export interface ResolvedChannel {
  id: string;
  name: string;
  displayName: string;
}

/**
 * Validates and coerces the raw plugin config supplied under
 * plugins.entries.mattermost-search.config in the OpenClaw config file.
 */
export function validateConfig(raw: unknown): Config {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      "[mattermost-search] Plugin config must be an object under " +
        "plugins.entries.mattermost-search.config"
    );
  }
  const c = raw as Record<string, unknown>;

  if (typeof c["botToken"] !== "string" || !c["botToken"])
    throw new Error("[mattermost-search] config.botToken is required");

  if (typeof c["baseUrl"] !== "string" || !c["baseUrl"])
    throw new Error("[mattermost-search] config.baseUrl is required");

  if (typeof c["teamId"] !== "string" || !c["teamId"])
    throw new Error("[mattermost-search] config.teamId is required");

  if (!Array.isArray(c["allowedChannels"]) || c["allowedChannels"].length === 0)
    throw new Error(
      "[mattermost-search] config.allowedChannels must be a non-empty array of channel names or IDs"
    );

  return {
    botToken: c["botToken"] as string,
    // Strip trailing slash so path joins are always clean
    baseUrl: (c["baseUrl"] as string).replace(/\/+$/, ""),
    teamId: c["teamId"] as string,
    allowedChannels: c["allowedChannels"] as string[],
  };
}
