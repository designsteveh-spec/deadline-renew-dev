type SeoOptions = {
  title: string;
  description: string;
  path?: string;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
};

const SITE_NAME = "Deadline & Renewal Extractor";

function upsertMetaByName(name: string, content: string) {
  let node = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute("name", name);
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
}

function upsertMetaByProperty(property: string, content: string) {
  let node = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute("property", property);
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
}

function upsertCanonical(url: string) {
  let node = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
  if (!node) {
    node = document.createElement("link");
    node.setAttribute("rel", "canonical");
    document.head.appendChild(node);
  }
  node.setAttribute("href", url);
}

function upsertJsonLd(id: string, data: Record<string, unknown>) {
  let node = document.getElementById(id) as HTMLScriptElement | null;
  if (!node) {
    node = document.createElement("script");
    node.id = id;
    node.type = "application/ld+json";
    document.head.appendChild(node);
  }
  node.textContent = JSON.stringify(data);
}

export function applySeo(options: SeoOptions) {
  const {
    title,
    description,
    path = window.location.pathname,
    type = "website",
    publishedTime,
    modifiedTime
  } = options;
  const origin = window.location.origin;
  const canonical = `${origin}${path}`;
  const fullTitle = `${title} | ${SITE_NAME}`;

  document.title = fullTitle;
  upsertMetaByName("description", description);
  upsertCanonical(canonical);

  upsertMetaByProperty("og:title", fullTitle);
  upsertMetaByProperty("og:description", description);
  upsertMetaByProperty("og:type", type);
  upsertMetaByProperty("og:url", canonical);
  upsertMetaByProperty("og:site_name", SITE_NAME);

  upsertMetaByName("twitter:card", "summary_large_image");
  upsertMetaByName("twitter:title", fullTitle);
  upsertMetaByName("twitter:description", description);

  if (publishedTime) upsertMetaByProperty("article:published_time", publishedTime);
  if (modifiedTime) upsertMetaByProperty("article:modified_time", modifiedTime);
}

export function applyBlogIndexJsonLd() {
  const origin = window.location.origin;
  upsertJsonLd("jsonld-blog", {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Deadline & Renewal Extractor Blog",
    url: `${origin}/blog`,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME
    }
  });
}

export function applyBlogPostJsonLd(input: {
  title: string;
  description: string;
  slug: string;
  publishedAt: string;
  updatedAt?: string;
  author: { name: string; type?: "Person" | "Organization" };
}) {
  const origin = window.location.origin;
  upsertJsonLd("jsonld-blogpost", {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title,
    description: input.description,
    datePublished: input.publishedAt,
    dateModified: input.updatedAt || input.publishedAt,
    author: {
      "@type": input.author.type || "Organization",
      name: input.author.name
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME
    },
    mainEntityOfPage: `${origin}/blog/${input.slug}`
  });
}
