import type {
  MeasureGraph,
  MeasureListItem,
  ModelSummary,
  RelationshipItem,
  SearchHit,
  TableDetail,
  TableListItem,
} from "./types";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText);
    throw new Error(`${r.status} ${r.statusText}: ${text}`);
  }
  return (await r.json()) as T;
}

export const api = {
  modelSummary: () => fetchJson<ModelSummary>("/api/model"),
  measures: () => fetchJson<MeasureListItem[]>("/api/measures"),
  measureGraph: (table: string, name: string, depth: number) =>
    fetchJson<MeasureGraph>(
      `/api/measures/${encodeURIComponent(table)}/${encodeURIComponent(name)}/graph?depth=${depth}`,
    ),
  tables: () => fetchJson<TableListItem[]>("/api/tables"),
  tableDetail: (name: string) =>
    fetchJson<TableDetail>(`/api/tables/${encodeURIComponent(name)}`),
  relationships: () => fetchJson<RelationshipItem[]>("/api/relationships"),
  search: (q: string) =>
    fetchJson<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
};
