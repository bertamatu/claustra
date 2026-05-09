type Ctx = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Ctx) {
  const id = params.id;
  return new Response(id);
}
