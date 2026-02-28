import fs from "node:fs/promises";

const SITE_ORIGIN = "https://deadline-renew-frontend-staging.onrender.com";
const BLOG_FEED_URL = (process.env.BLOG_FEED_URL || "").trim();

function nowIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isPublished(publishedAt) {
  const ts = Date.parse(publishedAt || "");
  return Number.isFinite(ts) && ts <= Date.now();
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function loadFeed() {
  if (!BLOG_FEED_URL) return [];
  const res = await fetch(BLOG_FEED_URL);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function toSitemapXml(posts) {
  const staticUrls = [
    { loc: `${SITE_ORIGIN}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${SITE_ORIGIN}/blog`, changefreq: "weekly", priority: "0.8" }
  ];

  const blogUrls = posts
    .filter((p) => p?.slug && p?.publishedAt && isPublished(p.publishedAt))
    .map((p) => ({
      loc: `${SITE_ORIGIN}/blog/${p.slug}`,
      changefreq: "monthly",
      priority: "0.7",
      lastmod: (p.updatedAt || p.publishedAt || nowIsoDate()).slice(0, 10)
    }));

  const rows = [...staticUrls, ...blogUrls]
    .map((u) => {
      const lastmodLine = u.lastmod ? `\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : "";
      return `  <url>\n    <loc>${escapeXml(u.loc)}</loc>${lastmodLine}\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
}

async function main() {
  let posts = [];
  try {
    posts = await loadFeed();
  } catch {
    posts = [];
  }

  const xml = toSitemapXml(posts);
  await fs.writeFile("public/sitemap.xml", xml, "utf8");
  console.log(`Sitemap generated with ${posts.length} CMS posts available`);
}

main();
