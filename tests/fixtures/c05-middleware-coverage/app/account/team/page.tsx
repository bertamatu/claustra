// /account/team - sensitive "account" segment, no inline auth call,
// not covered by middleware matcher, but the parent layout
// (app/account/layout.tsx) calls auth(). Should NOT flag.
export default function TeamPage(): JSX.Element {
  return <div>Team</div>;
}
