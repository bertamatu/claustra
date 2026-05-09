type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
};

export default async function ItemPage({ params, searchParams }: Props) {
  const id = params.id;
  const tab = searchParams.tab;
  return (
    <div>
      {id} - {tab}
    </div>
  );
}
