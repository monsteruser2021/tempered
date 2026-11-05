import { getOutstandingDebt, type Currency, type Debt } from "@/lib/debt-payments";
import type { PlannedAssignment, PlannedIncome } from "@/lib/planner";

export type PlannerAlertThresholds = {
  caution: number;
  danger: number;
  critical: number;
};

export type PlannerAlertLevel = "caution" | "danger" | "critical";

export type NextIncomeAssessment = {
  income: PlannedIncome;
  committed: number;
  free: number;
  percentage: number;
  level: PlannerAlertLevel | null;
  hasMissingDebts: boolean;
};

export const DEFAULT_PLANNER_ALERT_THRESHOLDS: PlannerAlertThresholds = {
  caution: 20,
  danger: 35,
  critical: 50,
};

export const PLANNER_ALERT_THRESHOLDS_EVENT = "tempered:planner-alert-thresholds";

export function plannerAlertStorageKey(userId: string): string {
  return `tempered:planner-alert-thresholds:${userId}`;
}

export function isPlannerAlertThresholds(value: unknown): value is PlannerAlertThresholds {
  if (!value || typeof value !== "object") return false;
  const thresholds = value as Record<string, unknown>;
  return typeof thresholds.caution === "number"
    && typeof thresholds.danger === "number"
    && typeof thresholds.critical === "number"
    && Number.isInteger(thresholds.caution)
    && Number.isInteger(thresholds.danger)
    && Number.isInteger(thresholds.critical)
    && thresholds.caution >= 1
    && thresholds.critical <= 100
    && thresholds.caution < thresholds.danger
    && thresholds.danger < thresholds.critical;
}

export function readPlannerAlertThresholds(value: string | null): PlannerAlertThresholds {
  if (!value) return DEFAULT_PLANNER_ALERT_THRESHOLDS;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPlannerAlertThresholds(parsed) ? parsed : DEFAULT_PLANNER_ALERT_THRESHOLDS;
  } catch {
    return DEFAULT_PLANNER_ALERT_THRESHOLDS;
  }
}

function getAssignmentCommitment(
  assignment: PlannedAssignment,
  debtsById: ReadonlyMap<string, Debt>,
): { amount: number; missing: boolean } {
  if (assignment.type === "expense") return { amount: assignment.amount, missing: false };
  const debt = debtsById.get(assignment.debtId);
  return debt
    ? { amount: getOutstandingDebt(debt), missing: false }
    : { amount: 0, missing: true };
}

export function assessNextPlannedIncome(
  incomes: readonly PlannedIncome[],
  debts: readonly Debt[],
  today: string,
  thresholds: PlannerAlertThresholds,
): NextIncomeAssessment | null {
  const income = incomes
    .filter((item) => item.status === "pendiente" && item.estimatedDate >= today)
    .sort((first, second) => first.estimatedDate.localeCompare(second.estimatedDate))[0];
  if (!income) return null;

  const debtsById = new Map(debts.map((debt) => [debt.id, debt]));
  const commitments = income.assignments.map((assignment) => getAssignmentCommitment(assignment, debtsById));
  const committed = commitments.reduce((total, item) => total + item.amount, 0);
  const percentage = income.amount > 0 ? committed / income.amount * 100 : 0;
  const level: PlannerAlertLevel | null = percentage >= thresholds.critical
    ? "critical"
    : percentage >= thresholds.danger
      ? "danger"
      : percentage >= thresholds.caution
        ? "caution"
        : null;

  return {
    income,
    committed,
    free: income.amount - committed,
    percentage,
    level,
    hasMissingDebts: commitments.some((item) => item.missing),
  };
}

export function plannerAlertPresentation(level: PlannerAlertLevel) {
  if (level === "critical") {
    return {
      label: "Crítico",
      classes: "border-red-300/60 bg-red-950/85 text-red-50",
      accent: "text-red-200",
      message: "ALERTA CRÍTICA: tu próximo ingreso está peligrosamente comprometido. No agregues nuevas deudas ni gastos.",
    };
  }
  if (level === "danger") {
    return {
      label: "Peligro",
      classes: "border-orange-300/60 bg-orange-950/70 text-orange-50",
      accent: "text-orange-200",
      message: "Tu margen de maniobra está en riesgo. Pausa nuevos compromisos y revisa tus pagos.",
    };
  }
  return {
    label: "Precaución",
    classes: "border-amber-300/60 bg-amber-950/65 text-amber-50",
    accent: "text-amber-200",
    message: "Una parte importante del próximo ingreso ya tiene destino. Evalúa con cuidado antes de comprometer más dinero.",
  };
}

export function formatPlannerAlertMoney(value: number, currency: Currency): string {
  return `${currency} ${value.toFixed(2)}`;
}
