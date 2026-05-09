type Props = {
  params: { team: string };
};

export default function DashboardPage({ params }: Props) {
  return <div>{params.team}</div>;
}
