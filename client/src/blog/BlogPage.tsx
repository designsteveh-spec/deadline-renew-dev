import { useEffect, useMemo, useState } from "react";
import logoFull from "../assets/icons/extractor-logo-full-svg.svg";
import socialFacebook from "../assets/icons/socialFacebook.svg";
import socialTwitter from "../assets/icons/socialTwitter.svg";
import socialTikTok from "../assets/icons/socialTikTok.svg";
import { loadPublishedPosts } from "./cms";
import type { BlogPost } from "./types";
import { applyBlogIndexJsonLd, applyBlogPostJsonLd, applySeo } from "../seo";

function formatDate(input: string) {
  return new Date(input).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function renderLinkedText(text: string) {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const parts: Array<{ type: "text" | "link"; text: string; href?: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    const [full, label, href] = match;
    const start = match.index;
    if (start > lastIndex) {
      parts.push({ type: "text", text: text.slice(lastIndex, start) });
    }
    parts.push({ type: "link", text: label, href });
    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", text: text.slice(lastIndex) });
  }

  return parts.map((part, idx) =>
    part.type === "link" ? (
      <a key={`lnk-${idx}`} href={part.href} target="_blank" rel="noreferrer">
        {part.text}
      </a>
    ) : (
      <span key={`txt-${idx}`}>{part.text}</span>
    )
  );
}

export default function BlogPage() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/blog";
  const slug = pathname.startsWith("/blog/") ? pathname.replace("/blog/", "") : "";
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const post = useMemo(() => posts.find((p) => p.slug === slug) || null, [posts, slug]);

  useEffect(() => {
    let mounted = true;
    loadPublishedPosts().then((next) => {
      if (mounted) setPosts(next);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!slug) {
      applySeo({
        title: "Blog",
        description: "Deadline & Renewal Extractor blog with deterministic deadline extraction workflows and operations guidance.",
        path: "/blog"
      });
      applyBlogIndexJsonLd();
      return;
    }

    if (!post) {
      applySeo({
        title: "Blog Post Not Found",
        description: "The requested blog post was not found.",
        path: pathname
      });
      return;
    }

    applySeo({
      title: post.title,
      description: post.description,
      path: `/blog/${post.slug}`,
      type: "article",
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt
    });
    applyBlogPostJsonLd({
      title: post.title,
      description: post.description,
      slug: post.slug,
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
      author: post.author
    });
  }, [pathname, post, slug]);

  return (
    <div className="blogShell">
      <header className="siteHeader">
        <div className="siteHeaderInner">
          <a className="brand" href="/" aria-label="Deadline Extractor Home">
            <img src={logoFull} alt="Deadline & Renewal Extractor" className="logo logoFull" />
          </a>
          <nav className="siteNav">
            <a className="siteCta" href="/">
              <span className="navBtnLabel">Home</span>
            </a>
            <a className="siteCta" href="/blog">
              <span className="navBtnLabel">Blog</span>
            </a>
          </nav>
        </div>
      </header>
      <main className="blogPage">
        {!slug && (
          <>
            <section className="blogHero">
              <h1>Deadline & Renewal Blog</h1>
              <p>Deterministic workflow guidance for renewal, notice, and term-end deadline control.</p>
            </section>
            <section className="blogList">
              {posts.map((item) => (
                <article className="blogCard" key={item.slug}>
                  <p className="blogMeta">{formatDate(item.publishedAt)}</p>
                  <h2>
                    <a href={`/blog/${item.slug}`}>{item.title}</a>
                  </h2>
                  <p>{item.description}</p>
                </article>
              ))}
              {!posts.length && (
                <article className="blogCard">
                  <h2>Posts Coming Soon</h2>
                  <p>New articles will appear here as they are published.</p>
                </article>
              )}
            </section>
          </>
        )}

        {!!slug && !post && (
          <section className="blogHero">
            <h1>Post Not Found</h1>
            <p>
              The article you requested is unavailable. Visit the <a href="/blog">blog index</a>.
            </p>
          </section>
        )}

        {!!slug && !!post && (
          <article className="blogPost">
            <a className="blogBack" href="/blog">
              Back to Blog
            </a>
            <h1>{post.title}</h1>
            <p className="blogMeta">
              {formatDate(post.publishedAt)} | {post.author.name}
            </p>
            {post.updatedAt && <p className="blogMeta">Last updated: {formatDate(post.updatedAt)}</p>}
            {post.content.map((block, idx) =>
              block.type === "paragraph" ? (
                <p key={idx}>{renderLinkedText(block.text)}</p>
              ) : (
                <figure key={idx} className="blogImage">
                  <img src={block.src} alt={block.alt} />
                  {block.caption && <figcaption>{block.caption}</figcaption>}
                </figure>
              )
            )}
            {!!post.methodology?.length && (
              <section className="blogSection">
                <h2>Methodology</h2>
                {post.methodology.map((line, idx) => (
                  <p key={idx}>{line}</p>
                ))}
              </section>
            )}
            {!!post.citations?.length && (
              <section className="blogSection">
                <h2>Citations</h2>
                {post.citations.map((citation) => (
                  <p key={citation.url}>
                    <a href={citation.url} target="_blank" rel="noreferrer">
                      {citation.label}
                    </a>
                  </p>
                ))}
              </section>
            )}
          </article>
        )}
      </main>
      <footer className="siteFooter">
        <div className="siteFooterInner">
          <div className="footerCol">
            <p className="footerBrand">Deadline & Renewal Extractor</p>
            <p className="footerNote">
              Deterministic extraction for renewals, notice deadlines, payment due dates, and term/trial endings.
            </p>
            <div className="footerSocials">
              <a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook">
                <img src={socialFacebook} alt="" />
              </a>
              <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="X">
                <img src={socialTwitter} alt="" />
              </a>
              <a href="https://tiktok.com" target="_blank" rel="noreferrer" aria-label="TikTok">
                <img src={socialTikTok} alt="" />
              </a>
            </div>
          </div>
          <div className="footerCol footerLinksCol">
            <a href="/">Home</a>
            <a href="/blog">Blog</a>
            <a href="/#extract">Run Extraction</a>
            <a href="/#pricing">Upgrade</a>
            <a href="https://trusted-tools.com/" target="_blank" rel="noreferrer">
              Trusted-Tools
            </a>
          </div>
          <div className="footerCol footerLinksCol">
            <p className="footerPolicyIntro">We aim to meet WCAG 2.1 AA guidelines.</p>
            <a href="/#terms">Terms of Service</a>
            <a href="/#refund">Refund Policy</a>
            <a href="/#privacy">Privacy Policy</a>
          </div>
        </div>
        <div className="footerBottom">(c) 2026 Deadline & Renewal Extractor</div>
      </footer>
    </div>
  );
}
