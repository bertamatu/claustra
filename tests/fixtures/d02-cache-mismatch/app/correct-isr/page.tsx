// NON-VIOLATION: ISR with matching, explicit fetch options
export const revalidate = 60;

export default async function Page() {
  const data = await fetch('https://api.example.com/data', {
    next: { revalidate: 60 },
  });
  return <p>{(await data.text()).slice(0, 10)}</p>;
}
