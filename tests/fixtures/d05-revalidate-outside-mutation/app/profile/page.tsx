import { revalidateTag } from 'next/cache';

export default async function ProfilePage() {
  const action = async (formData: FormData) => {
    'use server';
    await Promise.resolve(formData);
    revalidateTag('profile');
  };
  return <form action={action} />;
}
