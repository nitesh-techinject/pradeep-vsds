"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Pagination from "@/components/Pagination";
import { Portal } from "@/components/Portal";
import {
  Plus, Pencil, X, Check, Zap, ZapOff, Eye, RefreshCw, ChevronDown, ChevronUp, MessageSquare, Download,
} from "lucide-react";
import {
  listWatiTemplates, createWatiTemplate, updateWatiTemplate,
  activateWatiTemplate, deactivateWatiTemplate, parseWatiVariables, previewWatiTemplate,
  fetchWatiTemplatesFromApi,
  type WatiTemplate, type WatiTemplateParam, type WatiRemoteTemplate,
} from "@/services/api";

// ─── Available data paths ────────────────────────────────────────────────────

// Supports up to 12 books (matching spmst12)
const BOOK_COUNT = 12;

const STATIC_PATHS = [
  { value: "teacher.name",   label: "Teacher · Name" },
  { value: "teacher.phone",  label: "Teacher · Phone" },
  { value: "teacher.email",  label: "Teacher · Email" },
  { value: "teacher.school", label: "Teacher · School" },
  { value: "teacher.city",   label: "Teacher · City" },
  { value: "batch.id",       label: "Batch · ID" },
];

const BOOK_PATHS = Array.from({ length: BOOK_COUNT }, (_, i) => [
  { value: `books.${i}.title`,       label: `Book ${i + 1} · Title` },
  { value: `books.${i}.author`,      label: `Book ${i + 1} · Author` },
  { value: `books.${i}.specimenUrl`, label: `Book ${i + 1} · Specimen URL` },
  { value: `books.${i}.productId`,   label: `Book ${i + 1} · Product ID` },
]).flat();

const DATA_PATHS = [...STATIC_PATHS, ...BOOK_PATHS];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function labelForPath(path: string) {
  return DATA_PATHS.find((d) => d.value === path)?.label ?? path;
}

/** Auto-map known WATI param names to data paths */
function autoMapParam(paramName: string): string {
  // Named params (legacy templates)
  if (paramName === "name") return "teacher.name";
  if (paramName === "phone") return "teacher.phone";
  if (paramName === "email") return "teacher.email";
  if (paramName === "school") return "teacher.school";
  if (paramName === "city") return "teacher.city";

  // bookname1..12 → books.0..11.title
  const booknameMatch = paramName.match(/^bookname(\d+)$/);
  if (booknameMatch) {
    const idx = parseInt(booknameMatch[1]!) - 1;
    return `books.${idx}.title`;
  }

  // attribute_1..12 → books.0..11.author
  const attrMatch = paramName.match(/^attribute_(\d+)$/);
  if (attrMatch) {
    const idx = parseInt(attrMatch[1]!) - 1;
    return `books.${idx}.author`;
  }

  // Positional params (sbtemp_* style): {{1}}=name, {{2}}=order link,
  // then odd=title, even=author starting from 3
  const posMatch = paramName.match(/^(\d+)$/);
  if (posMatch) {
    const pos = parseInt(posMatch[1]!);
    if (pos === 1) return "teacher.name";
    if (pos === 2) return "order.link";
    if (pos >= 3) {
      const bookIdx = Math.floor((pos - 3) / 2);
      const isTitle = (pos - 3) % 2 === 0;
      return isTitle ? `books.${bookIdx}.title` : `books.${bookIdx}.author`;
    }
  }

  return "";
}

function defaultParamsFromVars(vars: string[]): WatiTemplateParam[] {
  return vars.map((v) => ({ paramName: v, dataPath: autoMapParam(v), fallback: "" }));
}

// ─── Form Modal ───────────────────────────────────────────────────────────────

interface FormModalProps {
  initial: WatiTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}

function FormModal({ initial, onClose, onSaved }: FormModalProps) {
  const isEdit = !!initial;
  const [templateName, setTemplateName] = useState(initial?.templateName ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [bodyPreview, setBodyPreview] = useState(initial?.bodyPreview ?? "");
  const [params, setParams] = useState<WatiTemplateParam[]>(initial?.params ?? []);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleParseBody = async () => {
    if (!bodyPreview.trim()) return;
    setParsing(true);
    try {
      const res = await parseWatiVariables(bodyPreview);
      // Merge: keep existing mappings for vars that already exist
      const existing = new Map(params.map((p) => [p.paramName, p]));
      setParams(
        res.variables.map((v) => existing.get(v) ?? { paramName: v, dataPath: "", fallback: "" })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setParsing(false);
    }
  };

  const updateParam = (idx: number, field: keyof WatiTemplateParam, value: string) => {
    setParams((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const handleSave = async () => {
    if (!templateName.trim() || !displayName.trim()) {
      setError("Template name and display name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { templateName, displayName, bodyPreview: bodyPreview || undefined, params };
      if (isEdit) {
        await updateWatiTemplate(initial!.id, payload);
      } else {
        await createWatiTemplate(payload);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Portal>
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-xl bg-card border border-border shadow-xl my-8">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? "Edit Template" : "Add WATI Template"}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">{error}</div>
          )}

          {/* Names row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">WATI Template Name *</label>
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. spemst_4"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">Exact name from WATI dashboard</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Display Name *</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Specimen Dispatch (4 books)"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Body preview */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-foreground">Template Body (paste from WATI)</label>
              <button
                onClick={handleParseBody}
                disabled={parsing || !bodyPreview.trim()}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-40 transition-colors"
              >
                {parsing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Auto-detect variables
              </button>
            </div>
            <textarea
              value={bodyPreview}
              onChange={(e) => setBodyPreview(e.target.value)}
              rows={8}
              placeholder="Paste the WATI template body here. Variables like {{name}}, {{bookname1}} will be auto-detected."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Variable mappings */}
          {params.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-sm font-medium text-foreground">Variable Mappings</label>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{params.length} variables</span>
              </div>
              <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-[120px_1fr_120px] gap-3 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                  <span>Variable</span>
                  <span>Data Path</span>
                  <span>Fallback</span>
                </div>
                {params.map((p, idx) => (
                  <div key={p.paramName} className="grid grid-cols-[120px_1fr_120px] gap-3 px-3 py-2 items-center">
                    <code className="text-xs font-mono text-foreground bg-muted px-1.5 py-0.5 rounded truncate">
                      {`{{${p.paramName}}}`}
                    </code>
                    <select
                      value={p.dataPath}
                      onChange={(e) => updateParam(idx, "dataPath", e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">— select path —</option>
                      {DATA_PATHS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                    <input
                      value={p.fallback}
                      onChange={(e) => updateParam(idx, "fallback", e.target.value)}
                      placeholder="fallback"
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Fallback is used when the data path is empty (e.g. teacher has fewer books than the template expects).
              </p>
            </div>
          )}

          {params.length === 0 && bodyPreview.trim() && (
            <p className="text-xs text-muted-foreground text-center py-1">
              Click "Auto-detect variables" to extract <code className="font-mono">{`{{variable}}`}</code> names from the body.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : <><Check className="h-4 w-4" />{isEdit ? "Save Changes" : "Create Template"}</>}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ─── Preview Modal ────────────────────────────────────────────────────────────

function PreviewModal({ tmpl, onClose }: { tmpl: WatiTemplate; onClose: () => void }) {
  const [result, setResult] = useState<{ name: string; value: string }[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    previewWatiTemplate(tmpl.id)
      .then((r) => setResult(r.params))
      .catch((e) => setError(e instanceof Error ? e.message : "Preview failed"))
      .finally(() => setLoading(false));
  }, [tmpl.id]);

  // Build rendered body by substituting values
  const rendered = result
    ? (tmpl.bodyPreview ?? "").replace(/\{\{([^}]+)\}\}/g, (_, name) => {
        const v = result.find((r) => r.name === name.trim());
        return v?.value ? `*${v.value}*` : `[${name}]`;
      })
    : null;

  return (
    <Portal>
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-xl bg-card border border-border shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Preview: {tmpl.displayName}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Using sample data</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {loading && <div className="py-6 text-center text-sm text-muted-foreground">Loading preview…</div>}
          {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">{error}</div>}

          {result && (
            <>
              {/* Resolved params table */}
              <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                <div className="grid grid-cols-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                  <span>Parameter</span><span>Resolved Value</span>
                </div>
                {result.map((r) => (
                  <div key={r.name} className="grid grid-cols-2 px-3 py-2 text-sm">
                    <code className="text-xs font-mono text-muted-foreground">{`{{${r.name}}}`}</code>
                    <span className="text-foreground truncate">{r.value || <em className="text-muted-foreground">empty</em>}</span>
                  </div>
                ))}
              </div>

              {/* Rendered body */}
              {tmpl.bodyPreview && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Rendered message</p>
                  <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 px-4 py-3 text-sm whitespace-pre-line text-foreground leading-relaxed font-sans">
                    {rendered}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end border-t border-border px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted transition-colors">Close</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ─── Template Card ────────────────────────────────────────────────────────────

interface TemplateCardProps {
  tmpl: WatiTemplate;
  onEdit: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onPreview: () => void;
}

function TemplateCard({ tmpl, onEdit, onActivate, onDeactivate, onPreview }: TemplateCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-xl border ${tmpl.isActive ? "border-emerald-500/50 bg-emerald-50/30 dark:bg-emerald-950/10" : "border-border bg-card"} overflow-hidden`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status dot */}
        <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${tmpl.isActive ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground text-sm">{tmpl.displayName}</span>
            {tmpl.isActive && (
              <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Active
              </span>
            )}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">{tmpl.templateName}</code>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{tmpl.params.length} parameters mapped</p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onPreview} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Preview with sample data">
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button onClick={onEdit} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {tmpl.isActive ? (
            <button onClick={onDeactivate} className="rounded-md p-1.5 text-muted-foreground hover:bg-amber-100 hover:text-amber-600 dark:hover:bg-amber-950 transition-colors" title="Deactivate">
              <ZapOff className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button onClick={onActivate} className="rounded-md p-1.5 text-muted-foreground hover:bg-emerald-100 hover:text-emerald-600 dark:hover:bg-emerald-950 transition-colors" title="Set as active">
              <Zap className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => setExpanded((v) => !v)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted transition-colors">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded: show param mappings + body */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/20">
          {tmpl.params.length > 0 && (
            <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_80px] px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <span>Variable</span><span>Data Path</span><span>Fallback</span>
              </div>
              {tmpl.params.map((p) => (
                <div key={p.paramName} className="grid grid-cols-[1fr_1fr_80px] px-3 py-2 text-xs">
                  <code className="font-mono text-muted-foreground">{`{{${p.paramName}}}`}</code>
                  <span className="text-foreground">{p.dataPath ? labelForPath(p.dataPath) : <em className="text-muted-foreground">not mapped</em>}</span>
                  <span className="text-muted-foreground font-mono truncate">{p.fallback || "—"}</span>
                </div>
              ))}
            </div>
          )}
          {tmpl.bodyPreview && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Template body</p>
              <pre className="rounded-lg bg-muted px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed text-foreground font-mono">
                {tmpl.bodyPreview}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sync from WATI Modal ─────────────────────────────────────────────────────

function SyncFromWatiModal({
  existing,
  onClose,
  onImported,
}: {
  existing: WatiTemplate[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [remoteTemplates, setRemoteTemplates] = useState<WatiRemoteTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchWatiTemplatesFromApi()
      .then((r) => setRemoteTemplates(r.templates))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to fetch from WATI"))
      .finally(() => setLoading(false));
  }, []);

  const existingNames = new Set(existing.map((t) => t.templateName));

  const importTemplate = async (tmpl: WatiRemoteTemplate) => {
    setImporting((s) => new Set(s).add(tmpl.elementName));
    try {
      // Prefer bodyOriginal — it has named params like {{name}}, {{bookname1}}
      // body has numbered params like {{1}}, {{2}} which are not useful for mapping
      const body = tmpl.bodyOriginal ?? tmpl.body ?? "";
      // parse variables from body
      let vars: string[] = [];
      try {
        const res = await parseWatiVariables(body);
        vars = res.variables;
      } catch { /* ignore */ }

      await createWatiTemplate({
        templateName: tmpl.elementName,
        displayName: tmpl.elementName,
        bodyPreview: body,
        params: vars.map((v) => ({ paramName: v, dataPath: autoMapParam(v), fallback: "" })),
      });
      setImported((s) => new Set(s).add(tmpl.elementName));
      onImported();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting((s) => { const n = new Set(s); n.delete(tmpl.elementName); return n; });
    }
  };

  const importAll = async () => {
    const toImport = remoteTemplates.filter(
      (t) => !existingNames.has(t.elementName) && !imported.has(t.elementName)
    );
    for (const tmpl of toImport) {
      await importTemplate(tmpl);
    }
  };

  const newCount = remoteTemplates.filter(
    (t) => !existingNames.has(t.elementName) && !imported.has(t.elementName)
  ).length;

  return (
    <Portal>
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-xl bg-card border border-border shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">Sync Templates from WATI</h2>
            {!loading && !error && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {remoteTemplates.length} templates found · {newCount} new
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-2">
          {loading && (
            <div className="py-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Fetching from WATI…
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              <p className="font-medium">Failed to connect to WATI</p>
              <p className="mt-0.5 text-xs opacity-80">{error}</p>
              <p className="mt-2 text-xs">Make sure <code className="font-mono">WATI_BASE_URL</code> and <code className="font-mono">WATI_API_KEY</code> are set in your backend <code className="font-mono">.env</code>.</p>
            </div>
          )}

          {!loading && !error && remoteTemplates.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No templates found in your WATI account.</p>
          )}

          {remoteTemplates.map((tmpl) => {
            const alreadyExists = existingNames.has(tmpl.elementName);
            const isImporting = importing.has(tmpl.elementName);
            const isImported = imported.has(tmpl.elementName);
            const isNew = !alreadyExists && !isImported;

            return (
              <div
                key={tmpl.id}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
                  alreadyExists || isImported
                    ? "border-muted bg-muted/20 opacity-60"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-mono font-medium text-foreground">{tmpl.elementName}</code>
                    <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                      tmpl.status === "APPROVED"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-amber-500/10 text-amber-600"
                    }`}>
                      {tmpl.status}
                    </span>
                    {tmpl.language && (
                      <span className="text-xs text-muted-foreground">
                        {typeof tmpl.language === "string" ? tmpl.language : tmpl.language.text}
                      </span>
                    )}
                  </div>
                  {(tmpl.bodyOriginal ?? tmpl.body) && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{tmpl.bodyOriginal ?? tmpl.body}</p>
                  )}
                </div>
                <div className="shrink-0 mt-0.5">
                  {alreadyExists || isImported ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Check className="h-3.5 w-3.5" /> {isImported ? "Imported" : "Exists"}
                    </span>
                  ) : (
                    <button
                      onClick={() => importTemplate(tmpl)}
                      disabled={isImporting}
                      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50 transition-colors"
                    >
                      {isImporting ? (
                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      Import
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-4 shrink-0">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted transition-colors">Close</button>
          {newCount > 0 && (
            <button
              onClick={importAll}
              disabled={importing.size > 0}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Download className="h-4 w-4" />
              Import All {newCount} New
            </button>
          )}
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WatiTemplatesPage() {
  const [templates, setTemplates] = useState<WatiTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<WatiTemplate | null>(null);
  const [previewTarget, setPreviewTarget] = useState<WatiTemplate | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await listWatiTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleActivate = async (tmpl: WatiTemplate) => {
    try { await activateWatiTemplate(tmpl.id); load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Activate failed"); }
  };

  const handleDeactivate = async (tmpl: WatiTemplate) => {
    try { await deactivateWatiTemplate(tmpl.id); load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Deactivate failed"); }
  };

  const activeTemplates = templates.filter((t) => t.isActive);
  const totalPages = Math.ceil(templates.length / pageSize);
  const pagedTemplates = useMemo(
    () => templates.slice((page - 1) * pageSize, page * pageSize),
    [templates, page, pageSize]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">WATI Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage WhatsApp message templates and map their variables to order data fields.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowSync(true)}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Download className="h-4 w-4" />
            Sync from WATI
          </button>
          <button
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Template
          </button>
        </div>
      </div>

      {/* Active templates banner */}
      {activeTemplates.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20 px-4 py-3">
          <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            {activeTemplates.length} active template{activeTemplates.length > 1 ? 's' : ''} —{' '}
            <span className="font-normal">{activeTemplates.map((t) => t.templateName).join(', ')}</span>
          </p>
        </div>
      )}

      {activeTemplates.length === 0 && !loading && templates.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3">
          <ZapOff className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            No active templates — WhatsApp messages cannot be sent until you activate at least one.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {/* List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="py-16 text-center">
          <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No templates yet. Add your first WATI template above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pagedTemplates.map((tmpl) => (
            <TemplateCard
              key={tmpl.id}
              tmpl={tmpl}
              onEdit={() => { setEditTarget(tmpl); setShowForm(true); }}
              onActivate={() => handleActivate(tmpl)}
              onDeactivate={() => handleDeactivate(tmpl)}
              onPreview={() => setPreviewTarget(tmpl)}
            />
          ))}
          <div className="flex items-center justify-between px-1">
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {[10, 20, 50, 100].map((s) => (
                <option key={s} value={s}>{s} / page</option>
              ))}
            </select>
            <Pagination page={page} totalPages={totalPages} total={templates.length} onPageChange={setPage} />
          </div>
        </div>
      )}

      {/* Mapping guide */}
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-xs font-medium text-foreground mb-2">Available Data Paths</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {DATA_PATHS.map((d) => (
            <div key={d.value} className="flex items-center gap-1.5">
              <code className="text-xs font-mono text-muted-foreground">{d.value}</code>
              <span className="text-xs text-muted-foreground">→ {d.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <FormModal
          initial={editTarget}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
          onSaved={() => { setShowForm(false); setEditTarget(null); load(); }}
        />
      )}

      {/* Preview Modal */}
      {previewTarget && (
        <PreviewModal tmpl={previewTarget} onClose={() => setPreviewTarget(null)} />
      )}

      {/* Sync from WATI Modal */}
      {showSync && (
        <SyncFromWatiModal
          existing={templates}
          onClose={() => setShowSync(false)}
          onImported={() => load()}
        />
      )}
    </div>
  );
}
