import { redirect } from "next/navigation";

export default async function LegacyRepartoFondosDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/reparto-fondos/${id}`);
}
