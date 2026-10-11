import type { AppData } from './types';
import { mergeTasks } from './core';
import { newerTimetable } from './timetable';
import { mergeJournal } from './journal';
import { mergeReflections } from './reflections';
import { mergeItems } from './weekly';

/** Merge snapshots from the desktop calendar and management window. */
export function mergeWindowData(current: AppData, incoming: AppData): AppData {
  const lists = new Map(current.lists.map(list => [list.id, list]));
  for (const list of incoming.lists) {
    const previous = lists.get(list.id);
    if (!previous || JSON.stringify(list) > JSON.stringify(previous)) lists.set(list.id, list);
  }
  const next: AppData = {
    version: 1,
    tasks: mergeTasks(current.tasks, incoming.tasks),
    lists: [...lists.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  };
  const timetable = newerTimetable(current.timetable, incoming.timetable);
  if (timetable) next.timetable = timetable;
  if (current.journal || incoming.journal) next.journal = mergeJournal(current.journal, incoming.journal);
  if (current.reflections || incoming.reflections) next.reflections = mergeReflections(current.reflections, incoming.reflections);
  if (current.goals || incoming.goals) next.goals = mergeItems(current.goals, incoming.goals);
  if (current.goalMarks || incoming.goalMarks) next.goalMarks = mergeItems(current.goalMarks, incoming.goalMarks);
  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
}
