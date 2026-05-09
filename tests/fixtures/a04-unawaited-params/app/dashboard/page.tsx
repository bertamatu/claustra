type Props = {
  params: Promise<{ team: string }>;
};

export default async function DashboardPage({ params }: Props) {
  const { team } = params;
  return <div>{team}</div>;
}
