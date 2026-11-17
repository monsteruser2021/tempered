export type Task = {
  id: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string;
  completed: boolean;
  completedAt?: string;
};

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type DueDateUrgency = "overdue" | "today" | "soon" | "later";

function calendarDayNumber(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return timestamp / 86_400_000;
}

export function getDueDateUrgency(dueDate: string, today = localDateString()): DueDateUrgency {
  const dueDay = calendarDayNumber(dueDate);
  const todayDay = calendarDayNumber(today);
  if (dueDay === null || todayDay === null) return "later";

  const daysUntilDue = dueDay - todayDay;
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue === 0) return "today";
  if (daysUntilDue <= 3) return "soon";
  return "later";
}