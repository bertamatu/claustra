// Minimal page so the TS Program has at least one source file. The a03 rule
// reads .env* files and next.config.* directly; this file is just here to
// keep the program-construction path identical to the other fixtures.
export default function Page(): JSX.Element {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
  return <main>{apiUrl}</main>;
}
