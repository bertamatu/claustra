// `document` here is a function parameter (a domain "document" object), not
// the browser global. claustra D1 must resolve identifiers via the TS symbol
// table and confirm the name is NOT a project-level declaration before
// flagging.

type Document = { id: string; title: string };

export const upper = (document: Document): string => {
  // Reads `document.title` look like a browser-global read syntactically. The
  // symbol resolves to the function parameter above, so the rule must skip.
  return document.title.toUpperCase();
};

export const summarize = (documents: Document[]): string[] => {
  return documents.map((document) => document.title.slice(0, 10));
};
