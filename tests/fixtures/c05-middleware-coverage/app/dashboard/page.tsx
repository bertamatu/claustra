// /dashboard — sensitive segment "dashboard". Middleware matcher does
// NOT include /dashboard and the page itself does not call auth().
// Expected to flag.
export default function DashboardPage(): JSX.Element {
  return <div>Dashboard</div>;
}
