import { revalidatePath } from 'next/cache';

export default async function AdminPage() {
  revalidatePath('/admin'); // ❌ render-path no-op
  return <div>admin</div>;
}
