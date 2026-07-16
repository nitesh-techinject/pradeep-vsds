"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Plus, Pencil, Trash2, RefreshCw, X, Check, BookOpen } from "lucide-react";
import { Portal } from "@/components/Portal";
import {
  listBookMappings,
  createBookMapping,
  updateBookMapping,
  deleteBookMapping,
  listAlgoliaProducts,
  searchAlgolia,
  syncAlgoliaProducts,
  deleteAlgoliaProduct,
  type BookMapping,
  type AlgoliaProduct,
  type AlgoliaHit,
} from "@/services/api";



// ─────────────────────────────────────────────────────────────────────────────
// Book Mappings Tab
// ─────────────────────────────────────────────────────────────────────────────

interface SelectedProduct {
  productId: string;
  productTitle: string;
  notes: string;
  authors: Array<{id: string; title: string}>;
  coverUrl?: string | null;
  edition?: string | null;
}

interface EditFormState {
  bookCode: string;
  productId: string;
  productTitle: string;
  notes: string;
  authors: Array<{id: string; title: string}>;
  coverUrl?: string | null;
  edition?: string | null;
}

function BookMappingsTab() {
  const [rows, setRows] = useState<BookMapping[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create modal (multi-product)
  const [showCreate, setShowCreate] = useState(false);
  const [createBookCode, setCreateBookCode] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Image lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Edit modal (single product)
  const [editRow, setEditRow] = useState<BookMapping | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({ bookCode: "", productId: "", productTitle: "", notes: "", authors: [] });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Algolia search (shared for both modals)
  const [algoliaQuery, setAlgoliaQuery] = useState("");
  const [algoliaHits, setAlgoliaHits] = useState<AlgoliaHit[]>([]);
  const [algoliaSearching, setAlgoliaSearching] = useState(false);

  const load = useCallback(async (p: number, q: string, ps: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listBookMappings({ page: p, pageSize: ps, search: q });
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mappings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search, pageSize);
  }, [load, page, search, pageSize]);

  // Debounced Algolia search
  const handleAlgoliaSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setAlgoliaHits([]); return; }
    setAlgoliaSearching(true);
    setAlgoliaHits([]);
    try {
      const res = await searchAlgolia(q);
      setAlgoliaHits(res.hits);
    } catch {
      setAlgoliaHits([]);
    } finally {
      setAlgoliaSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!algoliaQuery.trim()) { setAlgoliaHits([]); setAlgoliaSearching(false); return; }
    const t = setTimeout(() => handleAlgoliaSearch(algoliaQuery), 500);
    return () => clearTimeout(t);
  }, [algoliaQuery, handleAlgoliaSearch]);

  // ── Create modal ────────────────────────────────────────────────────────────

  const openCreate = (prefillCode = "") => {
    setCreateBookCode(prefillCode);
    setSelectedProducts([]);
    setFormError(null);
    setAlgoliaQuery("");
    setAlgoliaHits([]);
    setShowCreate(true);
  };

  const closeCreate = () => {
    setShowCreate(false);
    setAlgoliaQuery("");
    setAlgoliaHits([]);
  };

  const addProduct = (hit: AlgoliaHit) => {
    const alreadyAdded = selectedProducts.some((p) => p.productId === hit.objectID);
    if (alreadyAdded) return;
    setSelectedProducts((prev) => [
      ...prev,
      { productId: hit.objectID, productTitle: hit.title ?? hit.objectID, notes: "", authors: Array.isArray(hit.authors) ? hit.authors : [], coverUrl: (hit["mainImage.url"] as string | undefined) ?? (hit.image as string | undefined) ?? null, edition: hit.edition ?? null },
    ]);
    setAlgoliaQuery("");
    setAlgoliaHits([]);
  };

  const removeProduct = (productId: string) => {
    setSelectedProducts((prev) => prev.filter((p) => p.productId !== productId));
  };

  const handleSaveCreate = async () => {
    if (!createBookCode.trim()) { setFormError("Book code is required."); return; }
    if (selectedProducts.length === 0) { setFormError("Add at least one product."); return; }
    setSaving(true);
    setFormError(null);
    try {
      await Promise.all(
        selectedProducts.map((p) =>
          createBookMapping({ bookCode: createBookCode.trim(), productId: p.productId, productTitle: p.productTitle, authors: p.authors, notes: p.notes, coverUrl: p.coverUrl, edition: p.edition })
        )
      );
      closeCreate();
      load(page, search, pageSize);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Edit modal ──────────────────────────────────────────────────────────────

  const openEdit = (row: BookMapping) => {
    setEditRow(row);
    setEditForm({ bookCode: row.bookCode, productId: row.productId, productTitle: row.productTitle, notes: row.notes ?? "", authors: row.authors ?? [], coverUrl: row.coverUrl, edition: row.edition });
    setEditError(null);
    setAlgoliaQuery("");
    setAlgoliaHits([]);
  };

  const closeEdit = () => {
    setEditRow(null);
    setAlgoliaQuery("");
    setAlgoliaHits([]);
  };

  const handleSaveEdit = async () => {
    if (!editRow) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await updateBookMapping(editRow.id, { ...editForm, authors: editForm.authors });
      closeEdit();
      load(page, search, pageSize);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (row: BookMapping) => {
    if (!confirm(`Delete "${row.productTitle}" from code "${row.bookCode}"?`)) return;
    try {
      await deleteBookMapping(row.id);
      load(page, search, pageSize);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  // Group rows by bookCode
  const grouped = rows.reduce<Record<string, BookMapping[]>>((acc, row) => {
    (acc[row.bookCode] ??= []).push(row);
    return acc;
  }, {});
  const groupedCodes = Object.keys(grouped);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Algolia dropdown (shared)
  const AlgoliaDropdown = ({ onSelect }: { onSelect: (hit: AlgoliaHit) => void }) => (
    <>
      {algoliaQuery.trim() && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-card shadow-xl max-h-52 overflow-y-auto">
          {algoliaSearching ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Searching…
            </div>
          ) : algoliaHits.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">No products found</div>
          ) : (
            algoliaHits.map((hit) => {
              const imgUrl = (hit["mainImage.url"] as string | undefined) ?? (hit.image as string | undefined);
              return (
                <button
                  key={hit.objectID}
                  type="button"
                  onClick={() => onSelect(hit)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b border-border last:border-0 transition-colors flex items-center gap-3"
                >
                  <div className="flex-shrink-0 w-10 h-14 rounded overflow-hidden border border-border bg-muted shadow-sm">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-full h-full bg-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-foreground block truncate leading-snug">{hit.title ?? hit.objectID}</span>
                    <span className="text-xs text-muted-foreground font-mono block mt-0.5">{hit.objectID}</span>
                    {hit.edition && <span className="text-xs text-muted-foreground block">Edition: {hit.edition}</span>}
                    {hit.isbn && <span className="text-xs text-muted-foreground block">ISBN: {hit.isbn}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by code, product..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          onClick={() => openCreate()}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Mapping
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Grouped list */}
      <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : groupedCodes.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No mappings found. Add one to get started.
          </div>
        ) : (
          groupedCodes.map((code) => {
            const products = grouped[code]!;
            return (
              <div key={code} className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-foreground text-sm">{code}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {products.length} product{products.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <button
                    onClick={() => openCreate(code)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <Plus className="h-3 w-3" /> Add product
                  </button>
                </div>
                <div className="space-y-1">
                  {products.map((row) => (
                    <div key={row.id} className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2 text-sm hover:bg-muted/50 transition-colors">
                      <div
                        className={`flex-shrink-0 w-9 h-12 rounded overflow-hidden border border-border bg-muted ${row.coverUrl ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
                        onClick={() => row.coverUrl && setLightboxUrl(row.coverUrl)}
                      >
                        {row.coverUrl ? <img src={row.coverUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-muted" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-foreground truncate block">{row.productTitle}</span>
                        {row.authors && row.authors.length > 0 && (
                          <span className="text-xs text-muted-foreground">by {row.authors.map((a) => a.title).join(", ")}</span>
                        )}
                        <span className="font-mono text-xs text-muted-foreground block">{row.productId}</span>
                        {row.edition && <span className="text-xs text-muted-foreground block">Edition: {row.edition}</span>}
                        {row.notes && <span className="text-xs text-muted-foreground">· {row.notes}</span>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => openEdit(row)} className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground transition-colors" title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleDelete(row)} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>{total} total mappings</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {[10, 20, 50, 100].map((s) => (
                <option key={s} value={s}>{s} / page</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-md px-3 py-1.5 border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Previous</button>
            <span className="px-2">Page {page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-md px-3 py-1.5 border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>
          </div>
        </div>
      )}

      {/* ── Image Lightbox ─────────────────────────────────────────────────────── */}
      {lightboxUrl && (
        <Portal>
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute -top-3 -right-3 z-10 rounded-full bg-card border border-border p-1 text-muted-foreground hover:text-foreground shadow-lg transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={lightboxUrl}
              alt="Book cover"
              referrerPolicy="no-referrer"
              className="w-full rounded-xl shadow-2xl object-contain max-h-[80vh]"
            />
          </div>
        </div>
        </Portal>
      )}

      {/* ── Create Modal (multi-product) ──────────────────────────────────────── */}
      {showCreate && (
        <Portal>
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl bg-card border border-border shadow-xl flex flex-col overflow-visible">
            <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
              <h2 className="text-base font-semibold text-foreground">Add Book Mapping</h2>
              <button onClick={closeCreate} className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-5 space-y-4 overflow-visible">
              {formError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">{formError}</div>
              )}

              {/* Book Code */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Book Code *</label>
                <input
                  value={createBookCode}
                  onChange={(e) => setCreateBookCode(e.target.value)}
                  placeholder="e.g. MATH-101"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Algolia search */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Search &amp; Add Products</label>
                <div className="relative">
                  <input
                    value={algoliaQuery}
                    onChange={(e) => {
                      setAlgoliaQuery(e.target.value);
                      if (e.target.value.trim()) setAlgoliaSearching(true);
                    }}
                    placeholder="Type product name or ISBN…"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <AlgoliaDropdown onSelect={addProduct} />
                </div>
              </div>

              {/* Selected products list */}
              {selectedProducts.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Selected Products <span className="text-muted-foreground font-normal">({selectedProducts.length})</span>
                  </label>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedProducts.map((p) => (
                      <div key={p.productId} className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <div className="flex-shrink-0 w-9 h-12 rounded overflow-hidden border border-border bg-muted mt-0.5">
                          {p.coverUrl ? <img src={p.coverUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-muted" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{p.productTitle}</p>
                          <p className="text-xs font-mono text-muted-foreground">{p.productId}</p>
                          {p.edition && <p className="text-xs text-muted-foreground">Edition: {p.edition}</p>}
                          <input
                            value={p.notes}
                            onChange={(e) => setSelectedProducts((prev) => prev.map((x) => x.productId === p.productId ? { ...x, notes: e.target.value } : x))}
                            placeholder="Notes (optional)"
                            className="mt-1.5 w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          {/* Authors (from Algolia — read only) */}
                          {p.authors.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {p.authors.map((a) => (
                                <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                                  {a.title}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button onClick={() => removeProduct(p.productId)} className="mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedProducts.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Search above to add products. You can add multiple.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4 shrink-0">
              <button onClick={closeCreate} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted transition-colors">Cancel</button>
              <button
                onClick={handleSaveCreate}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                    Saving…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Save {selectedProducts.length > 0 ? `${selectedProducts.length} Mapping${selectedProducts.length > 1 ? "s" : ""}` : "Mapping"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* ── Edit Modal (single product) ───────────────────────────────────────── */}
      {editRow && (
        <Portal>
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl bg-card border border-border shadow-xl overflow-visible">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold text-foreground">Edit Mapping</h2>
              <button onClick={closeEdit} className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {editError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">{editError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Book Code *</label>
                <input value={editForm.bookCode} onChange={(e) => setEditForm((f) => ({ ...f, bookCode: e.target.value }))} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              {/* Algolia search to replace product */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Replace Product (optional)</label>
                <div className="relative">
                  <input
                    value={algoliaQuery}
                    onChange={(e) => {
                      setAlgoliaQuery(e.target.value);
                      if (e.target.value.trim()) setAlgoliaSearching(true);
                    }}
                    placeholder="Search to replace…"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <AlgoliaDropdown onSelect={(hit) => { setEditForm((f) => ({ ...f, productId: hit.objectID, productTitle: hit.title ?? hit.objectID, authors: Array.isArray(hit.authors) ? hit.authors : f.authors, coverUrl: (hit["mainImage.url"] as string | undefined) ?? (hit.image as string | undefined) ?? null, edition: hit.edition ?? null })); setAlgoliaQuery(""); setAlgoliaHits([]); }} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Product ID *</label>
                <input value={editForm.productId} onChange={(e) => setEditForm((f) => ({ ...f, productId: e.target.value }))} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Product Title *</label>
                <input value={editForm.productTitle} onChange={(e) => setEditForm((f) => ({ ...f, productTitle: e.target.value }))} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Edition</label>
                <input value={editForm.edition ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, edition: e.target.value || null }))} placeholder="e.g. 2nd Edition" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
                <input value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              {/* Authors (from Algolia — read only) */}
              {editForm.authors.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Authors</label>
                  <div className="flex flex-wrap gap-1">
                    {editForm.authors.map((a) => (
                      <span key={a.id} className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                        {a.title}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
              <button onClick={closeEdit} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleSaveEdit} disabled={editSaving} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {editSaving ? "Saving…" : <><Check className="h-4 w-4" /> Save Changes</>}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Algolia Products Tab (local cache)
// ─────────────────────────────────────────────────────────────────────────────

function AlgoliaProductsTab() {
  const [rows, setRows] = useState<AlgoliaProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync from Algolia
  const [syncQuery, setSyncQuery] = useState("");
  const [syncHits, setSyncHits] = useState<AlgoliaHit[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncSearching, setSyncSearching] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const PAGE_SIZE = 50;

  const load = useCallback(async (p: number, q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAlgoliaProducts({ page: p, pageSize: PAGE_SIZE, search: q });
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search, pageSize);
  }, [load, page, search]);

  const handleSyncSearch = async () => {
    if (!syncQuery.trim()) return;
    setSyncSearching(true);
    setSyncMsg(null);
    setSyncHits([]);
    try {
      const res = await searchAlgolia(syncQuery);
      setSyncHits(res.hits);
      if (res.hits.length === 0) setSyncMsg("No results found.");
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Algolia search failed");
    } finally {
      setSyncSearching(false);
    }
  };

  const handleSyncSelected = async (hits: AlgoliaHit[]) => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const products = hits.map((h) => ({
        objectID: h.objectID,
        title: h.title ?? "",
        isbn: h.isbn ?? null,
        subject: h.subject ?? null,
        grade: h.grade ?? null,
        publisher: h.publisher ?? null,
        coverUrl: h["mainImage.url"] ?? h.image ?? null,
      }));
      const res = await syncAlgoliaProducts(products);
      setSyncMsg(`Synced ${res.synced} product(s) successfully.`);
      setSyncHits([]);
      setSyncQuery("");
      load(1, search);
      setPage(1);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (objectID: string) => {
    if (!confirm(`Remove product "${objectID}" from local cache?`)) return;
    try {
      await deleteAlgoliaProduct(objectID);
      load(page, search, pageSize);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* Sync panel */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Sync Products from Algolia</p>
        <div className="flex gap-2">
          <input
            value={syncQuery}
            onChange={(e) => setSyncQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSyncSearch()}
            placeholder="Search Algolia by title or ISBN…"
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleSyncSearch}
            disabled={syncSearching || !syncQuery.trim()}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <Search className="h-4 w-4" />
            {syncSearching ? "Searching…" : "Search"}
          </button>
        </div>

        {syncMsg && (
          <p className={`text-sm ${syncMsg.includes("failed") || syncMsg.includes("Failed") ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
            {syncMsg}
          </p>
        )}

        {syncHits.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{syncHits.length} results from Algolia</p>
              <button
                onClick={() => handleSyncSelected(syncHits)}
                disabled={syncing}
                className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {syncing ? "Syncing…" : `Sync All ${syncHits.length}`}
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {syncHits.map((hit) => (
                <div key={hit.objectID} className="flex items-center justify-between px-3 py-2 hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{hit.title ?? hit.objectID}</p>
                    <p className="text-xs text-muted-foreground font-mono">{hit.objectID}{hit.isbn ? ` · ISBN: ${hit.isbn}` : ""}</p>
                  </div>
                  <button
                    onClick={() => handleSyncSelected([hit])}
                    disabled={syncing}
                    className="ml-3 flex-shrink-0 rounded-md px-2 py-1 text-xs border border-border hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    Sync
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Search local cache */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search local products…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Object ID</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">ISBN</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Subject</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Publisher</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No products in local cache. Use "Sync from Algolia" above to add products.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.objectID} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-[140px] truncate">{row.objectID}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{row.title}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{row.isbn ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{row.subject ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{row.publisher ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={() => handleDelete(row.objectID)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title="Remove from cache"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} cached products</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-md px-3 py-1.5 border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="px-2">Page {page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-md px-3 py-1.5 border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function BookMappingsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Book Mappings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Map book codes from uploaded spreadsheets to Algolia product IDs. Manage the local Algolia product cache.
        </p>
      </div>

      <BookMappingsTab />
    </div>
  );
}
