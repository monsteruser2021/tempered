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
  debtCategory,
  type Currency,
  type Debt,
} from "@/features/isorropia/services/debt-payments";
import {
  localDateString,
} from "@/shared/utils/date";

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

function allocateCents(totalCents: number, weightedCategories: { category: string; weight: number }[]) {
  const totalWeight = weightedCategories.reduce((sum, item) => sum + item.weight, 0);
  if (totalCents <= 0 || totalWeight <= 0 || weightedCategories.length === 0) return new Map<string, number>();

  const allocations = weightedCategories.map((item, index) => {
    const exact = totalCents * item.weight / totalWeight;
    const cents = Math.floor(exact);
    return { category: item.category, index, cents, remainder: exact - cents };
  });
  const remainingCents = totalCents - allocations.reduce((sum, item) => sum + item.cents, 0);
  [...allocations]
    .sort((first, second) => second.remainder - first.remainder || first.index - second.index)
    .slice(0, remainingCents)
    .forEach((item) => { allocations[item.index].cents += 1; });

  return new Map(allocations.map((item) => [item.category, item.cents]));
}

function suggestDraftAllocation(amount: number, currency: Currency, balances: Record<string, number>) {
  const categories = PLANNER_CATEGORIES[currency];
  const totalCents = Math.round(amount * 100);
  const deficits = categories
    .map((category) => ({
      category,
      cents: Math.ceil(Math.max(0, -(balances[category] ?? 0)) * 100 - 1e-8),
    }))
    .filter((item) => item.cents > 0);
  const deficitCents = deficits.reduce((sum, item) => sum + item.cents, 0);
  const allocations = new Map(categories.map((category) => [category, 0]));

  if (deficitCents > totalCents) {
    const deficitAllocation = allocateCents(totalCents, deficits.map((item) => ({
      category: item.category,
      weight: item.cents,
    })));
    deficitAllocation.forEach((value, category) => allocations.set(category, value));
  } else {
    deficits.forEach((item) => allocations.set(item.category, item.cents));
    const remainingCents = totalCents - deficitCents;
    const recipients = categories.filter((category) => !deficits.some((item) => item.category === category));
    const weightedRecipients = recipients.map((category) => ({
      category,
      weight: Math.max(0, balances[category] ?? 0),
    }));
    const positiveRecipients = weightedRecipients.filter((item) => item.weight > 0);
    const recipientsToUse = recipients.length > 0 ? recipients : categories;
    const weights = positiveRecipients.length > 0
      ? positiveRecipients
      : recipientsToUse.map((category) => ({ category, weight: 1 }));
    allocateCents(remainingCents, weights).forEach((value, category) => {
      allocations.set(category, (allocations.get(category) ?? 0) + value);
    });
  }

  const percentages = Object.fromEntries(categories.map((category) => [
    category,
    Number(((allocations.get(category) ?? 0) / totalCents * 100).toFixed(6)),
  ]));
  const percentageTotal = Object.values(percentages).reduce((sum, percentage) => sum + percentage, 0);
  const adjustmentCategory = [...categories].reverse().find((category) => (allocations.get(category) ?? 0) > 0) ?? categories[categories.length - 1];
  percentages[adjustmentCategory] = Number((percentages[adjustmentCategory] + 100 - percentageTotal).toFixed(6));

  const negativeBalances = Object.fromEntries(categories
    .filter((category) => (balances[category] ?? 0) < -0.005)
    .map((category) => [category, balances[category]]));

  return { percentages, negativeBalances };
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
  const currencyValue: unknown = incomeData.currency;
  if (!isCurrency(currencyValue)) throw new Error("El ingreso tiene una moneda no válida.");
  const incomeCurrency = currencyValue;
  const amount = Number(incomeData.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("El ingreso tiene un monto no válido.");
  const assignments = readPlannedAssignments(incomeData);
  if (!assignments) throw new Error("La lista de asignaciones no es válida.");
  const normalizedAssignments = normalizeAssignments(assignments);
  if (normalizedAssignments.some((item) => item.type === "expense" && item.currency !== incomeCurrency)) {
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
    if (debt.currency !== incomeCurrency) {
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
  const repartos = await getDocs(query(collection(db, "distributions"), where("userId", "==", ownerId)));
  const currentRepartos = repartos.docs.filter((item) => (
    Number(item.data().month) === month - 1 && Number(item.data().year) === year
  ));
  const currentReparto = currentRepartos.find((item) => item.data().isAutomatic !== true)
    ?? currentRepartos[0];
  if (!currentReparto) {
    throw new Error("No existe un reparto de fondos para el mes actual; créalo antes de ejecutar el plan.");
  }
  const repartoRef = doc(db, "distributions", currentReparto.id);
  const draftRef = doc(collection(db, "plannedIncomeDrafts"));
  const incomeDebtIds = normalizedAssignments.flatMap((item) => item.type === "debt" ? [item.debtId] : []);
  const debtRefs = incomeDebtIds.map((id) => doc(db, "debts", id));
  const plannedExpenseAssignments = expenses;
  const balanceCollectionSnapshots = incomeCurrency === "Bs"
    ? await Promise.all([
      getDocs(query(collection(db, "distributions", currentReparto.id, "incomes"))),
      getDocs(query(collection(db, "distributions", currentReparto.id, "transactions"))),
    ])
    : [await getDocs(query(collection(db, "distributions", currentReparto.id, "dollarTransactions")))];
  const incomeReferenceCount = incomeCurrency === "Bs" ? balanceCollectionSnapshots[0].docs.length : 0;
  const balanceReferences = balanceCollectionSnapshots.flatMap((snapshot) => snapshot.docs.map((item) => item.ref));

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
      || currentIncome.currency !== incomeCurrency
      || currentIncome.estimatedDate !== incomeData.estimatedDate
      || JSON.stringify(currentAssignments) !== JSON.stringify(assignments)
    ) {
      throw new Error("El plan cambió durante la ejecución. Revisa sus compromisos e inténtalo de nuevo.");
    }

    const repartoSnapshot = await transaction.get(repartoRef);
    if (
      !repartoSnapshot.exists()
      || repartoSnapshot.data().userId !== ownerId
      || Number(repartoSnapshot.data().month) !== month - 1
      || Number(repartoSnapshot.data().year) !== year
    ) {
      throw new Error("El reparto de fondos del mes actual ya no está disponible. Actualiza la página e inténtalo de nuevo.");
    }

    const debtSnapshots = await Promise.all(debtRefs.map((reference) => transaction.get(reference)));
    const balanceReads = await Promise.all(balanceReferences.map((reference) => transaction.get(reference)));
    const transactionDebts = debtSnapshots.map((snapshot, index) => {
      const debtId = incomeDebtIds[index];
      if (!snapshot.exists() || snapshot.data().userId !== ownerId) {
        throw new Error("Una de las deudas asignadas ya no existe o no está disponible.");
      }
      return readDebt(debtId, ownerId, snapshot.data());
    });
    const payments = transactionDebts.flatMap((debt) => {
      if (debt.currency !== incomeCurrency) {
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

    const categories = PLANNER_CATEGORIES[incomeCurrency];
    const balances = Object.fromEntries(categories.map((category) => [category, 0])) as Record<string, number>;
    if (incomeCurrency === "Bs") {
      balanceReads.slice(0, incomeReferenceCount).forEach((item) => {
        if (!item.exists()) return;
        const data = item.data();
        if (data.status === "draft") return;
        const totalBs = Number(data.totalBs ?? 0);
        const percentages = data.percentages && typeof data.percentages === "object"
          ? data.percentages as Record<string, unknown>
          : {};
        categories.forEach((category) => {
          balances[category] += totalBs * Number(percentages[category] ?? 0) / 100;
        });
      });
      balanceReads.slice(incomeReferenceCount).forEach((item) => {
        if (!item.exists()) return;
        const data = item.data();
        if (typeof data.category === "string" && data.category in balances) {
          balances[data.category] += Number(data.incomeBs ?? 0) - Number(data.expenseBs ?? 0);
        }
      });
    } else {
      balanceReads.forEach((item) => {
        if (!item.exists()) return;
        const data = item.data();
        if (typeof data.category === "string" && data.category in balances) {
          balances[data.category] += Number(data.incomeUsd ?? 0) - Number(data.expenseUsd ?? 0);
        }
      });
    }

    payments.forEach(({ debt, amount: paymentAmount }) => {
      const category = debtCategory(debt.currency);
      if (category in balances) balances[category] += debt.type === "receivable" ? paymentAmount : -paymentAmount;
    });
    plannedExpenseAssignments.forEach((expense) => {
      balances[expense.category] -= expense.amount;
    });
    const { percentages, negativeBalances } = suggestDraftAllocation(amount, incomeCurrency, balances);

    const paymentMovementRefs = payments.map(({ debt }) => {
      const balanceCollection = debt.currency === "Bs" ? "transactions" : "dollarTransactions";
      return doc(collection(db, "distributions", currentReparto.id, balanceCollection));
    });
    const expenseMovementRefs = plannedExpenseAssignments.map((expense) => {
      const balanceCollection = expense.currency === "Bs" ? "transactions" : "dollarTransactions";
      return doc(collection(db, "distributions", currentReparto!.id, balanceCollection));
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
            distributionId: currentReparto.id,
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

    transaction.set(draftRef, {
      userId: ownerId,
      repartoId: currentReparto.id,
      plannedIncomeId: incomeId,
      description: incomeData.title,
      amount,
      currency: incomeCurrency,
      date: incomeData.estimatedDate,
      status: "draft",
      suggestedPercentages: percentages,
      negativeBalances,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.update(incomeRef, {
      status: "ejecutado",
      executedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

function isValidDate(value: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!dateMatch) return false;
  const date = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
  return date.getUTCFullYear() === Number(dateMatch[1])
    && date.getUTCMonth() === Number(dateMatch[2]) - 1
    && date.getUTCDate() === Number(dateMatch[3]);
}

function normalizeDraftPercentages(currency: Currency, values: Record<string, number>) {
  const categories = PLANNER_CATEGORIES[currency];
  if (Object.keys(values).some((category) => !categories.includes(category))) {
    throw new Error("El reparto incluye una categoría que no corresponde a esta moneda.");
  }
  const percentages = Object.fromEntries(categories.map((category) => {
    const value = Number(values[category] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`El porcentaje de "${category}" debe estar entre 0 y 100.`);
    }
    return [category, value];
  }));
  const total = Object.values(percentages).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 100) > 0.0001) {
    throw new Error(`Los porcentajes deben sumar 100%. Actualmente suman ${total.toFixed(4)}%.`);
  }
  return percentages;
}

export async function approvePlannedIncomeDraft(
  userId: string,
  draftId: string,
  input: { percentages: Record<string, number> },
): Promise<void> {
  const ownerId = userId.trim();
  if (!ownerId) throw new Error("Debes iniciar sesión para aprobar el reparto.");
  const draftRef = doc(db, "plannedIncomeDrafts", draftId);

  await runTransaction(db, async (transaction) => {
    const draftSnapshot = await transaction.get(draftRef);
    if (!draftSnapshot.exists() || draftSnapshot.data().userId !== ownerId) {
      throw new Error("El borrador ya no existe o no está disponible.");
    }
    const draft = draftSnapshot.data();
    if (draft.status !== "draft") throw new Error("Este borrador ya fue aprobado.");
    if (
      typeof draft.repartoId !== "string"
      || typeof draft.description !== "string"
      || typeof draft.amount !== "number"
      || !Number.isFinite(draft.amount)
      || draft.amount <= 0
      || !isCurrency(draft.currency)
      || typeof draft.date !== "string"
      || !isValidDate(draft.date)
    ) {
      throw new Error("El borrador tiene datos incompletos y no se puede aprobar.");
    }
    const percentages = normalizeDraftPercentages(draft.currency, input.percentages);
    const repartoRef = doc(db, "distributions", draft.repartoId);
    const repartoSnapshot = await transaction.get(repartoRef);
    if (!repartoSnapshot.exists() || repartoSnapshot.data().userId !== ownerId) {
      throw new Error("El reparto asociado al borrador ya no está disponible.");
    }

    if (draft.currency === "Bs") {
      const incomeRef = doc(collection(db, "distributions", draft.repartoId, "incomes"));
      transaction.set(incomeRef, {
        description: draft.description,
        totalBs: draft.amount,
        percentages,
        date: draft.date,
        sourceDraftId: draftId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transaction.update(draftRef, {
        status: "approved",
        allocationPercentages: percentages,
        approvedIncomeId: incomeRef.id,
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const allocations = allocateCents(
      Math.round(draft.amount * 100),
      PLANNER_CATEGORIES[draft.currency]
        .map((category) => ({ category, weight: percentages[category] }))
        .filter((item) => item.weight > 0),
    );
    const transactionIds: string[] = [];
    allocations.forEach((cents, category) => {
      if (cents <= 0) return;
      const movementRef = doc(collection(db, "distributions", draft.repartoId, "dollarTransactions"));
      transaction.set(movementRef, {
        category,
        date: draft.date,
        description: `${draft.description} (${percentages[category]}%)`,
        incomeUsd: cents / 100,
        expenseUsd: 0,
        isPlannedIncome: true,
        plannedIncomeDraftId: draftId,
        allocationPercentage: percentages[category],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transactionIds.push(movementRef.id);
    });
    transaction.update(draftRef, {
      status: "approved",
      allocationPercentages: percentages,
      approvedTransactionIds: transactionIds,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}
