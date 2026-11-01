import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type Currency = "Bs" | "$";

type SaleInput = {
  userId: string;
  investmentId: string;
  quantity: number;
};

type SaleResult = {
  sold: number;
  recoveredCapital: number;
  netProfit: number;
  remainingStock: number;
  date: string;
};

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function registerMythicalSale({ userId, investmentId, quantity }: SaleInput): Promise<SaleResult> {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new Error("Debes iniciar sesión para registrar la venta.");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("La cantidad debe ser un entero positivo.");

  const ownerId = userId.trim();
  const investmentRef = doc(db, "mythicalInvestments", investmentId);
  const saleRef = doc(collection(db, "mythicalSales"));
  const now = new Date();
  const date = localDateString(now);
  const month = now.getMonth();
  const year = now.getFullYear();
  const distributionsSnapshot = await getDocs(query(
    collection(db, "distributions"),
    where("userId", "==", ownerId),
    where("month", "==", month),
    where("year", "==", year),
  ));
  const existingDistribution = distributionsSnapshot.docs[0];
  const distributionId = existingDistribution?.id ?? `period-${encodeURIComponent(ownerId)}-${year}-${String(month + 1).padStart(2, "0")}`;
  const distributionRef = doc(db, "distributions", distributionId);

  return runTransaction(db, async (transaction) => {
    const [investmentSnapshot, distributionSnapshot] = await Promise.all([
      transaction.get(investmentRef),
      transaction.get(distributionRef),
    ]);

    if (!investmentSnapshot.exists()) throw new Error("El artículo ya no existe.");
    const investment = investmentSnapshot.data();
    if (investment.userId !== ownerId || investment.status !== "process") {
      throw new Error("El artículo no está disponible en el inventario activo.");
    }

    const totalUnits = Math.max(1, Math.floor(Number(investment.quantity ?? 1)));
    const remainingStock = Math.max(0, Math.floor(Number(investment.remainingStock ?? totalUnits)));
    if (quantity > remainingStock) throw new Error(`Solo quedan ${remainingStock} unidades disponibles.`);

    const currency: Currency = investment.currency === "$" ? "$" : "Bs";
    const unitCost = Number(investment.unitCost ?? investment.cost ?? 0);
    const unitSalePrice = Number(investment.unitSalePrice ?? investment.saleEstimate ?? 0);
    const recoveredCapital = Math.round(unitCost * quantity * 100) / 100;
    const netProfit = Math.round((unitSalePrice - unitCost) * quantity * 100) / 100;
    const nextStock = remainingStock - quantity;
    const transactionCollection = currency === "Bs" ? "transactions" : "dollarTransactions";
    const incomeField = currency === "Bs" ? "incomeBs" : "incomeUsd";
    const investmentCategory = currency === "Bs" ? "Inversión" : "Inversiones";
    const gainsCategory = "Ahorro";
    const description = `Venta de ${String(investment.title ?? "artículo")} - Unidades: ${quantity}`;
    const investmentIncomeRef = doc(collection(db, "distributions", distributionId, transactionCollection));
    const gainsIncomeRef = doc(collection(db, "distributions", distributionId, transactionCollection));

    if (!distributionSnapshot.exists()) {
      transaction.set(distributionRef, {
        name: "Distribución",
        userId: ownerId,
        month,
        year,
        isAutomatic: false,
        createdAt: serverTimestamp(),
      });
    }

    const transactionBase = {
      date,
      expenseBs: 0,
      expenseUsd: 0,
      source: "mythical-growth",
      sourceInvestmentId: investmentId,
      sourceSaleId: saleRef.id,
      createdAt: serverTimestamp(),
    };
    transaction.set(investmentIncomeRef, {
      ...transactionBase,
      category: investmentCategory,
      description: `${description} (capital recuperado)`,
      [incomeField]: recoveredCapital,
    });
    transaction.set(gainsIncomeRef, {
      ...transactionBase,
      category: gainsCategory,
      description: `${description} (ganancia neta)`,
      [incomeField]: netProfit,
    });
    transaction.update(investmentRef, {
      remainingStock: nextStock,
      soldUnits: totalUnits - nextStock,
      status: nextStock === 0 ? "liquidated" : "process",
      updatedAt: serverTimestamp(),
    });
    transaction.set(saleRef, {
      userId: ownerId,
      investmentId,
      quantity,
      currency,
      recoveredCapital,
      netProfit,
      date,
      createdAt: serverTimestamp(),
    });

    return { sold: quantity, recoveredCapital, netProfit, remainingStock: nextStock, date };
  });
}