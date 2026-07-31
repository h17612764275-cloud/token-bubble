export interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthGrid(year: number, month: number): CalendarDay[] {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, month, index - mondayOffset + 1);
    return {
      date: localDateKey(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month,
    };
  });
}
