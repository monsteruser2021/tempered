import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { localDateString } from "@/app/components/task-data";

export type DebtType = "receivable" | "payable";
export type Currency = "Bs" | "$";
export type BalanceTransactionLink = { distributionId: string; transactionId: string };
export type Debt = {
  id: string;
  userId: string;
  title: string;
  type: DebtType;
  amount: number;
  currency: Currency;
  dueDate: string;
  paid: boolean;
  paidAmount: number;
  balanceTransactions: BalanceTransactionLink[];
};
export type DebtInput = Omit<Debt, "id" | "userId" | "paidAmount" | "balanceTransactions">;

export const debtCategory = (currency: Currency) => currency === "Bs" ? "Otros gastos" : "Ahorro";

export function getOutstandingDebt(debt: Pick<Debt, "amount" | "paid" | "paidAmount">) {
  return debt.paid ? 0 : Math.max(0, debt.amount - debt.paidAmount);
}

export function getBalanceTransactions(data: Record<string, unknown>): BalanceTransactionLink[] {
  const links = Array.isArray(data.balanceTransactions)
    ? data.balanceTransactions.filter((item): item is BalanceTransactionLink => (
      Boolean(item)
      && typeof item === "object"
      && typeof (item as BalanceTransactionLink).distributionId === "string"
      && typeof (item as BalanceTransactionLink).transactionId === "string"
    ))
    : [];
  const legacy = data.balanceTransaction;
  if (
    legacy
    && typeof legacy === "object"
    && typeof (legacy as BalanceTransactionLink).distributionId === "string"
    && typeof (legacy as BalanceTransactionLink).transactionId === "string"
  ) {
    const link = legacy as BalanceTransactionLink;
    if (!links.some((item) => item.distributionId === link.distributionId && item.transactionId === link.transactionId)) {
      links.push(link);
    }
  }
  return links;
}

export function getPaidAmount(data: Record<string, unknown> | undefined, amount: number) {
  if (!data) return 0;
  if (typeof data.paidAmount === "number" && Number.isFinite(data.paidAmount)) {
    return Math.min(amount, Math.max(0, data.paidAmount));
  }
  return data.paid === true ? amount : 0;
}

export async function saveDebtAndPayment(
  userId: string,
  debtId: string | null,
  input: DebtInput,
  paymentOverride?: number,
  reversePayments = false,
) {
  const debtRef = debtId ? doc(db, "debts", debtId) : doc(collection(db, "debts"));
  const today = localDateString();
  const [year, month] = today.split("-").map(Number);
  let currentRepartoId: string | undefined;

  if (paymentOverride !== undefined || input.paid) {
    if (typeof userId !== "string" || userId.trim() === "") {
      throw new Error("Debes iniciar sesión para registrar el pago.");
    }
    const ownerId = userId.trim();
    const repartos = await getDocs(query(collection(db, "distributions"), where("userId", "==", ownerId)));
    const currentRepartos = repartos.docs.filter((item) => {
      const data = item.data();
      return Number(data.month) === month - 1 && Number(data.year) === year;
    });
    currentRepartoId = (currentRepartos.find((item) => item.data().isAutomatic !== true) ?? currentRepartos[0])?.id;
  }

  return runTransaction(db, async (transaction) => {
    const existingSnapshot = debtId ? await transaction.get(debtRef) : null;
    if (debtId && !existingSnapshot?.exists()) throw new Error("La deuda ya no existe o no está disponible.");

    const existingData = existingSnapshot?.data();
    if (existingData && existingData.userId !== userId) throw new Error("No tienes permiso para actualizar esta deuda.");
    const existingAmount = Number(existingData?.amount ?? 0);
    const existingPaidAmount = getPaidAmount(existingData, existingAmount);
    const existingIsPaid = Boolean(existingData) && (
      existingData?.paid === true
      || existingPaidAmount >= existingAmount - 0.005
    );
    const balanceTransactions = getBalanceTransactions(existingData ?? {});
    const hasPayments = existingPaidAmount > 0 || balanceTransactions.length > 0;
    const monetaryDetailsChanged = existingData && (
      existingData.type !== input.type
      || existingData.currency !== input.currency
      || existingAmount !== input.amount
    );
    if (hasPayments && monetaryDetailsChanged) {
      throw new Error("Para cambiar el tipo, moneda o monto, revierte primero los abonos registrados.");
    }

    const needsReversal = reversePayments || (
      paymentOverride === undefined
      && existingIsPaid
      && !input.paid
    );
    const amountToApply = paymentOverride !== undefined
      ? Math.round(paymentOverride * 100) / 100
      : input.paid && !existingIsPaid
        ? Math.round((input.amount - existingPaidAmount) * 100) / 100
        : 0;
    if (paymentOverride !== undefined && (!Number.isFinite(amountToApply) || amountToApply <= 0)) {
      throw new Error("Indica un monto de abono mayor que cero.");
    }
    if (amountToApply > input.amount - existingPaidAmount + 0.005) {
      throw new Error("El abono supera el saldo pendiente de la deuda.");
    }
    if (paymentOverride !== undefined && existingIsPaid) {
      throw new Error("Esta deuda ya está saldada.");
    }

    const nextPaidAmount = needsReversal ? 0 : Math.min(input.amount, existingPaidAmount + amountToApply);
    const nextPaid = nextPaidAmount >= input.amount - 0.005;
    const needsPayment = amountToApply > 0;
    const repartoId = currentRepartoId;
    if (needsPayment) {
      if (!repartoId) throw new Error("No existe un reparto de fondos para el mes actual; créalo antes de registrar el pago.");
      const repartoRef = doc(db, "distributions", repartoId);
      const repartoSnapshot = await transaction.get(repartoRef);
      const reparto = repartoSnapshot.data();
      if (
        !repartoSnapshot.exists()
        || reparto?.userId !== userId
        || Number(reparto.month) !== month - 1
        || Number(reparto.year) !== year
      ) {
        throw new Error("El reparto de fondos del mes actual ya no está disponible. Actualiza la página e inténtalo de nuevo.");
      }
    }

    const reversalRefs = needsReversal
      ? balanceTransactions.map((link) => doc(
        db,
        "distributions",
        link.distributionId,
        existingData?.currency === "$" ? "dollarTransactions" : "transactions",
        link.transactionId,
      ))
      : [];
    const reversalSnapshots = await Promise.all(reversalRefs.map((reference) => transaction.get(reference)));
    if (reversalSnapshots.some((snapshot) => !snapshot.exists())) {
      throw new Error("No se pudo revertir el pago porque falta uno de sus movimientos en el balance.");
    }

    let newBalanceTransaction: BalanceTransactionLink | undefined;
    if (needsPayment) {
      if (!repartoId) throw new Error("No existe un reparto de fondos para el mes actual; créalo antes de registrar el pago.");
      const category = debtCategory(input.currency);
      const balanceCollection = input.currency === "Bs" ? "transactions" : "dollarTransactions";
      const movementType = input.type === "payable" ? "payment" : "collection";
      const balanceTransactionRef = doc(collection(db, "distributions", repartoId, balanceCollection));
      const description = input.type === "payable"
        ? `Pago de deuda: ${input.title}`
        : `Cobro recuperado de deuda: ${input.title}`;
      const isIncome = input.type === "receivable";
      const balanceTransaction = input.currency === "Bs"
        ? { category, date: today, description, incomeBs: isIncome ? amountToApply : 0, expenseBs: isIncome ? 0 : amountToApply }
        : { category, date: today, description, incomeUsd: isIncome ? amountToApply : 0, expenseUsd: isIncome ? 0 : amountToApply };
      transaction.set(balanceTransactionRef, {
        ...balanceTransaction,
        isDebtPayment: movementType === "payment",
        isDebtCollection: movementType === "collection",
        debtMovementType: movementType,
        debtId: debtRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      newBalanceTransaction = { distributionId: repartoId, transactionId: balanceTransactionRef.id };
    }
    reversalRefs.forEach((reference) => transaction.delete(reference));

    const debtData = {
      title: input.title,
      type: input.type,
      amount: input.amount,
      currency: input.currency,
      dueDate: input.dueDate,
      paid: nextPaid,
      paidAmount: nextPaidAmount,
      updatedAt: serverTimestamp(),
    };
    if (debtId) {
      transaction.update(debtRef, {
        ...debtData,
        ...(newBalanceTransaction ? { balanceTransactions: [...balanceTransactions, newBalanceTransaction] } : {}),
        ...(needsReversal ? { balanceTransactions: deleteField(), balanceTransaction: deleteField() } : {}),
      });
    } else {
      transaction.set(debtRef, {
        ...debtData,
        userId,
        ...(newBalanceTransaction ? { balanceTransactions: [newBalanceTransaction] } : {}),
        createdAt: serverTimestamp(),
      });
    }

    return {
      applied: amountToApply,
      paid: nextPaid,
      reversed: needsReversal,
      movementType: input.type === "payable" ? "payment" as const : "collection" as const,
    };
  });
}
