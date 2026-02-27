export type BlogAuthor = {
  name: string;
  role?: string;
  type?: "Person" | "Organization";
};

export type BlogCitation = {
  label: string;
  url: string;
};

export type BlogContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "image"; src: string; alt: string; caption?: string };

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  author: BlogAuthor;
  tags: string[];
  content: BlogContentBlock[];
  citations?: BlogCitation[];
  methodology?: string[];
};
