// VIOLATION A2: server component imports next/navigation client hook
import { useRouter } from 'next/navigation';

export default function Page() {
  const router = useRouter();
  return <p>{router.toString()}</p>;
}
