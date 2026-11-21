import {
  collection,
  count,
  deleteDoc,
  deleteField,
  doc,
  DocumentData,
  getAggregateFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  QueryConstraint,
  QueryDocumentSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  sum,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { NewRoutine, Routine, RoutineDay, WorkoutMetrics, WorkoutSession } from "../types/mawina.types";

const ROUTINES_COLLECTION = "mawinaRoutines";
const SESSIONS_COLLECTION = "mawinaWorkoutSessions";
const WORKOUT_HISTORY_PAGE_SIZE = 10;
const STREAK_QUERY_PAGE_SIZE = 100;

export interface WorkoutHistoryPage {
  sessions: WorkoutSession[];
  nextCursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date(0);
}

function toRoutineDay(value: unknown, index: number): RoutineDay {
  const day = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    id: typeof day.id === "string" ? day.id : `day-${index + 1}`,
    dayNumber: typeof day.dayNumber === "number" ? day.dayNumber : index + 1,
    title: typeof day.title === "string" ? day.title : `Día ${index + 1}`,
    isRestDay: day.isRestDay === true,
    exercises: Array.isArray(day.exercises) ? day.exercises as RoutineDay["exercises"] : [],
  };
}

function toRoutine(id: string, data: Record<string, unknown>): Routine {
  const scheduleType = data.scheduleType === "fixed_days" ? "fixed_days" : "cycle";
  return {
    id,
    userId: String(data.userId ?? ""),
    name: String(data.name ?? data.title ?? "Rutina sin nombre"),
    description: String(data.description ?? ""),
    category: data.category === "habit" ? "habit" : "fitness",
    scheduleType,
    activeDaysCount: Math.max(0, Number(data.activeDaysCount ?? 0)),
    restDaysCount: Math.max(0, Number(data.restDaysCount ?? 0)),
    currentCycleIndex: Math.max(0, Number(data.currentCycleIndex ?? 0)),
    isActive: data.isActive !== false,
    createdAt: toDate(data.createdAt),
    days: Array.isArray(data.days) ? data.days.map(toRoutineDay) : [],
    fixedDays: Array.isArray(data.fixedDays) ? data.fixedDays.map(Number).filter(Number.isInteger) : undefined,
  };
}

function toWorkoutSession(id: string, data: Record<string, unknown>): WorkoutSession {
  return {
    id,
    userId: String(data.userId ?? ""),
    routineId: String(data.routineId ?? ""),
    routineName: String(data.routineName ?? ""),
    dayTitle: String(data.dayTitle ?? ""),
    date: toDate(data.date),
    durationSeconds: Math.max(0, Number(data.durationSeconds ?? 0)),
    completedExercises: Array.isArray(data.completedExercises)
      ? data.completedExercises as WorkoutSession["completedExercises"]
      : [],
  };
}

export async function getUserRoutines(userId: string): Promise<Routine[]> {
  const routinesQuery = query(collection(db, ROUTINES_COLLECTION), where("userId", "==", userId));
  const snapshot = await getDocs(routinesQuery);
  return snapshot.docs
    .map((item) => toRoutine(item.id, item.data()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function createRoutine(routine: NewRoutine): Promise<Routine> {
  const routineRef = doc(collection(db, ROUTINES_COLLECTION));
  const createdAt = new Date();
  await setDoc(routineRef, {
    ...routine,
    createdAt: serverTimestamp(),
  });
  return { ...routine, id: routineRef.id, createdAt };
}

export async function updateRoutine(
  userId: string,
  routineId: string,
  updates: Partial<Pick<Routine, "currentCycleIndex" | "isActive" | "name" | "description" | "category" | "scheduleType" | "activeDaysCount" | "restDaysCount" | "days" | "fixedDays">>,
): Promise<void> {
  const routineRef = doc(db, ROUTINES_COLLECTION, routineId);
  const snapshot = await getDoc(routineRef);
  if (!snapshot.exists() || snapshot.data().userId !== userId) {
    throw new Error("No se encontró una rutina propia para actualizar.");
  }
  const updateData: Record<string, unknown> = { ...updates };
  if (updates.days) {
    const currentIndex = Math.max(0, Number(snapshot.data().currentCycleIndex ?? 0) || 0);
    updateData.currentCycleIndex = updates.days.length > 0 ? currentIndex % updates.days.length : 0;
  }
  if (updates.scheduleType === "cycle") updateData.fixedDays = deleteField();
  await updateDoc(routineRef, updateData);
}

export async function setRoutineActive(
  userId: string,
  routineId: string,
  isActive: boolean,
): Promise<void> {
  const routinesQuery = query(collection(db, ROUTINES_COLLECTION), where("userId", "==", userId));
  const snapshot = await getDocs(routinesQuery);
  const selectedRoutine = snapshot.docs.find((item) => item.id === routineId);
  if (!selectedRoutine) {
    throw new Error("No se encontró una rutina propia para actualizar.");
  }

  const batch = writeBatch(db);
  if (!isActive) {
    batch.update(selectedRoutine.ref, { isActive: false });
  } else {
    snapshot.docs.forEach((item) => {
      batch.update(item.ref, {
        isActive: item.id === routineId,
        ...(item.id === routineId ? { currentCycleIndex: 0 } : {}),
      });
    });
  }
  await batch.commit();
}

export async function deleteRoutine(userId: string, routineId: string): Promise<void> {
  const routineRef = doc(db, ROUTINES_COLLECTION, routineId);
  const snapshot = await getDoc(routineRef);
  if (!snapshot.exists() || snapshot.data().userId !== userId) {
    throw new Error("No se encontró una rutina propia para eliminar.");
  }
  await deleteDoc(routineRef);
}

export async function setRoutineCycleIndex(
  userId: string,
  routineId: string,
  cycleIndex: number,
): Promise<void> {
  if (!Number.isInteger(cycleIndex) || cycleIndex < 0) {
    throw new Error("El día seleccionado del ciclo no es válido.");
  }
  const routineRef = doc(db, ROUTINES_COLLECTION, routineId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(routineRef);
    if (!snapshot.exists() || snapshot.data().userId !== userId) {
      throw new Error("No se encontró una rutina propia para ajustar.");
    }
    const days = Array.isArray(snapshot.data().days) ? snapshot.data().days : [];
    if (days.length === 0) throw new Error("La rutina no tiene días configurados.");
    transaction.update(routineRef, { currentCycleIndex: cycleIndex % days.length });
  });
}

export async function advanceRoutineCycle(userId: string, routineId: string): Promise<void> {
  const routineRef = doc(db, ROUTINES_COLLECTION, routineId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(routineRef);
    if (!snapshot.exists() || snapshot.data().userId !== userId) {
      throw new Error("No se encontró una rutina propia para avanzar.");
    }
    const routine = snapshot.data();
    const days = Array.isArray(routine.days) ? routine.days : [];
    if (days.length === 0) throw new Error("La rutina no tiene días configurados.");
    const currentIndex = Math.max(0, Number(routine.currentCycleIndex ?? 0) || 0);
    transaction.update(routineRef, { currentCycleIndex: (currentIndex + 1) % days.length });
  });
}

export async function getWorkoutHistoryPage(
  userId: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null = null,
): Promise<WorkoutHistoryPage> {
  const constraints: QueryConstraint[] = [
    where("userId", "==", userId),
    orderBy("date", "desc"),
  ];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(WORKOUT_HISTORY_PAGE_SIZE + 1));

  const snapshot = await getDocs(query(collection(db, SESSIONS_COLLECTION), ...constraints));
  const pageDocuments = snapshot.docs.slice(0, WORKOUT_HISTORY_PAGE_SIZE);
  return {
    sessions: pageDocuments.map((item) => toWorkoutSession(item.id, item.data())),
    nextCursor: pageDocuments.at(-1) ?? null,
    hasMore: snapshot.docs.length > WORKOUT_HISTORY_PAGE_SIZE,
  };
}

function calendarDayOrdinal(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

async function getCurrentWorkoutStreak(userId: string): Promise<number> {
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  const todayOrdinal = calendarDayOrdinal(new Date());
  let expectedOrdinal: number | null = null;
  let lastCountedOrdinal: number | null = null;
  let streakDays = 0;

  while (true) {
    const constraints: QueryConstraint[] = [
      where("userId", "==", userId),
      orderBy("date", "desc"),
    ];
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(STREAK_QUERY_PAGE_SIZE));

    const snapshot = await getDocs(query(collection(db, SESSIONS_COLLECTION), ...constraints));
    for (const item of snapshot.docs) {
      const sessionOrdinal = calendarDayOrdinal(toDate(item.data().date));
      if (sessionOrdinal > todayOrdinal || sessionOrdinal === lastCountedOrdinal) continue;

      if (expectedOrdinal === null) {
        if (sessionOrdinal < todayOrdinal - 1) return 0;
        streakDays = 1;
        expectedOrdinal = sessionOrdinal - 1;
        lastCountedOrdinal = sessionOrdinal;
        continue;
      }

      if (sessionOrdinal === expectedOrdinal) {
        streakDays += 1;
        expectedOrdinal -= 1;
        lastCountedOrdinal = sessionOrdinal;
      } else if (sessionOrdinal < expectedOrdinal) {
        return streakDays;
      }
    }

    if (snapshot.docs.length < STREAK_QUERY_PAGE_SIZE) return streakDays;
    cursor = snapshot.docs.at(-1) ?? null;
    if (!cursor) return streakDays;
  }
}

export async function getWorkoutMetrics(userId: string): Promise<WorkoutMetrics> {
  const userSessions = query(
    collection(db, SESSIONS_COLLECTION),
    where("userId", "==", userId),
  );
  const [aggregates, currentStreakDays] = await Promise.all([
    getAggregateFromServer(userSessions, {
      totalSessions: count(),
      totalDurationSeconds: sum("durationSeconds"),
    }),
    getCurrentWorkoutStreak(userId),
  ]);
  const aggregateData = aggregates.data();
  return {
    currentStreakDays,
    totalSessions: aggregateData.totalSessions,
    totalDurationSeconds: aggregateData.totalDurationSeconds ?? 0,
  };
}

export async function completeWorkoutSession(
  session: Omit<WorkoutSession, "id">,
): Promise<string> {
  const routineRef = doc(db, ROUTINES_COLLECTION, session.routineId);
  const sessionRef = doc(collection(db, SESSIONS_COLLECTION));

  await runTransaction(db, async (transaction) => {
    const routineSnapshot = await transaction.get(routineRef);
    if (!routineSnapshot.exists() || routineSnapshot.data().userId !== session.userId) {
      throw new Error("No se encontró una rutina propia para completar la sesión.");
    }

    const routine = routineSnapshot.data();
    const days = Array.isArray(routine.days) ? routine.days : [];
    const currentIndex = Math.max(0, Number(routine.currentCycleIndex ?? 0) || 0);
    transaction.update(routineRef, {
      currentCycleIndex: days.length > 0 ? (currentIndex + 1) % days.length : 0,
    });
    transaction.set(sessionRef, {
      ...session,
      date: Timestamp.fromDate(session.date),
      createdAt: serverTimestamp(),
    });
  });

  return sessionRef.id;
}
