import { create } from "zustand";
import type {
  MeasureGraph,
  MeasureListItem,
  ModelSummary,
  RelationshipItem,
  TableListItem,
} from "../api/types";
import { api } from "../api/client";

export type ViewMode = "semantic" | "source";
export type Theme = "light" | "dark";

export interface Selection {
  kind: "measure" | "table";
  name: string;
  table?: string;
}

interface State {
  // Reference data — loaded once on app boot.
  summary: ModelSummary | null;
  measures: MeasureListItem[];
  tables: TableListItem[];
  relationships: RelationshipItem[];
  loading: boolean;
  error: string | null;

  // UI state.
  view: ViewMode;
  theme: Theme;
  depth: number;
  search: string;
  classFilter: Set<string>; // selected table classifications

  // Selection.
  selection: Selection | null;
  pinned: Selection[];
  measureGraph: MeasureGraph | null;
  measureGraphLoading: boolean;

  // Actions.
  bootstrap: () => Promise<void>;
  setView: (v: ViewMode) => void;
  toggleTheme: () => void;
  setDepth: (d: number) => void;
  setSearch: (s: string) => void;
  toggleClassFilter: (c: string) => void;
  selectMeasure: (table: string, name: string) => Promise<void>;
  selectTable: (name: string) => void;
  clearSelection: () => void;
  pinSelection: () => void;
  unpinSelection: (sel: Selection) => void;
}

const ALL_CLASSES = ["fact", "dim", "parameter", "time", "calculation_group", "other"];

export const useStore = create<State>((set, get) => ({
  summary: null,
  measures: [],
  tables: [],
  relationships: [],
  loading: false,
  error: null,

  view: "semantic",
  theme: (localStorage.getItem("model-lenz-theme") as Theme) || "dark",
  depth: 2,
  search: "",
  classFilter: new Set(ALL_CLASSES),

  selection: null,
  pinned: [],
  measureGraph: null,
  measureGraphLoading: false,

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const [summary, measures, tables, relationships] = await Promise.all([
        api.modelSummary(),
        api.measures(),
        api.tables(),
        api.relationships(),
      ]);
      set({ summary, measures, tables, relationships, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  setView: (v) => set({ view: v }),
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    localStorage.setItem("model-lenz-theme", next);
    set({ theme: next });
  },
  setDepth: (d) => {
    set({ depth: d });
    const sel = get().selection;
    if (sel?.kind === "measure" && sel.table) void get().selectMeasure(sel.table, sel.name);
  },
  setSearch: (s) => set({ search: s }),
  toggleClassFilter: (c) => {
    const cur = new Set(get().classFilter);
    if (cur.has(c)) cur.delete(c);
    else cur.add(c);
    set({ classFilter: cur });
  },

  selectMeasure: async (table, name) => {
    set({
      selection: { kind: "measure", name, table },
      measureGraph: null,
      measureGraphLoading: true,
    });
    try {
      const g = await api.measureGraph(table, name, get().depth);
      // Only commit if the user hasn't navigated away.
      const sel = get().selection;
      if (sel && sel.kind === "measure" && sel.name === name && sel.table === table) {
        set({ measureGraph: g, measureGraphLoading: false });
      }
    } catch (e) {
      set({ error: (e as Error).message, measureGraphLoading: false });
    }
  },

  selectTable: (name) =>
    set({
      selection: { kind: "table", name },
      measureGraph: null,
    }),

  clearSelection: () =>
    set({ selection: null, measureGraph: null }),

  pinSelection: () => {
    const sel = get().selection;
    if (!sel) return;
    const exists = get().pinned.find(
      (p) => p.kind === sel.kind && p.name === sel.name && p.table === sel.table,
    );
    if (!exists) set({ pinned: [...get().pinned, sel] });
  },
  unpinSelection: (sel) =>
    set({
      pinned: get().pinned.filter(
        (p) => !(p.kind === sel.kind && p.name === sel.name && p.table === sel.table),
      ),
    }),
}));

export const ALL_CLASSIFICATIONS = ALL_CLASSES;
