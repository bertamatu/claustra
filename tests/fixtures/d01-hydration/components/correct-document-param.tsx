'use client';

// A Client Component that takes a parameter named `document`. The parameter
// is NOT the browser global - claustra must resolve via the symbol table.
type DocumentProp = { id: string; title: string };

export const DocumentTitle = ({ document }: { document: DocumentProp }) => {
  return <span>{document.title}</span>;
};
