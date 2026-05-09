// /admin/users — sensitive "admin" segment but covered by middleware
// matcher `/admin/:path*` whose body calls auth(). Should NOT flag.
export default function AdminUsersPage(): JSX.Element {
  return <div>Admin users</div>;
}
