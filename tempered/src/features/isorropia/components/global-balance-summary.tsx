"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

type Props = { userId: string; repartoId: string };
type Totals = { incomeBs: number; transactionsBs: number; transactionsUsd: number };
const emptyTotals: Totals = { incomeBs: 0, transactionsBs: 0, transactionsUsd: 0 };
const formatMoney = (value: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

function sumField(documents: { data: () => Record<string, unknown> }[], field: string) {
  return documents.reduce((sum, item) => sum + Number(item.data()[field] ?? 0), 0);
}

export default function GlobalBalanceSummary({ userId, repartoId }: Props) {
  const [totals, setTotals] = useState(emptyTotals);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let completed = 0;
    const markLoaded = () => {
      completed += 1;
      if (completed === 3) setLoaded(true);
    };
    const fail = (message: string) => {
      setError(message);
      markLoaded();
    };
    const base = (collectionName: string) => collection(db, "distributions", repartoId, collectionName);
    const stopIncomes = onSnapshot(base("incomes"), (snapshot) => {
      setTotals((current) => ({ ...current, incomeBs: sumField(snapshot.docs, "totalBs") }));
      markLoaded();
    }, () => fail("No se pudieron cargar los ingresos del resumen global."));
    const stopBs = onSnapshot(base("transactions"), (snapshot) => {
      setTotals((current) => ({ ...current, transactionsBs: sumField(snapshot.docs, "incomeBs") - sumField(snapshot.docs, "expenseBs") }));
      markLoaded();
    }, () => fail("No se pudieron cargar los movimientos en Bs del resumen global."));
    const stopUsd = onSnapshot(base("dollarTransactions"), (snapshot) => {
      setTotals((current) => ({ ...current, transactionsUsd: sumField(snapshot.docs, "incomeUsd") - sumField(snapshot.docs, "expenseUsd") }));
      markLoaded();
    }, () => fail("No se pudieron cargar los movimientos en $ del resumen global."));
    return () => {
      stopIncomes();
      stopBs();
      stopUsd();
    };
  }, [repartoId, userId]);

  const totalBs = totals.incomeBs + totals.transactionsBs;

  return (
    <section className="mx-auto mt-6 w-full max-w-5xl rounded-2xl border border-[#ddab36]/35 bg-gradient-to-br from-[#2b210b]/80 via-[#15130e]/90 to-[#090909]/90 p-5 shadow-lg shadow-black/25 sm:p-6" aria-labelledby="global-balance-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#ddab36]/70">Panorama del periodo</p>
          <h2 id="global-balance-title" className="mt-1 text-sm font-semibold uppercase tracking-wide text-white/85">Resumen Global de Balances</h2>
        </div>
        <span className="rounded-full border border-[#ddab36]/25 bg-black/30 px-3 py-1 text-[10px] uppercase text-white/45">Monedas separadas · Bs y $</span>
      </div>
      {error ? <p role="alert" className="mt-4 text-xs text-red-200">{error}</p> : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <article className="rounded-xl border border-[#ddab36]/20 bg-black/25 p-4">
            <p className="text-xs uppercase text-white/50">Balance en bolívares</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-[#f2c75c]">{loaded ? `Bs ${formatMoney(totalBs)}` : "Cargando..."}</p>
          </article>
          <article className="rounded-xl border border-white/10 bg-black/25 p-4">
            <p className="text-xs uppercase text-white/50">Balance en dólares</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-amber-100">{loaded ? `$ ${formatMoney(totals.transactionsUsd)}` : "Cargando..."}</p>
          </article>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-5 text-white/40">Saldo del periodo seleccionado, considerando ingresos asignados y todos los movimientos del periodo. No se convierte ni suma entre monedas.</p>
    </section>
  );
}
