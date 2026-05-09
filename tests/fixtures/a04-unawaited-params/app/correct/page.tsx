type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
};

export default async function CorrectPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  return (
    <div>
      {slug} - {sp.q}
    </div>
  );
}
