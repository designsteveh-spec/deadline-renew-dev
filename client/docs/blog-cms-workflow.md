# Blog CMS Workflow

## Goals
- Blog lives at `/blog`
- Posts support text + images
- Publishing can be scheduled weekly (for example Monday, 8:00 AM Pacific)
- No personal byline required

## CMS Contract
Set `VITE_BLOG_FEED_URL` to an endpoint that returns an array of posts:

```json
[
  {
    "slug": "example-post",
    "title": "Example Title",
    "description": "Short summary",
    "publishedAt": "2026-03-02T16:00:00.000Z",
    "updatedAt": "2026-03-05T19:00:00.000Z",
    "authorName": "Deadline & Renewal Editorial Team",
    "authorRole": "Editorial",
    "authorType": "Organization",
    "tags": ["renewal"],
    "content": [
      { "type": "paragraph", "text": "Body text..." },
      { "type": "image", "src": "https://cdn.example.com/post-1.jpg", "alt": "Chart", "caption": "Q1 data" }
    ],
    "methodology": ["How the data was collected..."],
    "citations": [{ "label": "Source", "url": "https://example.com/report" }]
  }
]
```

Only posts whose `publishedAt` is in the past are rendered unless `VITE_BLOG_SHOW_SCHEDULED=true`.

## Auto-Posting Pattern
Auto-posting is handled by your CMS scheduler:
1. Create drafts in CMS.
2. Set future `publishedAt` timestamps.
3. Configure CMS scheduled publish.
4. Trigger frontend deploy webhook on publish.

At build time, pass `BLOG_FEED_URL` so sitemap generation can include published blog slugs:

```bash
BLOG_FEED_URL="https://your-cms.example.com/api/blog-feed" npm run build
```
