// VIOLATION D2 (Next 15+): bare fetch in an ISR-declared route
// On Next 15+ this fetch is no-store by default, breaking the route's revalidate intent.
export const revalidate = 60;

export default async function Page() {
  const data = await fetch('https://api.example.com/data');
  return <p>{(await data.text()).slice(0, 10)}</p>;
}
