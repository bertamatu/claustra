// VIOLATION D2: fetch to localhost
export default async function Page() {
  const data = await fetch('http://localhost:3000/api/x');
  const data2 = await fetch('http://127.0.0.1:8080/api/y');
  return (
    <div>
      <p>{(await data.text()).slice(0, 10)}</p>
      <p>{(await data2.text()).slice(0, 10)}</p>
    </div>
  );
}
