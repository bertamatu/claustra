// VIOLATION A2: server component imports React client hook useState
import { useState } from 'react';

export default function Page() {
  const [count, setCount] = useState(0);
  return <p>{count}</p>;
}
