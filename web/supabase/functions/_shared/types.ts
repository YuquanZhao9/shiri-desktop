// 自动从 拾日/src/types.ts 复制，请勿手改；运行 node scripts/sync-shared.mjs 更新。
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
export type Priority = 'normal' | 'high';

export interface Task {
  id: string;
  title: string;
  /** Local calendar date (YYYY-MM-DD); empty string means inbox. */
  date: string;
  /** Local wall-clock time (HH:mm); empty string means all day. */
  time: string;
  duration: number;
  listId: string;
  notes: string;
  priority: Priority;
  repeat: Repeat;
  completed: boolean;
  /** Completed occurrence dates for a repeating task. */
  doneDates: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  /** Optional color tag (#RRGGBB) that overrides the list color. */
  color?: string;
}

export interface TaskList {
  id: string;
  name: string;
  color: string;
}

export interface TimetableCourse {
  code: string;
  name: string;
  color: string;
}

export interface TimetableSlot {
  id: string;
  /** 1 = Monday … 7 = Sunday. */
  day: number;
  start: string;
  end: string;
  title: string;
  note: string;
  color: string;
  /** Dashed: optional or not attended in person (e.g. watching a recording). */
  dashed: boolean;
  /** Warnings for specific dates, e.g. a clash with a block seminar. */
  alerts?: TimetableAlert[];
}

export interface TimetableAlert {
  date: string;
  note: string;
}

export interface TimetableBreak {
  name: string;
  start: string;
  end: string;
}

export interface Timetable {
  name: string;
  /** Semester range, YYYY-MM-DD. */
  start: string;
  end: string;
  slots: TimetableSlot[];
  courses: TimetableCourse[];
  /** Lecture-free periods (inclusive dates); older saves may not have it. */
  breaks?: TimetableBreak[];
  updatedAt: string;
}

export interface AppData {
  version: 1;
  tasks: Task[];
  lists: TaskList[];
  /** Weekly class timetable; absent until the user saves one (a default is shown). */
  timetable?: Timetable;
}
