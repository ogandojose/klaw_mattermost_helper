import { Type, type Static } from "@sinclair/typebox";
import type { MattermostClient, MattermostPost, PostList } from "./client.js";
import type { ResolvedChannel } from "./config.js";

export interface ToolContext {
  client: MattermostClient;
  channelsPromise: Promise<ResolvedChannel[]>;
}

// ---------------------------------------------------------------------------
// Parameter schemas (TypeBox → typed by OpenClaw + inferred by TypeScript)
// ---------------------------------------------------------------------------

const SearchMessagesParams = Type.Object({
  query: Type.String({
    description:
      "Full-text search query. Supports Mattermost search syntax: " +
      'phrases in quotes, from:username, before:YYYY-MM-DD, after:YYYY-MM-DD, etc.',
  }),
  channelId: Type.Optional(
    Type.String({
      description:
        "Restrict search to this channel (ID or name). Must be in the allowed list. " +
        "Omit to search across all allowed channels.",
    })
  ),
});

const GetThreadContextParams = Type.Object({
  postId: Type.String({ description: "Mattermost post ID to centre the context window on." }),
  channelId: Type.String({
    description: "Channel ID or name that contains the post. Must be in the allowed list.",
  }),
  before: Type.Optional(
    Type.Number({ description: "Messages to fetch before the post. Default 5, max 25." })
  ),
  after: Type.Optional(
    Type.Number({ description: "Messages to fetch after the post. Default 5, max 25." })
  ),
  threadMode: Type.Optional(
    Type.Boolean({
      description:
        "When true, return the full thread rooted at postId instead of the surrounding channel messages.",
    })
  ),
});

const ListChannelsParams = Type.Object({});

const GetChannelHistoryParams = Type.Object({
  channelId: Type.String({ description: "Channel ID or name. Must be in the allowed list." }),
  limit: Type.Optional(
    Type.Number({ description: "Number of recent messages to return. Default 20, max 100." })
  ),
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findChannel(channels: ResolvedChannel[], idOrName: string): ResolvedChannel | undefined {
  return channels.find(
    (c) => c.id === idOrName || c.name === idOrName || c.displayName === idOrName
  );
}

/** Convert a PostList's order array into a chronologically-ordered MattermostPost array.
 *  The order array from Mattermost is newest-first; callers reverse as needed. */
function postListToArray(list: PostList): MattermostPost[] {
  return list.order.map((id) => list.posts[id]).filter(Boolean);
}

function formatPost(p: MattermostPost, channels: ResolvedChannel[], focalId?: string): string {
  const ch = channels.find((c) => c.id === p.channel_id);
  const date = new Date(p.create_at).toISOString();
  const focal = p.id === focalId ? " ◀ [focal]" : "";
  return `[${date}] #${ch?.displayName ?? p.channel_id} | user: ${p.user_id} | id: ${p.id}${focal}\n${p.message}`;
}

function formatPostList(
  posts: MattermostPost[],
  channels: ResolvedChannel[],
  header: string,
  focalId?: string
): string {
  if (posts.length === 0) return `${header}\n\nNo messages found.`;
  return `${header}\n\n${posts.map((p) => formatPost(p, channels, focalId)).join("\n\n---\n\n")}`;
}

/** Wraps a text string into an AgentToolResult as required by the OpenClaw SDK. */
function r(text: string) {
  return { content: [{ type: "text" as const, text }], details: null };
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

export function makeSearchMessagesTool(ctx: ToolContext) {
  return {
    name: "mattermost_search_messages" as const,
    label: "Search Mattermost Messages",
    description:
      "Search for messages across configured Mattermost channels. " +
      "Returns matching posts with timestamps, channel, user, and post IDs. " +
      "Supports Mattermost search syntax (quoted phrases, from:user, before/after dates).",
    parameters: SearchMessagesParams,
    async execute(_id: string, params: Static<typeof SearchMessagesParams>) {
      const { client, channelsPromise } = ctx;
      const allowedChannels = await channelsPromise;
      const { query, channelId } = params;

      let targetChannels: ResolvedChannel[];
      if (channelId) {
        const ch = findChannel(allowedChannels, channelId);
        if (!ch) {
          return r(`Channel "${channelId}" is not in the allowed list. Use mattermost_list_channels to see available channels.`);
        }
        targetChannels = [ch];
      } else {
        targetChannels = allowedChannels;
      }

      // Inject in:channel-name clauses so Mattermost filters server-side.
      const inClauses = targetChannels.map((c) => `in:${c.name}`).join(" ");
      const terms = `${query} ${inClauses}`;

      try {
        const result = await client.searchPosts(terms);
        // Local guard: keep only posts in the target set (defence-in-depth).
        const posts = postListToArray(result).filter((p) =>
          targetChannels.some((c) => c.id === p.channel_id)
        );

        if (posts.length === 0) {
          return r("No messages found matching your query in the configured channels.");
        }

        return r(formatPostList(posts, allowedChannels, `Search results for: "${query}" (${posts.length} found)`));
      } catch (err) {
        return r(`Search failed: ${err}`);
      }
    },
  };
}

export function makeGetThreadContextTool(ctx: ToolContext) {
  return {
    name: "mattermost_get_thread_context" as const,
    label: "Get Thread Context",
    description:
      "Fetch the surrounding messages around a specific Mattermost post (default: 5 before, 5 after), " +
      "or the full reply thread when threadMode is true. " +
      "Use this to understand the context of a message found via mattermost_search_messages.",
    parameters: GetThreadContextParams,
    async execute(_id: string, params: Static<typeof GetThreadContextParams>) {
      const { client, channelsPromise } = ctx;
      const allowedChannels = await channelsPromise;
      const { postId, channelId, threadMode } = params;
      const before = Math.min(params.before ?? 5, 25);
      const after = Math.min(params.after ?? 5, 25);

      const ch = findChannel(allowedChannels, channelId);
      if (!ch) {
        return r(`Channel "${channelId}" is not in the allowed list.`);
      }

      try {
        if (threadMode) {
          const thread = await client.getPostThread(postId);
          // Sort explicitly by create_at for a reliable chronological order.
          const posts = Object.values(thread.posts).sort((a, b) => a.create_at - b.create_at);
          return r(formatPostList(posts, allowedChannels, `Full thread for post ${postId} (${posts.length} messages)`, postId));
        }

        // Fetch focal post + surrounding context in parallel.
        const [focalPost, beforeList, afterList] = await Promise.all([
          client.getPost(postId),
          client.getPostsBefore(ch.id, postId, before),
          client.getPostsAfter(ch.id, postId, after),
        ]);

        // Mattermost returns both before/after in newest-first order:
        //   before order: [just-before-focal, ..., oldest]  → reverse → chronological up to focal
        //   after  order: [newest-after-focal, ..., just-after-focal] → reverse → chronological after focal
        const chronoBefore = postListToArray(beforeList).reverse();
        const chronoAfter = postListToArray(afterList).reverse();
        const all = [...chronoBefore, focalPost, ...chronoAfter];

        return r(formatPostList(all, allowedChannels, `Context: ${chronoBefore.length} before + focal + ${chronoAfter.length} after (${all.length} total)`, postId));
      } catch (err) {
        return r(`Failed to fetch context: ${err}`);
      }
    },
  };
}

export function makeListChannelsTool(ctx: ToolContext) {
  return {
    name: "mattermost_list_channels" as const,
    label: "List Mattermost Channels",
    description: "List all Mattermost channels this plugin is configured to access.",
    parameters: ListChannelsParams,
    async execute(_id: string, _params: Static<typeof ListChannelsParams>) {
      const allowedChannels = await ctx.channelsPromise;
      const lines = allowedChannels.map(
        (c) => `• ${c.displayName}  (name: ${c.name}, id: ${c.id})`
      );
      return r(`Allowed Mattermost channels (${allowedChannels.length}):\n${lines.join("\n")}`);
    },
  };
}

export function makeGetChannelHistoryTool(ctx: ToolContext) {
  return {
    name: "mattermost_get_channel_history" as const,
    label: "Get Channel History",
    description: "Fetch the most recent messages from a Mattermost channel, newest first.",
    parameters: GetChannelHistoryParams,
    async execute(_id: string, params: Static<typeof GetChannelHistoryParams>) {
      const { client, channelsPromise } = ctx;
      const allowedChannels = await channelsPromise;
      const { channelId } = params;
      const limit = Math.min(params.limit ?? 20, 100);

      const ch = findChannel(allowedChannels, channelId);
      if (!ch) {
        return r(`Channel "${channelId}" is not in the allowed list. Use mattermost_list_channels to see available channels.`);
      }

      try {
        const result = await client.getChannelPosts(ch.id, limit);
        const posts = postListToArray(result); // already newest-first from Mattermost
        return r(formatPostList(posts, allowedChannels, `Recent messages in #${ch.displayName} (newest first, limit ${limit})`));
      } catch (err) {
        return r(`Failed to fetch channel history: ${err}`);
      }
    },
  };
}
