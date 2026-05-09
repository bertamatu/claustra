type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props) {
  return { title: params.slug };
}

export default async function Page() {
  return <div>page</div>;
}
