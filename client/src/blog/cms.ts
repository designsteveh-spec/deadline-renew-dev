import { BLOG_POSTS } from "./posts";
import type { BlogPost } from "./types";

type CmsPost = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  authorName?: string;
  authorRole?: string;
  authorType?: "Person" | "Organization";
  tags?: string[];
  content?: Array<
    | { type: "paragraph"; text: string }
    | { type: "image"; src: string; alt: string; caption?: string }
  >;
  citations?: Array<{ label: string; url: string }>;
  methodology?: string[];
};

const BLOG_FEED_URL = (import.meta.env.VITE_BLOG_FEED_URL || "").trim();
const rawShowScheduled = String(import.meta.env.VITE_BLOG_SHOW_SCHEDULED || "").trim().toLowerCase();
const SHOW_SCHEDULED = rawShowScheduled === "true";

function isPublished(publishedAt: string) {
  const ts = Date.parse(publishedAt);
  return Number.isFinite(ts) && ts <= Date.now();
}

function toBlogPost(input: CmsPost): BlogPost {
  return {
    slug: String(input.slug || "").trim(),
    title: String(input.title || "").trim(),
    description: String(input.description || "").trim(),
    publishedAt: String(input.publishedAt || "").trim(),
    updatedAt: input.updatedAt ? String(input.updatedAt).trim() : undefined,
    author: {
      name: String(input.authorName || "Deadline & Renewal Editorial Team").trim(),
      role: input.authorRole ? String(input.authorRole).trim() : undefined,
      type: input.authorType || "Organization"
    },
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    content: Array.isArray(input.content) ? input.content : [],
    citations: Array.isArray(input.citations) ? input.citations : [],
    methodology: Array.isArray(input.methodology) ? input.methodology : []
  };
}

function isValidPost(post: BlogPost) {
  return !!(post.slug && post.title && post.description && post.publishedAt);
}

function sortPostsDescending(posts: BlogPost[]) {
  return [...posts].sort(
    (a, b) => Date.parse(b.publishedAt || "1970-01-01") - Date.parse(a.publishedAt || "1970-01-01")
  );
}

export async function loadPublishedPosts(): Promise<BlogPost[]> {
  if (!BLOG_FEED_URL) {
    const local = SHOW_SCHEDULED ? BLOG_POSTS : BLOG_POSTS.filter((p) => isPublished(p.publishedAt));
    return sortPostsDescending(local);
  }

  try {
    const res = await fetch(BLOG_FEED_URL, { cache: "no-store" });
    if (!res.ok) return sortPostsDescending(BLOG_POSTS);
    const payload = (await res.json()) as CmsPost[];
    if (!Array.isArray(payload)) return sortPostsDescending(BLOG_POSTS);

    const posts = payload
      .map(toBlogPost)
      .filter(isValidPost)
      .filter((p) => (SHOW_SCHEDULED ? true : isPublished(p.publishedAt)));
    return sortPostsDescending(posts);
  } catch {
    const local = SHOW_SCHEDULED ? BLOG_POSTS : BLOG_POSTS.filter((p) => isPublished(p.publishedAt));
    return sortPostsDescending(local);
  }
}
