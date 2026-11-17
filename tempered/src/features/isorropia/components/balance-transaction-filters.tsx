"use client";

export type MovementSort = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";
export type MovementType = "all" | "income" | "expense";
export type BalanceMovement = { id: string; date: string; income: number; expense: number };

type Props = {
  sort: MovementSort;
  type: MovementType;
  onSortChange: (value: MovementSort) => void;
  onTypeChange: (value: MovementType) => void;
};

export function sortAndFilterMovements<T extends BalanceMovement>(
  items: T[],
  sort: MovementSort,
  type: MovementType,
) {
  return items
    .filter((item) => type === "all" || (type === "income" ? item.income > 0 : item.expense > 0))
    .sort((first, second) => {
      if (sort === "date-asc") return first.date.localeCompare(second.date) || first.id.localeCompare(second.id);
      if (sort === "amount-desc") return second.income + second.expense - first.income - first.expense || second.date.localeCompare(first.date);
      if (sort === "amount-asc") return first.income + first.expense - second.income - second.expense || second.date.localeCompare(first.date);
      return second.date.localeCompare(first.date) || second.id.localeCompare(first.id);
    });
}

export default function BalanceTransactionFilters({ sort, type, onSortChange, onTypeChange }: Props) {
  const selectClass = "mt-1 min-h-10 w-full rounded-lg border border-white/20 bg-[#121212] px-3 py-2 text-sm text-white outline-none focus:border-[#ddab36]";
  return (
    <div className="mt-5 grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 sm:grid-cols-2 sm:p-4" aria-label="Filtros de movimientos">
      <label className="text-[11px] uppercase tracking-wide text-white/55">
        Ordenar por
        <select value={sort} onChange={(event) => onSortChange(event.target.value as MovementSort)} className={selectClass}>
          <option value="date-desc">Fecha · más reciente primero</option>
          <option value="date-asc">Fecha · más antigua primero</option>
          <option value="amount-desc">Monto · mayor a menor</option>
          <option value="amount-asc">Monto · menor a mayor</option>
        </select>
      </label>
      <label className="text-[11px] uppercase tracking-wide text-white/55">
        Tipo de movimiento
        <select value={type} onChange={(event) => onTypeChange(event.target.value as MovementType)} className={selectClass}>
          <option value="all">Todos</option>
          <option value="income">Solo ingresos</option>
          <option value="expense">Solo egresos</option>
        </select>
      </label>
    </div>
  );
}
