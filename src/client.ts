export interface MattermostPost {
  id: string;
  channel_id: string;
  message: string;
  create_at: number;
  user_id: string;
  root_id: string;
  parent_id: string;
}

export interface PostList {
  order: string[];
  posts: Record<string, MattermostPost>;
}

export interface ChannelInfo {
  id: string;
  name: string;
  display_name: string;
}

export class MattermostClient {
  private readonly baseUrl: string;
  private readonly teamId: string;
  private readonly authHeaders: Record<string, string>;

  constructor(baseUrl: string, botToken: string, teamId: string) {
    // Normalise: no trailing slash, no stray /api/v4 suffix
    this.baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/api\/v4$/, "");
    this.teamId = teamId;
    this.authHeaders = {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v4${path}`;
    const res = await fetch(url, {
      method,
      headers: this.authHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "(no body)");
      throw new Error(`Mattermost ${method} ${path} → HTTP ${res.status}: ${msg}`);
    }
    return res.json() as Promise<T>;
  }

  /** Full-text post search scoped to the configured team. */
  searchPosts(terms: string): Promise<PostList> {
    return this.request<PostList>("POST", `/teams/${this.teamId}/posts/search`, {
      terms,
      is_or_search: false,
      page: 0,
      per_page: 60,
    });
  }

  /** Fetch a single post by ID. */
  getPost(postId: string): Promise<MattermostPost> {
    return this.request<MattermostPost>("GET", `/posts/${encodeURIComponent(postId)}`);
  }

  /** Fetch the full thread rooted at postId. */
  getPostThread(postId: string): Promise<PostList> {
    return this.request<PostList>("GET", `/posts/${encodeURIComponent(postId)}/thread`);
  }

  /**
   * Fetch up to `limit` posts OLDER than `postId` in the channel.
   * Returned order array is newest-first (i.e. closest to focal post first).
   */
  getPostsBefore(channelId: string, postId: string, limit: number): Promise<PostList> {
    return this.request<PostList>(
      "GET",
      `/channels/${encodeURIComponent(channelId)}/posts` +
        `?before=${encodeURIComponent(postId)}&per_page=${Math.min(limit, 200)}`
    );
  }

  /**
   * Fetch up to `limit` posts NEWER than `postId` in the channel.
   * Returned order array is newest-first (i.e. furthest from focal post first).
   */
  getPostsAfter(channelId: string, postId: string, limit: number): Promise<PostList> {
    return this.request<PostList>(
      "GET",
      `/channels/${encodeURIComponent(channelId)}/posts` +
        `?after=${encodeURIComponent(postId)}&per_page=${Math.min(limit, 200)}`
    );
  }

  /** Fetch the most recent `limit` posts from a channel (newest-first). */
  getChannelPosts(channelId: string, limit: number): Promise<PostList> {
    return this.request<PostList>(
      "GET",
      `/channels/${encodeURIComponent(channelId)}/posts?per_page=${Math.min(limit, 200)}`
    );
  }

  /** Look up a channel by its opaque ID. */
  getChannel(channelId: string): Promise<ChannelInfo> {
    return this.request<ChannelInfo>("GET", `/channels/${encodeURIComponent(channelId)}`);
  }

  /** Look up a channel by its URL-slug name within the configured team. */
  resolveChannelName(name: string): Promise<ChannelInfo> {
    return this.request<ChannelInfo>(
      "GET",
      `/teams/${this.teamId}/channels/name/${encodeURIComponent(name)}`
    );
  }
}
