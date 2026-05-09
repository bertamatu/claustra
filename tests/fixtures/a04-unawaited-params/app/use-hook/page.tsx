'use client';

import { use } from 'react';

type Props = {
  params: Promise<{ slug: string }>;
};

export default function UseHookPage({ params }: Props) {
  const { slug } = use(params);
  return <div>{slug}</div>;
}
