/**
 * Reddit candidate-miner for the eval gold set.
 *
 * Pulls real player question phrasing from the Satisfactory subreddits so we can
 * fill the gold set's unfilled `reddit-skim` / `observed-miss` slots (and Layer-3
 * accuracy inputs) with vocabulary players actually use — slang, typos, vague
 * descriptions — instead of authoring queries blind from game knowledge.
 *
 * This is deliberately a *throwaway harvester*, not an app. It does ONE thing:
 * dump question-shaped post titles + permalinks to a gitignored candidate file.
 * The expensive, human-judgment half stays manual and out of this script:
 *   - Layer 2: resolve each chosen query to className(s) against the real index.
 *   - Layer 3: author the `reference` answer from authoritative game data —
 *     NEVER from Reddit comments (upvoted folklore is exactly what the
 *     anti-hallucination judge must not be trained against).
 *
 * Auth: application-only ("userless") OAuth. Register a *script*-type app at
 * https://www.reddit.com/prefs/apps, then export its credentials into
 * .env.local (gitignored via *.local), same pattern as GEMINI_API_KEY:
 *   REDDIT_CLIENT_ID=...
 *   REDDIT_CLIENT_SECRET=...
 *   REDDIT_USER_AGENT="macos:ficsit-forge-eval:0.1 (by /u/yourname)"   # optional
 * No Reddit password is needed — client_credentials gives a read-only token.
 *
 * Fallback: if app registration is broken (Reddit's create-app form 500s a lot),
 * pass --no-auth to skip OAuth entirely. Reddit now 403s the unauthenticated
 * `.json` API, so --no-auth instead scrapes old.reddit.com's HTML (which still
 * serves 200) and reads each post's stable data-* attributes. No credentials
 * needed, but: it's rate-limited (~60 req/min), HTML scraping is more brittle
 * than the API, and self-post bodies aren't available in listing HTML (titles
 * only). Prefer the authenticated path whenever you can register an app.
 *
 * Usage:
 *   pnpm mine:reddit                                  # top posts, last month
 *   pnpm mine:reddit --query "alternate recipe"       # keyword search
 *   pnpm mine:reddit --sort hot --limit 200           # 200 hottest
 *   pnpm mine:reddit --subs SatisfactoryGame --all    # don't filter to questions
 *   pnpm mine:reddit --no-auth                         # no app/credentials needed
 *   pnpm mine:reddit --out eval/reddit-candidates.json
 *
 * Output is sorted by score (community signal ≈ how common the phrasing is) and
 * is NOT committed — it's raw input for hand-labeling, not an artifact.
 */

import * as fs from "fs";
import * as path from "path";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";
const OLD_REDDIT_BASE = "https://old.reddit.com"; // --no-auth: scrape HTML

const DEFAULT_SUBS = ["SatisfactoryGame"];
const DEFAULT_USER_AGENT = "node:ficsit-forge-eval:0.1 (gold-set miner)";
// Reddit 403s non-browser UAs on the HTML endpoints, so --no-auth must look
// like a browser. The descriptive UA above is correct (and required) for OAuth.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REQUEST_DELAY_MS = 500; // be polite; OAuth limit is ~100 req/min
const NO_AUTH_DELAY_MS = 1100; // HTML scrape: ~60 req/min → space out
const REDDIT_PAGE_MAX = 100; // Reddit caps `limit` per request at 100
const SELFTEXT_MAX = 500; // truncate post bodies; titles are the main signal

const OUT_DEFAULT = path.resolve(
  import.meta.dirname,
  "../eval/reddit-candidates.json",
);

/** First-word cues for question-shaped titles (lowercased compare). */
const QUESTION_WORDS = new Set([
  "how",
  "what",
  "when",
  "where",
  "why",
  "which",
  "who",
  "whose",
  "can",
  "could",
  "should",
  "would",
  "will",
  "do",
  "does",
  "did",
  "is",
  "are",
  "am",
  "any",
  "anyone",
  "anybody",
  "help",
  "best",
]);

// ─── CLI args ────────────────────────────────────────────────────────────────

type Sort = "top" | "hot" | "new" | "rising" | "relevance";
type TimeRange = "hour" | "day" | "week" | "month" | "year" | "all";

interface Args {
  readonly subs: readonly string[];
  readonly query?: string;
  readonly sort: Sort;
  readonly time: TimeRange;
  readonly limit: number;
  readonly questionsOnly: boolean;
  readonly noAuth: boolean;
  readonly outPath: string;
}

function parseArgs(argv: readonly string[]): Args {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const query = valueOf("--query");
  return {
    subs: (valueOf("--subs") ?? DEFAULT_SUBS.join(","))
      .split(",")
      .map((s) => s.trim()),
    query,
    // Searches default to relevance; listings default to top.
    sort:
      (valueOf("--sort") as Sort | undefined) ?? (query ? "relevance" : "top"),
    time: (valueOf("--time") as TimeRange | undefined) ?? "month",
    limit: Number(valueOf("--limit") ?? "100"),
    questionsOnly: !argv.includes("--all"),
    noAuth: argv.includes("--no-auth"),
    outPath: valueOf("--out") ?? OUT_DEFAULT,
  };
}

// ─── Reddit API ──────────────────────────────────────────────────────────────

interface RedditPost {
  readonly id: string;
  readonly subreddit: string;
  readonly title: string;
  readonly selftext: string;
  readonly permalink: string;
  readonly score: number;
  readonly num_comments: number;
  readonly created_utc: number;
  readonly link_flair_text: string | null;
}

interface Listing {
  readonly data: {
    readonly after: string | null;
    readonly children: readonly { readonly data: RedditPost }[];
  };
}

const userAgent = process.env.REDDIT_USER_AGENT ?? DEFAULT_USER_AGENT;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exchange client credentials for a read-only ("userless") bearer token. */
async function getAccessToken(): Promise<string> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "Missing REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET. Register a 'script' app at " +
        "https://www.reddit.com/prefs/apps and add both to functions/.env.local.",
    );
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const detail = res.status === 401 ? " (401 — check client id/secret)" : "";
    throw new Error(
      `Token request failed: ${res.status} ${res.statusText}${detail}`,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token)
    throw new Error("Token response had no access_token.");
  return json.access_token;
}

/** Fetch one page of the authenticated JSON API (oauth.reddit.com). */
async function fetchPage(
  token: string,
  url: string,
): Promise<{ posts: RedditPost[]; after: string | null }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": userAgent },
  });
  if (!res.ok) {
    throw new Error(
      `Reddit request failed: ${res.status} ${res.statusText} (${url})`,
    );
  }
  const listing = (await res.json()) as Listing;
  return {
    posts: listing.data.children.map((c) => c.data),
    after: listing.data.after,
  };
}

/** Build the per-page oauth.reddit.com JSON URL for a sub. */
function pageUrl(
  args: Args,
  sub: string,
  pageLimit: number,
  after: string | null,
): string {
  const params = new URLSearchParams({
    limit: String(pageLimit),
    raw_json: "1",
  });
  if (after) params.set("after", after);
  if (args.query) {
    params.set("q", args.query);
    params.set("restrict_sr", "1");
    params.set("sort", args.sort);
    params.set("t", args.time);
    return `${API_BASE}/r/${sub}/search?${params}`;
  }
  if (args.sort === "top") params.set("t", args.time);
  const listing = args.sort === "relevance" ? "top" : args.sort;
  return `${API_BASE}/r/${sub}/${listing}?${params}`;
}

// ─── --no-auth: old.reddit HTML scrape ───────────────────────────────────────

/** Decode the handful of HTML entities old.reddit emits in titles/flair. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

function attr(chunk: string, name: string): string | undefined {
  return new RegExp(`data-${name}="([^"]*)"`).exec(chunk)?.[1];
}

/**
 * Parse old.reddit listing/search HTML into posts. Each result row is a
 * `<div class=" thing ... ">` whose data-* attributes carry everything we need;
 * the only child we read is the title anchor (data-event-action="title").
 */
function parseThings(html: string, fallbackSub: string): RedditPost[] {
  const posts: RedditPost[] = [];
  // Split on the thing-div boundary so each chunk is one post's markup.
  for (const chunk of html.split('<div class=" thing').slice(1)) {
    const fullname = attr(chunk, "fullname");
    // Keep only real link posts; skip ads and non-t3 rows.
    if (!fullname?.startsWith("t3_") || attr(chunk, "promoted") === "true") {
      continue;
    }
    const titleMatch = /data-event-action="title"[^>]*>([^<]+)</.exec(chunk);
    if (!titleMatch) continue;
    const flair = /class="linkflairlabel"[^>]*title="([^"]*)"/.exec(chunk)?.[1];
    posts.push({
      id: fullname.slice(3),
      subreddit: attr(chunk, "subreddit") ?? fallbackSub,
      title: decodeEntities(titleMatch[1]),
      selftext: "", // not present in listing HTML
      permalink: attr(chunk, "permalink") ?? "",
      score: Number(attr(chunk, "score") ?? "0"),
      num_comments: Number(attr(chunk, "comments-count") ?? "0"),
      created_utc: Number(attr(chunk, "timestamp") ?? "0") / 1000,
      link_flair_text: flair ? decodeEntities(flair) : null,
    });
  }
  return posts;
}

/**
 * Parse old.reddit *search* HTML. Search results use a different layout from
 * listings (`search-result` rows, fields as child elements with absolute hrefs)
 * so they need their own parser.
 */
function parseSearchResults(html: string, fallbackSub: string): RedditPost[] {
  const posts: RedditPost[] = [];
  const rows = html
    .split('<div class=" search-result search-result-link')
    .slice(1);
  for (const chunk of rows) {
    const fullname = attr(chunk, "fullname");
    if (!fullname?.startsWith("t3_")) continue;
    const title = /class="search-title[^"]*"[^>]*>([^<]+)</.exec(chunk)?.[1];
    const href = /<a href="([^"]+)" class="search-title/.exec(chunk)?.[1] ?? "";
    if (!title) continue;
    const flair = /linkflairlabel[^"]*"[^>]*title="([^"]*)"/.exec(chunk)?.[1];
    const score = /class="search-score">([\d,]+)\s*point/.exec(chunk)?.[1];
    const comments =
      /class="search-comments[^"]*"[^>]*>\s*([\d,]+)\s*comment/.exec(
        chunk,
      )?.[1];
    const datetime = /<time[^>]*datetime="([^"]+)"/.exec(chunk)?.[1];
    posts.push({
      id: fullname.slice(3),
      subreddit: fallbackSub,
      title: decodeEntities(title),
      selftext: "",
      permalink: href.replace(/^https?:\/\/[^/]+/, ""), // → relative /r/... path
      score: Number((score ?? "0").replace(/,/g, "")),
      num_comments: Number((comments ?? "0").replace(/,/g, "")),
      created_utc: datetime ? Date.parse(datetime) / 1000 : 0,
      link_flair_text: flair ? decodeEntities(flair) : null,
    });
  }
  return posts;
}

/** Build the per-page old.reddit HTML URL. Paginates via after + cumulative count. */
function htmlPageUrl(
  args: Args,
  sub: string,
  pageLimit: number,
  after: string | null,
  count: number,
): string {
  const params = new URLSearchParams({ limit: String(pageLimit) });
  if (after) {
    params.set("after", after);
    params.set("count", String(count));
  }
  if (args.query) {
    params.set("q", args.query);
    params.set("restrict_sr", "1");
    params.set("sort", args.sort);
    params.set("t", args.time);
    return `${OLD_REDDIT_BASE}/r/${sub}/search?${params}`;
  }
  if (args.sort === "top") params.set("t", args.time);
  const listing = args.sort === "relevance" ? "top" : args.sort;
  return `${OLD_REDDIT_BASE}/r/${sub}/${listing}/?${params}`;
}

/** Fetch + parse one page of old.reddit HTML. `after` is the last post's fullname. */
async function fetchHtmlPage(
  args: Args,
  sub: string,
  pageLimit: number,
  after: string | null,
  count: number,
): Promise<{ posts: RedditPost[]; after: string | null }> {
  const url = htmlPageUrl(args, sub, pageLimit, after, count);
  // Reddit's edge 403s requests missing browser-shaped Accept headers (node's
  // default fetch headers alone are blocked), so send a minimal browser set.
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(
      `old.reddit request failed: ${res.status} ${res.statusText} (${url})`,
    );
  }
  const html = await res.text();
  const posts = args.query
    ? parseSearchResults(html, sub)
    : parseThings(html, sub);
  // A full page implies more may follow; cursor is the last post's fullname.
  const last = posts.at(-1);
  const next = posts.length >= pageLimit && last ? `t3_${last.id}` : null;
  return { posts, after: next };
}

/** Page through one sub until `limit` posts are collected or results run out. */
async function fetchSub(
  token: string | null,
  args: Args,
  sub: string,
  delayMs: number,
): Promise<RedditPost[]> {
  const out: RedditPost[] = [];
  let after: string | null = null;
  while (out.length < args.limit) {
    const pageLimit = Math.min(REDDIT_PAGE_MAX, args.limit - out.length);
    const { posts, after: next } = args.noAuth
      ? await fetchHtmlPage(args, sub, pageLimit, after, out.length)
      : await fetchPage(token!, pageUrl(args, sub, pageLimit, after));
    out.push(...posts);
    if (!next || posts.length === 0) break;
    after = next;
    await delay(delayMs);
  }
  return out.slice(0, args.limit);
}

// ─── Filtering / shaping ─────────────────────────────────────────────────────

function isQuestion(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.endsWith("?")) return true;
  const firstWord =
    trimmed
      .toLowerCase()
      .split(/\s+/)[0]
      ?.replace(/[^a-z]/g, "") ?? "";
  return QUESTION_WORDS.has(firstWord);
}

interface Candidate {
  readonly id: string;
  readonly subreddit: string;
  readonly title: string;
  readonly selftext: string;
  readonly permalink: string;
  readonly score: number;
  readonly numComments: number;
  readonly createdUtc: number;
  readonly flair: string | null;
  readonly question: boolean;
}

function toCandidate(p: RedditPost): Candidate {
  const body = p.selftext.replace(/\s+/g, " ").trim();
  return {
    id: p.id,
    subreddit: p.subreddit,
    title: p.title.trim(),
    selftext:
      body.length > SELFTEXT_MAX ? body.slice(0, SELFTEXT_MAX) + "…" : body,
    permalink: `https://www.reddit.com${p.permalink}`,
    score: p.score,
    numComments: p.num_comments,
    createdUtc: p.created_utc,
    flair: p.link_flair_text,
    question: isQuestion(p.title),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `Mining ${args.subs.join(", ")} — ${args.query ? `search "${args.query}"` : args.sort}` +
      `${args.sort === "top" || args.query ? ` (${args.time})` : ""}, up to ${args.limit}/sub` +
      `${args.noAuth ? " [no-auth]" : ""}`,
  );

  const token = args.noAuth ? null : await getAccessToken();
  const delayMs = args.noAuth ? NO_AUTH_DELAY_MS : REQUEST_DELAY_MS;

  const raw: RedditPost[] = [];
  for (const sub of args.subs) {
    const posts = await fetchSub(token, args, sub, delayMs);
    console.log(`  r/${sub}: ${posts.length} posts`);
    raw.push(...posts);
    await delay(delayMs);
  }

  // Dedup (crossposts/overlap), shape, optionally keep only question-shaped.
  const byId = new Map<string, RedditPost>();
  for (const p of raw) byId.set(p.id, p);
  let candidates = [...byId.values()].map(toCandidate);
  const total = candidates.length;
  if (args.questionsOnly) candidates = candidates.filter((c) => c.question);
  candidates.sort((a, b) => b.score - a.score);

  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  fs.writeFileSync(
    args.outPath,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        params: { ...args },
        count: candidates.length,
        candidates,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(
    `\n${candidates.length} candidates` +
      `${args.questionsOnly ? ` (question-shaped, from ${total} unique)` : ` (unique, from ${raw.length})`}` +
      ` → ${path.relative(process.cwd(), args.outPath)}`,
  );
  console.log(
    "Hand-pick rows, resolve classNames against the index, then label the gold set.",
  );
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
