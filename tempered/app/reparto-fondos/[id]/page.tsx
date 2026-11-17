import RepartoFondosDetalle from "@/features/isorropia/components/reparto-fondos-detalle";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ draftId?: string | string[] }>;
};

export default async function RepartoFondosDetailPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const draftId = typeof query.draftId === "string" ? query.draftId : undefined;
  return <RepartoFondosDetalle key={`${id}-${draftId ?? ""}`} repartoId={id} draftId={draftId} />;
}
