import { Counter } from '../components/counter';
import { greeting } from '../components/util';

export default function Page() {
  return (
    <main>
      <h1>{greeting()}</h1>
      <Counter />
    </main>
  );
}
