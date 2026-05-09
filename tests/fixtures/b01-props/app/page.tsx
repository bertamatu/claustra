import { Widget } from '../components/widget.js';
import { ServerCounter } from '../components/server-counter.js';
import { UserClass } from '../lib/user-class.js';
import { logClick, deletePost } from '../actions.js';

const inlineHandler = (): void => {};
const inlineMap = new Map<string, string>([['a', 'b']]);
const inlineSet = new Set<string>(['a']);

export default function Page(): JSX.Element {
  const spread = { data: 'hi', count: 1 };
  return (
    <main>
      {/* Functions - flag (high) */}
      <Widget cb={() => console.log('inline')} />
      <Widget cb={inlineHandler} />

      {/* Server actions - DO NOT flag */}
      <Widget cb={logClick} />
      <Widget cb={deletePost as unknown as () => void} />

      {/* Date - flag (medium) */}
      <Widget date={new Date()} />

      {/* Map / Set - flag (high) */}
      <Widget map={inlineMap} />
      <Widget set={inlineSet} />

      {/* BigInt / Symbol - flag (high) */}
      <Widget big={1n} />
      <Widget sym={Symbol('x')} />

      {/* Class instance - flag (high) */}
      <Widget user={new UserClass('alice')} />

      {/* Allowed - Promise, plain data, children */}
      <Widget promise={Promise.resolve('p')} />
      <Widget data="hello" count={5} />
      <Widget>{'children-content'}</Widget>

      {/* Spread - B1 ignores (B2 will flag) */}
      <Widget {...spread} />

      {/* Server component target - DO NOT flag function */}
      <ServerCounter cb={() => {}} />

      {/* Intrinsic element - DO NOT flag (A2 territory) */}
      <button onClick={() => {}}>click</button>
    </main>
  );
}
