// Inside the (authenticated) route group — flagged as sensitive even
// though /profile itself isn't a recognized "admin"-style segment.
// Middleware matcher does not cover /profile, no inline auth call.
// Expected to flag.
export default function ProfilePage(): JSX.Element {
  return <div>Profile</div>;
}
