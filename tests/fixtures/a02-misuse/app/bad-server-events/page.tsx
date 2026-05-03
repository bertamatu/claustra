// VIOLATION A2: server component has event handler on intrinsic element
export default function Page() {
  return (
    <div>
      <button onClick={() => alert('hi')}>Click me</button>
      <input onChange={(e) => console.log(e.target.value)} />
    </div>
  );
}
