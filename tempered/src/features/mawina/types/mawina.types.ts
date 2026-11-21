export type RoutineCategory = "fitness" | "habit";
export type RoutineScheduleType = "cycle" | "fixed_days";

export interface ExerciseItem {
  id: string;
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes?: string;
  order: number;
}

export interface RoutineDay {
  id: string;
  dayNumber: number;
  title: string;
  isRestDay: boolean;
  exercises: ExerciseItem[];
}

export interface Routine {
  id: string;
  userId: string;
  name: string;
  description: string;
  category: RoutineCategory;
  scheduleType: RoutineScheduleType;
  activeDaysCount: number;
  restDaysCount: number;
  currentCycleIndex: number;
  isActive: boolean;
  createdAt: Date;
  days: RoutineDay[];
  fixedDays?: number[];
}

export interface CompletedExerciseSet {
  setNumber: number;
  reps: number;
  weight: number;
}

export interface CompletedExercise {
  exerciseId: string;
  name: string;
  sets: CompletedExerciseSet[];
}

export interface WorkoutSession {
  id: string;
  userId: string;
  routineId: string;
  routineName: string;
  dayTitle: string;
  date: Date;
  durationSeconds: number;
  completedExercises: CompletedExercise[];
}

export interface WorkoutMetrics {
  currentStreakDays: number;
  totalSessions: number;
  totalDurationSeconds: number;
}

export type NewRoutine = Omit<Routine, "id" | "createdAt">;

export type RoutineConfiguration = Pick<
  NewRoutine,
  "name" | "description" | "category" | "scheduleType" | "activeDaysCount" | "restDaysCount" | "days" | "fixedDays"
>;
