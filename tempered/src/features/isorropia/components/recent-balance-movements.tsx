"use client";

type RecentMovement = {
  id: string;
  category: string;
  date: string;
  createdAt: number;
  description: string;
  income: number;
  expense: number;
};

type Props = {
  movements: RecentMovement[];
  currency: "Bs" | "$";
  onSelectCategory: (category: string) => void;
};

export default function RecentBalanceMovements({ movements, currency, onSelectCategory }: Props) {
  const recentMovements = [...movements]
    .sort((first, second) =>
      second.date.localeCompare(first.date)
      || second.createdAt - first.createdAt
      || second.id.localeCompare(first.id))
    .slice(0, 5);

  if (recentMovements.length === 0) {
    return (
      <p className="mt-5 rounded-2xl border border-dashed border-white/20 p-8 text-center text-sm text-white/55">
        Aún no hay movimientos registrados en este periodo.
      </p>
    );
  }

  const formatAmount = (amount: number) => currency === "$"
    ? `$${amount.toFixed(2)}`
    : `${amount.toFixed(2)} Bs`;

  return (
    <div className="mt-5 space-y-2">
      {recentMovements.map((movement) => (
        <button
          key={`${movement.category}-${movement.id}`}
          type="button"
          onClick={() => onSelectCategory(movement.category)}
          aria-label={`Ver categoría ${movement.category}: ${movement.description}`}
          className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-left transition hover:border-red-500/50 hover:bg-red-500/5 sm:px-4"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-white">{movement.description}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] uppercase text-red-200">
                {movement.category}
              </span>
              <span className="text-xs text-white/50">{movement.date || "Fecha no disponible"}</span>
            </span>
          </span>
          <span className="shrink-0 text-right text-sm tabular-nums">
            {movement.income > 0 && (
              <span className="block text-emerald-300">+{formatAmount(movement.income)}</span>
            )}
            {movement.expense > 0 && (
              <span className="block text-red-300">−{formatAmount(movement.expense)}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
