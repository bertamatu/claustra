// VIOLATION D2: revalidate value mismatch between route and fetch
export const revalidate = 3600;

export default async function Page() {
  const data = await fetch('https://api.example.com/data', {
    next: { revalidate: 60 },
  });
  return <p>{(await data.text()).slice(0, 10)}</p>;
}
