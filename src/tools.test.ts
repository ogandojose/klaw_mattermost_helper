/**
 * Unit tests for mattermost-search tools.
 * Run with: npx tsx src/tools.test.ts
 *
 * Tests all four tool execute() functions with a mock MattermostClient.
 * No gateway or OpenClaw runtime required.
 */

import assert from "node:assert/strict";
import type { MattermostClient, MattermostPost, PostList } from "./client.js";
import type { ResolvedChannel } from "./config.js";
import {
  makeSearchMessagesTool,
  makeGetThreadContextTool,
  makeListChannelsTool,
  makeGetChannelHistoryTool,
} from "./tools.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHANNEL_RAKE: ResolvedChannel = {
  id: "jjfgo7a59pgo9gk84tp4t5z9fy",
  name: "rake",
  displayName: "Rake",
};

const CHANNEL_DEV: ResolvedChannel = {
  id: "devchannelid0000000000000",
  name: "dev",
  displayName: "Dev",
};

function makePost(overrides: Partial<MattermostPost> = {}): MattermostPost {
  return {
    id: "post1",
    channel_id: CHANNEL_RAKE.id,
    message: "Hello world",
    create_at: 1700000000000,
    user_id: "user1",
    root_id: "",
    parent_id: "",
    ...overrides,
  };
}

function makePostList(posts: MattermostPost[]): PostList {
  const order = posts.map((p) => p.id);
  const postsMap = Object.fromEntries(posts.map((p) => [p.id, p]));
  return { order, posts: postsMap };
}

// ---------------------------------------------------------------------------
// Mock client factory — override only the methods each test needs
// ---------------------------------------------------------------------------

function mockClient(overrides: Partial<MattermostClient> = {}): MattermostClient {
  const noop = () => { throw new Error("unexpected client call"); };
  return {
    searchPosts: noop,
    getPost: noop,
    getPostThread: noop,
    getPostsBefore: noop,
    getPostsAfter: noop,
    getChannelPosts: noop,
    getChannel: noop,
    resolveChannelName: noop,
    ...overrides,
  } as unknown as MattermostClient;
}

function makeCtx(client: MattermostClient, channels: ResolvedChannel[] = [CHANNEL_RAKE]) {
  return { client, channelsPromise: Promise.resolve(channels) };
}

// ---------------------------------------------------------------------------
// Test runner helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// mattermost_list_channels
// ---------------------------------------------------------------------------

console.log("\nmattermost_list_channels");

await test("returns configured channels", async () => {
  const tool = makeListChannelsTool(makeCtx(mockClient(), [CHANNEL_RAKE, CHANNEL_DEV]));
  const result = await tool.execute("id", {});
  const text = result.content[0].text;
  assert.ok(text.includes("Rake"), `expected 'Rake' in: ${text}`);
  assert.ok(text.includes("Dev"), `expected 'Dev' in: ${text}`);
  assert.ok(text.includes("Allowed Mattermost channels (2)"), `expected count in: ${text}`);
});

await test("includes channel id and name", async () => {
  const tool = makeListChannelsTool(makeCtx(mockClient()));
  const result = await tool.execute("id", {});
  const text = result.content[0].text;
  assert.ok(text.includes(CHANNEL_RAKE.id), `expected channel id in: ${text}`);
  assert.ok(text.includes("rake"), `expected channel name in: ${text}`);
});

// ---------------------------------------------------------------------------
// mattermost_search_messages
// ---------------------------------------------------------------------------

console.log("\nmattermost_search_messages");

await test("returns formatted posts on hit", async () => {
  const post = makePost({ message: "deploy went live", id: "abc123" });
  const client = mockClient({
    searchPosts: async () => makePostList([post]),
  });
  const tool = makeSearchMessagesTool(makeCtx(client));
  const result = await tool.execute("id", { query: "deploy" });
  const text = result.content[0].text;
  assert.ok(text.includes("deploy went live"), `expected message in: ${text}`);
  assert.ok(text.includes("abc123"), `expected post id in: ${text}`);
});

await test("returns no-results message on empty", async () => {
  const client = mockClient({ searchPosts: async () => makePostList([]) });
  const tool = makeSearchMessagesTool(makeCtx(client));
  const result = await tool.execute("id", { query: "xyzzy" });
  assert.ok(result.content[0].text.includes("No messages found"));
});

await test("rejects unknown channelId", async () => {
  const client = mockClient();
  const tool = makeSearchMessagesTool(makeCtx(client));
  const result = await tool.execute("id", { query: "foo", channelId: "nonexistent" });
  assert.ok(result.content[0].text.includes("not in the allowed list"));
});

await test("filters results to allowed channels", async () => {
  // Server returns a post from a channel NOT in the allowed list — should be dropped.
  const allowedPost = makePost({ id: "ok1", channel_id: CHANNEL_RAKE.id });
  const blockedPost = makePost({ id: "bad1", channel_id: "unauthorized-channel-id" });
  const client = mockClient({
    searchPosts: async () => makePostList([allowedPost, blockedPost]),
  });
  const tool = makeSearchMessagesTool(makeCtx(client));
  const result = await tool.execute("id", { query: "test" });
  const text = result.content[0].text;
  assert.ok(!text.includes("bad1"), `blocked post should not appear: ${text}`);
  assert.ok(text.includes("ok1"), `allowed post should appear: ${text}`);
});

// ---------------------------------------------------------------------------
// mattermost_get_thread_context
// ---------------------------------------------------------------------------

console.log("\nmattermost_get_thread_context");

await test("returns surrounding context in chronological order", async () => {
  const beforePost = makePost({ id: "before1", create_at: 1700000000000 });
  const focalPost  = makePost({ id: "focal1",  create_at: 1700000001000 });
  const afterPost  = makePost({ id: "after1",  create_at: 1700000002000 });

  const client = mockClient({
    getPost: async () => focalPost,
    getPostsBefore: async () => makePostList([beforePost]),
    getPostsAfter: async () => makePostList([afterPost]),
  });

  const tool = makeGetThreadContextTool(makeCtx(client));
  const result = await tool.execute("id", {
    postId: "focal1",
    channelId: CHANNEL_RAKE.id,
  });

  const text = result.content[0].text;
  assert.ok(text.includes("before1"), `expected before post: ${text}`);
  assert.ok(text.includes("focal1"),  `expected focal post: ${text}`);
  assert.ok(text.includes("after1"),  `expected after post: ${text}`);
  assert.ok(text.includes("◀ [focal]"), `expected focal marker: ${text}`);
});

await test("threadMode returns full thread sorted by create_at", async () => {
  const posts = {
    p3: makePost({ id: "p3", create_at: 1700000003000, message: "third" }),
    p1: makePost({ id: "p1", create_at: 1700000001000, message: "first"  }),
    p2: makePost({ id: "p2", create_at: 1700000002000, message: "second" }),
  };

  const client = mockClient({
    getPostThread: async () => ({ order: ["p3", "p1", "p2"], posts }),
  });

  const tool = makeGetThreadContextTool(makeCtx(client));
  const result = await tool.execute("id", {
    postId: "p1",
    channelId: CHANNEL_RAKE.id,
    threadMode: true,
  });

  const text = result.content[0].text;
  const pos1 = text.indexOf("first");
  const pos2 = text.indexOf("second");
  const pos3 = text.indexOf("third");
  assert.ok(pos1 < pos2 && pos2 < pos3, `expected chronological order in:\n${text}`);
});

await test("rejects unknown channel", async () => {
  const tool = makeGetThreadContextTool(makeCtx(mockClient()));
  const result = await tool.execute("id", {
    postId: "abc",
    channelId: "unknown-channel",
  });
  assert.ok(result.content[0].text.includes("not in the allowed list"));
});

// ---------------------------------------------------------------------------
// mattermost_get_channel_history
// ---------------------------------------------------------------------------

console.log("\nmattermost_get_channel_history");

await test("returns recent messages", async () => {
  const posts = [
    makePost({ id: "msg1", message: "latest message",  create_at: 1700000002000 }),
    makePost({ id: "msg2", message: "earlier message", create_at: 1700000001000 }),
  ];
  const client = mockClient({ getChannelPosts: async () => makePostList(posts) });
  const tool = makeGetChannelHistoryTool(makeCtx(client));
  const result = await tool.execute("id", { channelId: CHANNEL_RAKE.id });
  const text = result.content[0].text;
  assert.ok(text.includes("latest message"),  `expected latest: ${text}`);
  assert.ok(text.includes("earlier message"), `expected earlier: ${text}`);
});

await test("enforces limit max of 100", async () => {
  let capturedLimit: number | undefined;
  const client = mockClient({
    getChannelPosts: async (_id, limit) => { capturedLimit = limit; return makePostList([]); },
  });
  const tool = makeGetChannelHistoryTool(makeCtx(client));
  await tool.execute("id", { channelId: CHANNEL_RAKE.id, limit: 9999 });
  assert.equal(capturedLimit, 100, `expected limit capped at 100, got ${capturedLimit}`);
});

await test("rejects unknown channel", async () => {
  const tool = makeGetChannelHistoryTool(makeCtx(mockClient()));
  const result = await tool.execute("id", { channelId: "nope" });
  assert.ok(result.content[0].text.includes("not in the allowed list"));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
