import {
  addDoc,
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
import {
  getBalanceTransactions,
  getOutstandingDebt,
  getPaidAmount,
  type Currency,
  type Debt,
} from "@/lib/debt-payments";
import {
  localDateString,
} from "@/app/components/task-data";

export const PLANNER_CATEGORIES: Record<Currency, readonly string[]> = {
  Bs: [
    "Gastos básicos",
    "Fondo de emergencia",
    "Inversión",
    "Ahorro",
    "Transporte",
    "Caridad",
    "Lujo/gustos",
    "Otros gastos",
  ],
  "$": ["Inversiones", "Ahorro", "Fondo de emergencia"],
};

export type PlannedDebtAssignment = { type: "debt"; debtId: string };
export type PlannedExpenseAssignment = {
  type: "expense";
  title: string;
  category: string;
  amount: number;
  currency: Currency;
};
export type PlannedAssignment = PlannedDebtAssignment | PlannedExpenseAssignment;

export type PlannedIncomeStatus = "pendiente" | "ejecutado";

export type PlannedIncome = {
  id: string;
  userId: string;
  title: string;
  amount: number;
  currency: Currency;
  estimatedDate: string;
  status: PlannedIncomeStatus;
  assignments: PlannedAssignment[];
  assignedDebts?: string[];
};

export type PlannedIncomeInput = Pick<
  PlannedIncome,
  "title" | "amount" | "currency" | "estimatedDate" | "assignments"
>;

function isCurrency(value: unknown): value is Currency {
  return value === "Bs" || value === "$";
}

function normalizeAssignments(input: PlannedIncomeInput["assignments"]): PlannedAssignment[] {
  if (!Array.isArray(input) || input.length > 100) {
    throw new Error("Un plan puede tener hasta 100 asignaciones.");
  }
  const debtIds = new Set<string>();
  return input.map((assignment) => {
    if (!assignment || typeof assignment !== "object") {
      throw new Error("El formato de una asignación no es válido.");
    }
    if (assignment.type === "debt") {
      if (typeof assignment.debtId !== "string" || !assignment.debtId || debtIds.has(assignment.debtId)) {
        throw new Error("Cada deuda solo puede asignarse una vez al mismo ingreso.");
      }
      debtIds.add(assignment.debtId);
      return { type: "debt", debtId: assignment.debtId };
    }

    if (assignment.type !== "expense") throw new Error("El tipo de asignación no es válido.");
    if (
      typeof assignment.title !== "string"
      || typeof assignment.amount !== "number"
      || typeof assignment.category !== "string"
    ) {
      throw new Error("Los datos del gasto no son válidos.");
    }
    const title = assignment.title.trim();
    const amount = Math.round(assignment.amount * 100) / 100;
    if (!title || title.length > 120) throw new Error("Cada gasto debe tener un título de hasta 120 caracteres.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Cada gasto debe ser mayor que cero.");
    if (!isCurrency(assignment.currency)) throw new Error("Selecciona una moneda válida para el gasto.");
    if (!PLANNER_CATEGORIES[assignment.currency].includes(assignment.category)) {
      throw new Error(`La categoría "${assignment.category}" no existe en el balance de ${assignment.currency}.`);
    }
    return {
      type: "expense",
      title,
      category: assignment.category,
      amount,
      currency: assignment.currency,
    };
  });
}

export function readPlannedAssignments(data: Record<string, unknown>): PlannedAssignment[] | null {
  let assignments: PlannedAssignment[];
  if (Array.isArray(data.assignments)) {
    assignments = data.assignments as PlannedAssignment[];
  } else if (Array.isArray(data.assignedDebts) && data.assignedDebts.every((id) => typeof id === "string")) {
    assignments = data.assignedDebts.map((debtId) => ({ type: "debt", debtId }));
  } else {
    return null;
  }
  try {
    return normalizeAssignments(assignments);
  } catch {
    return null;
  }
}

function validateInput(input: PlannedIncomeInput): PlannedIncomeInput {
  const title = input.title.trim();
  const amount = Math.round(input.amount * 100) / 100;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.estimatedDate);
  if (!title || title.length > 120) throw new Error("Indica un título de hasta 120 caracteres.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("El ingreso debe ser mayor que cero.");
  if (!isCurrency(input.currency)) throw new Error("Selecciona una moneda válida.");
  if (!dateMatch) throw new Error("Indica una fecha estimada válida.");
  const date = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
  if (
    date.getUTCFullYear() !== Number(dateMatch[1])
    || date.getUTCMonth() !== Number(dateMatch[2]) - 1
    || date.getUTCDate() !== Number(dateMatch[3])
  ) {
    throw new Error("Indica una fecha estimada válida.");
  }
  const assignments = normalizeAssignments(input.assignments);
  if (assignments.some((item) => item.type === "expense" && item.currency !== input.currency)) {
    throw new Error("Los gastos deben usar la misma moneda que el ingreso proyectado.");
  }

  return { title, amount, currency: input.currency, estimatedDate: input.estimatedDate, assignments };
}

export async function savePlannedIncome(
  userId: string,
  input: PlannedIncomeInput,
  incomeId?: string,
): Promise<void> {
  const ownerId = userId.trim();
  if (!ownerId) throw new Error("Debes iniciar sesión para guardar el ingreso.");
  const data = validateInput(input);
  const assignedDebtIds = data.assignments
    .filter((item): item is PlannedDebtAssignment => item.type === "debt")
    .map((item) => item.debtId);
  if (assignedDebtIds.length > 0) {
    const debts = await getDocs(query(collection(db, "debts"), where("userId", "==", ownerId)));
    const ownedDebts = new Map(debts.docs.map((item) => [item.id, item.data()]));
    for (const debtId of assignedDebtIds) {
      const debt = ownedDebts.get(debtId);
      if (!debt) throw new Error("Una de las deudas asignadas ya no existe o no está disponible.");
      if (debt.currency !== data.currency) {
        throw new Error("Todas las deudas asignadas deben usar la misma moneda del ingreso.");
      }
    }

    const incomes = await getDocs(query(collection(db, "plannedIncomes"), where("userId", "==", ownerId)));
    const reservedDebtIds = new Set(incomes.docs
      .filter((item) => item.id !== incomeId && item.data().status === "pendiente")
      .flatMap((item) => {
        const assignments = readPlannedAssignments(item.data()) ?? [];
        return assignments.flatMap((assignment) => assignment.type === "debt" ? [assignment.debtId] : []);
      }));
    if (assignedDebtIds.some((debtId) => reservedDebtIds.has(debtId))) {
      throw new Error("Una deuda ya está asignada a otro ingreso pendiente. Reasígnala en un solo plan para evitar duplicar compromisos.");
    }
  }

  if (incomeId) {
    const incomeRef = doc(db, "plannedIncomes", incomeId);
    await runTransaction(db, async (transaction) => {
      const incomeSnapshot = await transaction.get(incomeRef);
      if (!incomeSnapshot.exists() || incomeSnapshot.data().userId !== ownerId) {
        throw new Error("El ingreso ya no existe o no está disponible.");
      }
      if (incomeSnapshot.data().status !== "pendiente") {
        throw new Error("Solo puedes editar ingresos que aún estén pendientes.");
      }
      transaction.update(incomeRef, {
        ...data,
        assignedDebts: deleteField(),
        updatedAt: serverTimestamp(),
      });
    });
    return;
  }

  await addDoc(collection(db, "plannedIncomes"), {
    ...data,
    userId: ownerId,
    status: "pendiente",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function removePlannedIncome(userId: string, incomeId: string): Promise<void> {
  const ownerId = userId.trim();
  if (!ownerId) throw new Error("Debes iniciar sesión para eliminar el ingreso.");
  const incomeRef = doc(db, "plannedIncomes", incomeId);
  await runTransaction(db, async (transaction) => {
    const incomeSnapshot = await transaction.get(incomeRef);
    if (!incomeSnapshot.exists() || incomeSnapshot.data().userId !== ownerId) {
      throw new Error("El ingreso ya no existe o no está disponible.");
    }
    if (incomeSnapshot.data().status !== "pendiente") {
      throw new Error("Solo puedes eliminar ingresos que aún estén pendientes.");
    }
    transaction.delete(incomeRef);
  });
}

function readDebt(id: string, userId: string, data: Record<string, unknown>): Debt {
  const amount = Number(data.amount);
  if (
    typeof data.title !== "string"
    || (data.type !== "payable" && data.type !== "receivable")
    || !Number.isFinite(amount)
    || amount <= 0
    || !isCurrency(data.currency)
    || typeof data.dueDate !== "string"
  ) {
    throw new Error(`La deuda ${id} tiene datos incompletos y no se puede ejecutar.`);
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

export async function executePlannedIncome(userId: string, incomeId: string): Promise<void> {
  const ownerId = userId.trim();
  if (!ownerId) throw new Error("Debes iniciar sesión para ejecutar el plan.");

  const incomeRef = doc(db, "plannedIncomes", incomeId);
  const incomesSnapshot = await getDocs(query(
    collection(db, "plannedIncomes"),
    where("userId", "==", ownerId),
  ));
  const incomeData = incomesSnapshot.docs.find((item) => item.id === incomeId)?.data();
  if (!incomeData || incomeData.userId !== ownerId) {
    throw new Error("El ingreso ya no existe o no está disponible.");
  }
  if (incomeData.status !== "pendiente") throw new Error("Este plan ya fue ejecutado.");
  if (!isCurrency(incomeData.currency)) throw new Error("El ingreso tiene una moneda no válida.");
  const amount = Number(incomeData.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("El ingreso tiene un monto no válido.");
  const assignments = readPlannedAssignments(incomeData);
  if (!assignments) throw new Error("La lista de asignaciones no es válida.");
  const normalizedAssignments = normalizeAssignments(assignments);
  if (normalizedAssignments.some((item) => item.type === "expense" && item.currency !== incomeData.currency)) {
    throw new Error("Los gastos deben usar la misma moneda que el ingreso proyectado.");
  }
  const debtIds = normalizedAssignments
    .filter((item): item is PlannedDebtAssignment => item.type === "debt")
    .map((item) => item.debtId);
  const debtsSnapshot = debtIds.length > 0
    ? await getDocs(query(collection(db, "debts"), where("userId", "==", ownerId)))
    : null;
  const debts = new Map((debtsSnapshot?.docs ?? []).map((item) => [
    item.id,
    readDebt(item.id, ownerId, item.data()),
  ]));
  const selectedDebts = debtIds.map((id) => {
    const debt = debts.get(id);
    if (!debt) throw new Error("Una de las deudas asignadas ya no existe o no está disponible.");
    if (debt.currency !== incomeData.currency) {
      throw new Error(`La deuda "${debt.title}" no tiene la misma moneda que el ingreso.`);
    }
    return debt;
  });
  const expenses = normalizedAssignments.filter(
    (item): item is PlannedExpenseAssignment => item.type === "expense",
  );
  const committedAmount = selectedDebts.reduce((total, debt) => total + getOutstandingDebt(debt), 0)
    + expenses.reduce((total, expense) => total + expense.amount, 0);
  if (committedAmount > amount + 0.005) {
    throw new Error("Los compromisos pendientes superan el monto del ingreso.");
  }

  const today = localDateString();
  const [year, month] = today.split("-").map(Number);
  const distributions = await getDocs(query(collection(db, "distributions"), where("userId", "==", ownerId)));
  const currentDistributions = distributions.docs.filter((item) => (
    Number(item.data().month) === month - 1 && Number(item.data().year) === year
  ));
  const currentDistribution = currentDistributions.find((item) => item.data().isAutomatic !== true)
    ?? currentDistributions[0];
  const incomeDebtIds = normalizedAssignments.flatMap((item) => item.type === "debt" ? [item.debtId] : []);
  const debtRefs = incomeDebtIds.map((id) => doc(db, "debts", id));
  const plannedExpenseAssignments = expenses;

  await runTransaction(db, async (transaction) => {
    const currentIncomeSnapshot = await transaction.get(incomeRef);
    if (!currentIncomeSnapshot.exists() || currentIncomeSnapshot.data().userId !== ownerId) {
      throw new Error("El ingreso ya no existe o no está disponible.");
    }
    const currentIncome = currentIncomeSnapshot.data();
    const currentAssignments = readPlannedAssignments(currentIncome);
    if (
      currentIncome.status !== "pendiente"
      || currentIncome.title !== incomeData.title
      || currentIncome.amount !== incomeData.amount
      || currentIncome.currency !== incomeData.currency
      || currentIncome.estimatedDate !== incomeData.estimatedDate
      || JSON.stringify(currentAssignments) !== JSON.stringify(assignments)
    ) {
      throw new Error("El plan cambió durante la ejecución. Revisa sus compromisos e inténtalo de nuevo.");
    }

    const debtSnapshots = await Promise.all(debtRefs.map((reference) => transaction.get(reference)));
    const transactionDebts = debtSnapshots.map((snapshot, index) => {
      const debtId = incomeDebtIds[index];
      if (!snapshot.exists() || snapshot.data().userId !== ownerId) {
        throw new Error("Una de las deudas asignadas ya no existe o no está disponible.");
      }
      return readDebt(debtId, ownerId, snapshot.data());
    });
    const payments = transactionDebts.flatMap((debt) => {
      if (debt.currency !== incomeData.currency) {
        throw new Error(`La deuda "${debt.title}" no tiene la misma moneda que el ingreso.`);
      }
      const paymentAmount = Math.round(getOutstandingDebt(debt) * 100) / 100;
      return paymentAmount > 0 ? [{ debt, amount: paymentAmount }] : [];
    });
    const transactionCommitment = payments.reduce((total, payment) => total + payment.amount, 0)
      + plannedExpenseAssignments.reduce((total, expense) => total + expense.amount, 0);
    if (transactionCommitment > amount + 0.005) {
      throw new Error("Los compromisos pendientes superan el monto del ingreso.");
    }

    const requiresDistribution = payments.length > 0 || plannedExpenseAssignments.length > 0;
    if (requiresDistribution && !currentDistribution) {
      throw new Error("No existe una distribución para el mes actual; créala antes de ejecutar el plan.");
    }
    const distributionRef = currentDistribution ? doc(db, "distributions", currentDistribution.id) : null;
    const distributionSnapshot = distributionRef ? await transaction.get(distributionRef) : null;
    const distribution = distributionSnapshot?.data();
    if (
      requiresDistribution
      && (
        !distributionSnapshot?.exists()
        || distribution?.userId !== ownerId
        || Number(distribution.month) !== month - 1
        || Number(distribution.year) !== year
      )
    ) {
      throw new Error("La distribución del mes actual ya no está disponible. Actualiza la página e inténtalo de nuevo.");
    }

    const paymentMovementRefs = payments.map(({ debt }) => {
      const balanceCollection = debt.currency === "Bs" ? "transactions" : "dollarTransactions";
      return doc(collection(db, "distributions", currentDistribution!.id, balanceCollection));
    });
    const expenseMovementRefs = plannedExpenseAssignments.map((expense) => {
      const balanceCollection = expense.currency === "Bs" ? "transactions" : "dollarTransactions";
      return doc(collection(db, "distributions", currentDistribution!.id, balanceCollection));
    });

    payments.forEach(({ debt, amount: paymentAmount }, index) => {
      const movementType = debt.type === "payable" ? "payment" : "collection";
      const isIncome = debt.type === "receivable";
      const description = isIncome
        ? `Cobro recuperado de deuda: ${debt.title}`
        : `Pago de deuda: ${debt.title}`;
      const movement = debt.currency === "Bs"
        ? { category: "Otros gastos", date: today, description, incomeBs: isIncome ? paymentAmount : 0, expenseBs: isIncome ? 0 : paymentAmount }
        : { category: "Ahorro", date: today, description, incomeUsd: isIncome ? paymentAmount : 0, expenseUsd: isIncome ? 0 : paymentAmount };
      transaction.set(paymentMovementRefs[index], {
        ...movement,
        isDebtPayment: movementType === "payment",
        isDebtCollection: movementType === "collection",
        debtMovementType: movementType,
        debtId: debt.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const nextPaidAmount = Math.min(debt.amount, debt.paidAmount + paymentAmount);
      transaction.update(doc(db, "debts", debt.id), {
        paid: nextPaidAmount >= debt.amount - 0.005,
        paidAmount: nextPaidAmount,
        balanceTransactions: [
          ...debt.balanceTransactions,
          {
            distributionId: currentDistribution!.id,
            transactionId: paymentMovementRefs[index].id,
          },
        ],
        updatedAt: serverTimestamp(),
      });
    });

    plannedExpenseAssignments.forEach((expense, index) => {
      const movement = expense.currency === "Bs"
        ? { expenseBs: expense.amount, incomeBs: 0 }
        : { expenseUsd: expense.amount, incomeUsd: 0 };
      transaction.set(expenseMovementRefs[index], {
        ...movement,
        category: expense.category,
        date: today,
        description: expense.title,
        isPlannedExpense: true,
        plannedIncomeId: incomeId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    transaction.update(incomeRef, {
      status: "ejecutado",
      executedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}
