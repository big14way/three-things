/**
 * Everything the app remembers between visits, kept in localStorage.
 *
 * A "thing" is one card: either handwriting (stored as a PNG data URL of the
 * ink) or a typed quick pick. Each day starts with an empty board; things that
 * were on yesterday's board but not done go back to the inbox, marked carried.
 */

export type ThingStatus = 'inbox' | 'today' | 'done';

export interface Thing {
  id: string;
  kind: 'ink' | 'text';
  ink?: string; // PNG data URL, transparent background
  text?: string;
  color: number; // index into PAPER_COLORS
  status: ThingStatus;
  slot: number; // 0..2 when status is 'today', otherwise -1
  created: string; // day key
  carried: number; // how many days it has been carried over
  doneDay?: string;
}

export interface DayLog {
  written: number;
  pinned: number;
  done: number;
}

export interface SavedState {
  version: 1;
  things: Thing[];
  days: Record<string, DayLog>;
  lastOpen: string;
  boardAnchor?: string; // persistent anchor UUID (Quest)
  boardScale?: number; // the board grows on far walls so it stays readable
  onboarded: boolean;
}

const KEY = 'three-things:v1';

export function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

function fresh(): SavedState {
  return { version: 1, things: [], days: {}, lastOpen: dayKey(), onboarded: false };
}

function load(): SavedState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as SavedState;
      if (s && s.version === 1 && Array.isArray(s.things)) {
        return s;
      }
    }
  } catch {
    // private mode or corrupt data: start fresh
  }
  return fresh();
}

type Listener = () => void;

export class Store {
  state: SavedState;
  /** Set on the first open of a new day: what happened on the last day used. */
  yesterday: { day: string; pinned: number; done: number; carried: number } | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = load();
    this.rollOver();
  }

  /** Move unfinished board items back to the inbox when the day changes. */
  private rollOver() {
    const today = dayKey();
    if (this.state.lastOpen === today) {
      return;
    }
    const last = this.state.lastOpen;
    let carried = 0;
    for (const t of this.state.things) {
      if (t.status === 'today') {
        t.status = 'inbox';
        t.slot = -1;
        t.carried += 1;
        carried += 1;
      }
    }
    const log = this.state.days[last];
    this.yesterday = { day: last, pinned: log?.pinned ?? 0, done: log?.done ?? 0, carried };
    // Keep the inbox from growing without bound: drop things carried a week.
    this.state.things = this.state.things.filter((t) => t.status !== 'inbox' || t.carried < 7);
    this.state.lastOpen = today;
    this.save();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // storage full or unavailable; the session still works
    }
    for (const fn of this.listeners) fn();
  }

  private log(): DayLog {
    const k = dayKey();
    return (this.state.days[k] ??= { written: 0, pinned: 0, done: 0 });
  }

  get things() {
    return this.state.things;
  }

  byId(id: string) {
    return this.state.things.find((t) => t.id === id);
  }

  add(thing: Omit<Thing, 'id' | 'status' | 'slot' | 'created' | 'carried'>): Thing {
    const t: Thing = {
      ...thing,
      id: Math.random().toString(36).slice(2, 10),
      status: 'inbox',
      slot: -1,
      created: dayKey(),
      carried: 0,
    };
    this.state.things.push(t);
    this.log().written += 1;
    this.save();
    return t;
  }

  pin(id: string, slot: number) {
    const t = this.byId(id);
    if (!t) return;
    // Whatever was in that slot goes back to the inbox.
    for (const o of this.state.things) {
      if (o.status === 'today' && o.slot === slot && o.id !== id) {
        o.status = 'inbox';
        o.slot = -1;
      }
    }
    if (t.status !== 'today') this.log().pinned += 1;
    t.status = 'today';
    t.slot = slot;
    this.save();
  }

  unpin(id: string) {
    const t = this.byId(id);
    if (!t || t.status !== 'today') return;
    t.status = 'inbox';
    t.slot = -1;
    this.save();
  }

  done(id: string) {
    const t = this.byId(id);
    if (!t || t.status === 'done') return;
    t.status = 'done';
    t.slot = -1;
    t.doneDay = dayKey();
    this.log().done += 1;
    this.save();
  }

  remove(id: string) {
    this.state.things = this.state.things.filter((t) => t.id !== id);
    this.save();
  }

  slotOf(slot: number) {
    return this.state.things.find((t) => t.status === 'today' && t.slot === slot);
  }

  /** Consecutive days, ending today or yesterday, with at least one thing done. */
  streak(): number {
    let k = dayKey();
    if (!(this.state.days[k]?.done > 0)) k = previousDay(k);
    let n = 0;
    while (this.state.days[k]?.done > 0) {
      n += 1;
      k = previousDay(k);
    }
    return n;
  }

  doneCount(): number {
    return this.state.things.filter((t) => t.status === 'done').length;
  }

  doneToday(): number {
    return this.state.days[dayKey()]?.done ?? 0;
  }

  setBoardAnchor(uuid: string | undefined, scale?: number) {
    this.state.boardAnchor = uuid;
    if (scale !== undefined) this.state.boardScale = scale;
    this.save();
  }

  setOnboarded() {
    this.state.onboarded = true;
    this.save();
  }

  /** Wipe everything (used by the "start over" control and for recording demos). */
  reset() {
    this.state = fresh();
    this.yesterday = null;
    this.save();
  }
}

export const store = new Store();
