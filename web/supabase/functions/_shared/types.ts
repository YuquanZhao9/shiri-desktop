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
  /** Dates (YYYY-MM-DD) this class does not take place, e.g. one cancelled week. */
  skip?: string[];
  /** Optional first and last date of this class, inside the semester. */
  from?: string;
  until?: string;
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

/** One diary page per day, plain text. An empty text marks a deleted entry so the deletion syncs. */
export interface JournalEntry {
  date: string;
  text: string;
  updatedAt: string;
}

/** One reflection (复盘): a short note; Enter adds the next one. Deletions keep a tombstone so they sync. */
export interface Reflection {
  id: string;
  date: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** A weekly-quota task (周次任务): do it `target` times a week, on any days, out of `slots` boxes. */
export interface WeeklyGoal {
  id: string;
  name: string;
  color: string;
  target: number;
  slots: number;
  /** Length of one session in minutes (default 60). */
  duration?: number;
  /** Preferred start time (HH:mm) when sessions are placed automatically. */
  time?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** One session of a weekly goal on a date: done, or planned for that day. */
export interface GoalMark {
  id: string;
  goalId: string;
  date: string;
  done: boolean;
  /** Start time (HH:mm) when the session is scheduled; untimed otherwise. */
  time?: string;
  /** Minutes; defaults to the goal's duration. */
  duration?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** 已上 / 未上 / 待复习. */
export type ClassStatus = 'done' | 'todo' | 'review';

/** Status and note of one class on one date (a timetable slot's occurrence). */
export interface ClassMark {
  id: string;
  slotId: string;
  date: string;
  /** Course title when it was marked, so the review list still reads well if the timetable changes. */
  title: string;
  status: ClassStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface AppData {
  version: 1;
  tasks: Task[];
  lists: TaskList[];
  /** Weekly class timetable; absent until the user saves one (a default is shown). */
  timetable?: Timetable;
  /** Diary pages; absent until the first one is written. */
  journal?: JournalEntry[];
  /** Reflections (复盘); absent until the first one. */
  reflections?: Reflection[];
  /** Weekly-quota tasks and their sessions; absent until the first one. */
  goals?: WeeklyGoal[];
  goalMarks?: GoalMark[];
  /** Per-date class status (已上 / 未上 / 待复习) and notes. */
  classMarks?: ClassMark[];
}
