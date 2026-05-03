// VIOLATION D2: cache: 'no-store' inside an ISR-declared route
export const revalidate = 600;

export default async function Page() {
  const data = await fetch('https://api.example.com/x', { cache: 'no-store' });
  return <p>{(await data.text()).slice(0, 10)}</p>;
}
