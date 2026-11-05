"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getBalanceTransactions,
  getPaidAmount,
  type Debt,
} from "@/lib/debt-payments";
import {
  readPlannedAssignments,
  type PlannedIncome,
} from "@/lib/planner";
import {
  assessNextPlannedIncome,
} from "@/lib/planner-health";
import { useSession } from "./session-context";
import { localDateString } from "./task-data";
import PlannerHealthBanner from "./planner-health-banner";
import { usePlannerAlertThresholds } from "./use-planner-alert-thresholds";

function readIncome(id: string, userId: string, data: Record<string, unknown>): PlannedIncome | null {
  const assignments = readPlannedAssignments(data);
  if (
    data.userId !== userId
    || typeof data.title !== "string"
    || typeof data.amount !== "number"
    || !Number.isFinite(data.amount)
    || data.amount <= 0
    || (data.currency !== "Bs" && data.currency !== "$")
    || typeof data.estimatedDate !== "string"
    || (data.status !== "pendiente" && data.status !== "ejecutado")
    || !assignments
  ) {
    return null;
  }
  return {
    id,
    userId,
    title: data.title,
    amount: data.amount,
    currency: data.currency,
    estimatedDate: data.estimatedDate,
    status: data.status,
    assignments,
  };
}

function readDebt(id: string, userId: string, data: Record<string, unknown>): Debt | null {
  const amount = Number(data.amount);
  if (
    data.userId !== userId
    || typeof data.title !== "string"
    || (data.type !== "payable" && data.type !== "receivable")
    || !Number.isFinite(amount)
    || amount <= 0
    || (data.currency !== "Bs" && data.currency !== "$")
    || typeof data.dueDate !== "string"
  ) {
    return null;
  }
  const paidAmount = getPaidAmount(data, amount);
  return {
    id,
    userId,
    title: data.title,
    type: data.type,
    amount,
    currency: data.currency,
    dueDate: data.dueDate,
    paid: data.paid === true || paidAmount >= amount - 0.005,
    paidAmount,
    balanceTransactions: getBalanceTransactions(data),
  };
}

export default function PlannerDashboardAlert() {
  const { userId } = useSession();
  const [incomes, setIncomes] = useState<PlannedIncome[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [incomeOwnerId, setIncomeOwnerId] = useState<string | null>(null);
  const [debtOwnerId, setDebtOwnerId] = useState<string | null>(null);
  const [today, setToday] = useState(localDateString());
  const [error, setError] = useState("");
  const thresholds = usePlannerAlertThresholds(userId);

  useEffect(() => {
    if (!userId) return;
    const ownerId = userId;
    const stopIncomes = onSnapshot(
      query(collection(db, "plannedIncomes"), where("userId", "==", ownerId)),
      (snapshot) => {
        setIncomes(snapshot.docs
          .map((item) => readIncome(item.id, ownerId, item.data()))
          .filter((income): income is PlannedIncome => income !== null));
        setIncomeOwnerId(ownerId);
      },
      () => setError("No se pudo cargar la alerta del próximo ingreso."),
    );
    const stopDebts = onSnapshot(
      query(collection(db, "debts"), where("userId", "==", ownerId)),
      (snapshot) => {
        setDebts(snapshot.docs
          .map((item) => readDebt(item.id, ownerId, item.data()))
          .filter((debt): debt is Debt => debt !== null));
        setDebtOwnerId(ownerId);
      },
      () => setError("No se pudieron cargar las deudas para la alerta financiera."),
    );
    return () => {
      stopIncomes();
      stopDebts();
    };
  }, [userId]);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDateString()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const assessment = useMemo(() => assessNextPlannedIncome(
    incomes,
    debts,
    today,
    thresholds,
  ), [debts, incomes, thresholds, today]);

  if (!userId || incomeOwnerId !== userId || debtOwnerId !== userId) return null;
  if (!error && !assessment?.level && !assessment?.hasMissingDebts) return null;
  return (
    <div className="mt-8 space-y-3">
      {error && <p role="status" className="border border-amber-300/35 bg-amber-950/30 p-3 text-xs text-amber-100">{error}</p>}
      <PlannerHealthBanner assessment={assessment} compact />
    </div>
  );
}
