"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Download,
  MessageCircle,
  Mail,
  Users,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  X,
} from "lucide-react";
import { toast } from "sonner";
import FileUploadZone from "@/components/FileUploadZone";
import DataTable, { type Column } from "@/components/DataTable";
import type { UploadRow } from "@/types";
import * as XLSX from "xlsx";
import { useRouter } from "next/navigation";
import { uploadSpecimen, checkDuplicatesAgainstDB, lookupBookCodes, searchAlgolia, createBookMapping, type DBDuplicateMatch, type AlgoliaHit } from "@/services/api";
import { Portal } from "@/components/Portal";

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

const TEMPLATE_HEADERS = [
  "Record Id", "Books Assigned", "Teacher Owner.id", "Teacher Owner",
  "First Name", "Last Name", "Teacher Name", "Institution Name.id", "Institution Name",
  "Email", "Phone", "Salutation",
];
const TEMPLATE_EXAMPLE: Record<string, string> = {
  "Record Id": "REC001",
  "Books Assigned": "Math 10, Science 10",
  "Teacher Owner.id": "owner-1",
  "Teacher Owner": "John Doe",
  "First Name": "Example",
  "Last Name": "Teacher",
  "Teacher Name": "Example Teacher",
  "Institution Name.id": "inst-1",
  "Institution Name": "School Name",
  "Email": "teacher@school.com",
  "Phone": "+919876543210",
  "Salutation": "Mr",
};

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function toNumericString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return String(Math.floor(value));
  }
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (/^\d*\.?\d+[eE][+-]?\d+$/.test(s)) {
    const num = parseFloat(s);
    if (!Number.isNaN(num)) return String(Math.floor(num));
  }
  return s;
}

function mapRowToUploadRow(row: Record<string, unknown>): UploadRow {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    lower[k.trim().toLowerCase().replace(/\s+/g, " ")] = toNumericString(v ?? "").trim();
  }
  const get = (keys: string[]) => {
    for (const k of keys) {
      const v = lower[k];
      if (v) return v;
    }
    return "";
  };
  const firstName = get(["first name", "firstname"]);
  const lastName = get(["last name", "lastname"]);
  const salutation = get(["salutation"]);
  const rawName =
    get(["name", "teacher name", "teachername"]) ||
    [firstName, lastName].filter(Boolean).join(" ").trim();
  // Prepend salutation if present and not already part of the name
  const name = salutation && rawName && !rawName.toLowerCase().startsWith(salutation.toLowerCase())
    ? `${salutation} ${rawName}`
    : rawName;
  return {
    name: name || "",
    phone: get(["phone"]) || "",
    email: get(["email"]) || "",
    school: get(["school", "institution name", "institutionname", "instituition name", "instituitionname", "instituition name.id", "institution name.id"]) || "",
    books: get(["books", "books assigned", "booksassigned"]) || "",
    recordId: get(["record id", "recordid"]) || undefined,
    booksAssigned: get(["books assigned", "booksassigned"]) || undefined,
    teacherOwnerId: get(["teacher owner.id", "teacher owner id", "teacherownerid"]) || undefined,
    teacherOwner: get(["teacher owner", "teacherowner"]) || undefined,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    institutionId: get(["institution name.id", "institution name id", "institutionid", "instituition name.id", "instituition's id"]) || undefined,
    institutionName: get(["institution name", "institutionname", "instituition name", "instituitionname"]) || undefined,
    salutation: get(["salutation"]) || undefined,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChannelOption = "whatsapp" | "email" | "both";
type Step = 1 | 2 | 3 | 4;

type MergeDecision =
  | { action: "merge"; nameChoice: "file" | "db" }
  | { action: "create_new" }
  | { action: "use_db"; teacherId?: string } // teacherId required for split matches
  | null; // null = not yet decided

type SheetDuplicateGroup = {
  key: string;
  type: "phone" | "email" | "combined";
  value: string;
  matchReasons: string[]; // e.g. ["Phone: 6399989772", "Email: khwaish@gmail.com"]
  rowIndices: number[];
};

type SheetMergeConfig = {
  chosenName: string;
  chosenPhones: Set<string>;
  chosenEmails: Set<string>;
  primaryPhone: string;
  primaryEmail: string;
};

// Detect duplicates within the uploaded file itself
function findInSheetDuplicates(rows: UploadRow[]): SheetDuplicateGroup[] {
  // Collect raw duplicate signals (phone & email)
  const phoneGroups = new Map<string, number[]>();
  const emailGroups = new Map<string, number[]>();

  rows.forEach((row, idx) => {
    if (row.phone) {
      const n = row.phone.replace(/\D/g, "").replace(/^0+/, "");
      if (n) {
        if (!phoneGroups.has(n)) phoneGroups.set(n, []);
        phoneGroups.get(n)!.push(idx);
      }
    }
    if (row.email) {
      const n = row.email.toLowerCase().trim();
      if (n) {
        if (!emailGroups.has(n)) emailGroups.set(n, []);
        emailGroups.get(n)!.push(idx);
      }
    }
  });

  // Union-find to merge overlapping groups (e.g. same email + same phone → 1 group)
  const parent = new Map<number, number>();
  function find(x: number): number {
    if (!parent.has(x)) return x;
    const root = find(parent.get(x)!);
    parent.set(x, root);
    return root;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  // Union all rows that share a phone
  for (const [, indices] of phoneGroups) {
    if (indices.length > 1) {
      for (let i = 1; i < indices.length; i++) union(indices[0], indices[i]);
    }
  }
  // Union all rows that share an email
  for (const [, indices] of emailGroups) {
    if (indices.length > 1) {
      for (let i = 1; i < indices.length; i++) union(indices[0], indices[i]);
    }
  }

  // Collect connected components
  const components = new Map<number, number[]>();
  const allDupRows = new Set<number>();
  for (const [, indices] of phoneGroups) { if (indices.length > 1) indices.forEach((i) => allDupRows.add(i)); }
  for (const [, indices] of emailGroups) { if (indices.length > 1) indices.forEach((i) => allDupRows.add(i)); }

  for (const idx of allDupRows) {
    const root = find(idx);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(idx);
  }

  // Build final groups with match type info
  const groups: SheetDuplicateGroup[] = [];
  for (const [, members] of components) {
    if (members.length < 2) continue;
    members.sort((a, b) => a - b);

    // Collect all match signals for this group
    const memberSet = new Set(members);
    const matchReasons: string[] = [];
    const matchedPhones: string[] = [];
    const matchedEmails: string[] = [];

    for (const [phone, indices] of phoneGroups) {
      if (indices.length > 1 && indices.some((i) => memberSet.has(i))) {
        matchedPhones.push(phone);
        matchReasons.push(`Phone: ${phone}`);
      }
    }
    for (const [email, indices] of emailGroups) {
      if (indices.length > 1 && indices.some((i) => memberSet.has(i))) {
        matchedEmails.push(email);
        matchReasons.push(`Email: ${email}`);
      }
    }

    const hasPhone = matchedPhones.length > 0;
    const hasEmail = matchedEmails.length > 0;
    const type: "phone" | "email" | "combined" = hasPhone && hasEmail ? "combined" : hasPhone ? "phone" : "email";
    const value = matchedPhones[0] || matchedEmails[0] || "";
    const key = `${type}:${members.join("-")}`;

    groups.push({ key, type, value, matchReasons, rowIndices: members });
  }

  groups.sort((a, b) => (a.rowIndices[0] ?? 0) - (b.rowIndices[0] ?? 0));
  return groups;
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS = [
  { id: 1, label: "Preview" },
  { id: 2, label: "Channels" },
  { id: 3, label: "File Review" },
  { id: 4, label: "DB Review" },
];

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const isCompleted = current > step.id;
        const isCurrent = current === step.id;
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={[
                "flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                isCompleted ? "border-primary bg-primary text-primary-foreground"
                  : isCurrent ? "border-primary bg-card text-primary"
                  : "border-border bg-card text-muted-foreground",
              ].join(" ")}>
                {isCompleted ? <CheckCircle className="h-3 w-3" /> : step.id}
              </div>
              <span className={["mt-0.5 text-[10px] font-medium", isCurrent ? "text-primary" : "text-muted-foreground"].join(" ")}>
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={["mb-3 h-0.5 w-6 transition-colors", isCompleted ? "bg-primary" : "bg-border"].join(" ")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel pill toggle (per-teacher)
// ---------------------------------------------------------------------------

function ChannelPill({
  value,
  onChange,
  hasPhone,
  hasEmail,
}: {
  value: ChannelOption;
  onChange: (v: ChannelOption) => void;
  hasPhone: boolean;
  hasEmail: boolean;
}) {
  const opts: { key: ChannelOption; label: string; disabled: boolean }[] = [
    { key: "whatsapp", label: "W", disabled: !hasPhone },
    { key: "email",    label: "E", disabled: !hasEmail },
    { key: "both",     label: "B", disabled: !hasPhone || !hasEmail },
  ];
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
      {opts.map((opt) => (
        <button
          key={opt.key}
          type="button"
          disabled={opt.disabled}
          onClick={() => !opt.disabled && onChange(opt.key)}
          title={opt.disabled ? "Contact info missing" : opt.key}
          className={[
            "px-2.5 py-1 transition-colors",
            value === opt.key && !opt.disabled
              ? opt.key === "whatsapp" ? "bg-green-600 text-white"
                : opt.key === "email" ? "bg-primary text-primary-foreground"
                : "bg-purple-600 text-white"
              : opt.disabled
              ? "bg-muted/30 text-muted-foreground/40 cursor-not-allowed"
              : "bg-card text-muted-foreground hover:bg-muted",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global channel card
// ---------------------------------------------------------------------------

function ChannelCard({
  value, selected, onSelect, icon, label, description, accentClass,
}: {
  value: ChannelOption; selected: boolean; onSelect: (v: ChannelOption) => void;
  icon: React.ReactNode; label: string; description: string; accentClass: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={[
        "flex flex-col items-center gap-3 rounded-xl border-2 p-5 text-center transition-all",
        selected ? `${accentClass} border-current` : "border-border bg-card hover:border-muted-foreground/50",
      ].join(" ")}
    >
      <div className={["rounded-full p-3", selected ? "bg-white/20" : "bg-muted"].join(" ")}>
        {icon}
      </div>
      <div>
        <p className="font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className={["h-4 w-4 rounded-full border-2", selected ? "border-white bg-white" : "border-muted-foreground"].join(" ")} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const previewColumns: Column<UploadRow>[] = [
  { key: "recordId", header: "Record Id", mobileHidden: true },
  { key: "name", header: "Teacher Name" },
  { key: "phone", header: "Phone" },
  { key: "email", header: "Email" },
  { key: "school", header: "Institution", mobileHidden: true },
  { key: "books", header: "Books", mobileHidden: true },
];

export default function UploadPage() {
  const router = useRouter();

  const [parsedRows, setParsedRows] = useState<UploadRow[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [step, setStep] = useState<Step>(1);

  // Step 2
  const [globalChannel, setGlobalChannel] = useState<ChannelOption>("both");
  const [perTeacherChannel, setPerTeacherChannel] = useState<Map<number, ChannelOption>>(new Map());
  const [channelTablePage, setChannelTablePage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  // Step 3
  const [inSheetDuplicates, setInSheetDuplicates] = useState<SheetDuplicateGroup[]>([]);
  const [skippedRows, setSkippedRows] = useState<Set<number>>(new Set());
  // Set of group keys that have been merged (all extras skipped, first row kept)
  const [mergedSheetGroups, setMergedSheetGroups] = useState<Set<string>>(new Set());
  // Chosen name/phones/emails per merged group key
  const [sheetMergeConfigs, setSheetMergeConfigs] = useState<Map<string, SheetMergeConfig>>(new Map());
  // Dialog state: which group is currently being configured for merge
  const [mergeDialogGroup, setMergeDialogGroup] = useState<SheetDuplicateGroup | null>(null);
  const [pendingConfig, setPendingConfig] = useState<SheetMergeConfig | null>(null);
  const [isDuplicateChecking, setIsDuplicateChecking] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<DBDuplicateMatch[] | null>(null);
  // Map<rowIndex, MergeDecision>
  const [mergeDecisions, setMergeDecisions] = useState<Map<number, MergeDecision>>(new Map());
  // Unmapped book codes: codes in the file that have no entry in book_mappings
  const [unmappedBookCodes, setUnmappedBookCodes] = useState<string[] | null>(null);
  const [mappedBookDetails, setMappedBookDetails] = useState<Array<{ bookCode: string; productTitle: string; edition?: string | null; coverUrl?: string | null }>>([]);

  const [isUploading, setIsUploading] = useState(false);

  // Quick-map modal (for unmapped book codes — supports multiple products per code)
  const [quickMapCode, setQuickMapCode] = useState<string | null>(null);
  const [quickMapQuery, setQuickMapQuery] = useState("");
  const [quickMapHits, setQuickMapHits] = useState<AlgoliaHit[]>([]);
  const [quickMapSearching, setQuickMapSearching] = useState(false);
  const [quickMapSaving, setQuickMapSaving] = useState(false);
  const [quickMapSelected, setQuickMapSelected] = useState<AlgoliaHit | null>(null);
  const [quickMapProducts, setQuickMapProducts] = useState<Array<{ productId: string; productTitle: string; authors: Array<{id: string; title: string}>; edition?: string | null; coverUrl?: string | null }>>([]);

  // ---------------------------------------------------------------------------
  // File parsing
  // ---------------------------------------------------------------------------

  const handleFileSelect = useCallback((file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "csv"].includes(ext ?? "")) {
      toast.error("Please upload an Excel (.xlsx) or CSV (.csv) file");
      return;
    }
    setSelectedFile(file);
    setIsParsing(true);
    setParsedRows([]);
    setStep(1);
    setPerTeacherChannel(new Map());
    setDuplicateMatches(null);
    setMergeDecisions(new Map());
    setInSheetDuplicates([]);
    setSkippedRows(new Set());
    setMergedSheetGroups(new Set());
    setSheetMergeConfigs(new Map());
    setMergeDialogGroup(null);
    setPendingConfig(null);
    setUnmappedBookCodes(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = e.target?.result;
        if (!result || !(result instanceof ArrayBuffer)) { toast.error("Could not read file"); setIsParsing(false); return; }
        const data = new Uint8Array(result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) { toast.error("File has no sheets"); setIsParsing(false); return; }
        const worksheet = workbook.Sheets[sheetName];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: true });
        const json: UploadRow[] = raw.map((row) => mapRowToUploadRow(row));
        if (json.length === 0) { toast.error("No data rows found in file"); setIsParsing(false); return; }
        setParsedRows(json);
        toast.success(`Parsed ${json.length} rows from ${file.name}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to parse file");
      } finally {
        setIsParsing(false);
      }
    };
    reader.onerror = () => { setIsParsing(false); toast.error("Failed to read file"); };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleCancel = useCallback(() => {
    setParsedRows([]);
    setSelectedFile(null);
    setStep(1);
    setPerTeacherChannel(new Map());
    setDuplicateMatches(null);
    setMergeDecisions(new Map());
    setInSheetDuplicates([]);
    setSkippedRows(new Set());
    setMergedSheetGroups(new Set());
    setSheetMergeConfigs(new Map());
    setMergeDialogGroup(null);
    setPendingConfig(null);
    setUnmappedBookCodes(null);
  }, []);

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      TEMPLATE_HEADERS.map((h) => TEMPLATE_EXAMPLE[h] ?? ""),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Teachers");
    XLSX.writeFile(wb, "specimen_template.xlsx");
  };

  // ---------------------------------------------------------------------------
  // Channel helpers
  // ---------------------------------------------------------------------------

  // When global channel changes, reset all per-teacher overrides
  const handleGlobalChannelChange = (ch: ChannelOption) => {
    setGlobalChannel(ch);
    setPerTeacherChannel(new Map());
  };

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    setChannelTablePage(1);
  };

  const getEffectiveChannel = (idx: number): ChannelOption =>
    perTeacherChannel.get(idx) ?? globalChannel;

  const setTeacherChannel = (idx: number, ch: ChannelOption) => {
    setPerTeacherChannel((prev) => {
      const next = new Map(prev);
      // If matches global, remove override (clean)
      if (ch === globalChannel) {
        next.delete(idx);
      } else {
        next.set(idx, ch);
      }
      return next;
    });
  };

  const overrideCount = perTeacherChannel.size;

  // Filtered + paginated rows for channel table
  // Each item keeps its original index (globalIdx) so channel overrides still map correctly
  const filteredIndexedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return parsedRows.map((row, idx) => ({ row, globalIdx: idx }));
    return parsedRows
      .map((row, idx) => ({ row, globalIdx: idx }))
      .filter(({ row }) =>
        (row.name ?? "").toLowerCase().includes(q) ||
        (row.phone ?? "").toLowerCase().includes(q) ||
        (row.email ?? "").toLowerCase().includes(q)
      );
  }, [parsedRows, searchQuery]);

  const channelTableTotalPages = Math.ceil(filteredIndexedRows.length / PAGE_SIZE);
  const channelTableRows = useMemo(
    () => filteredIndexedRows.slice((channelTablePage - 1) * PAGE_SIZE, channelTablePage * PAGE_SIZE),
    [filteredIndexedRows, channelTablePage]
  );

  // ---------------------------------------------------------------------------
  // Step navigation
  // ---------------------------------------------------------------------------

  // Step 3: Within-file duplicate check (instant, client-side)
  const goToStep3 = () => {
    setStep(3);
    setSkippedRows(new Set());
    setMergedSheetGroups(new Set());
    setSheetMergeConfigs(new Map());
    setMergeDialogGroup(null);
    setPendingConfig(null);

    const sheetGroups = findInSheetDuplicates(parsedRows);
    setInSheetDuplicates(sheetGroups);
  };

  // Step 4: DB duplicate check + book code lookup (async)
  const goToStep4 = async () => {
    setStep(4);
    setDuplicateMatches(null);
    setMergeDecisions(new Map());
    setUnmappedBookCodes(null);

    setIsDuplicateChecking(true);
    try {
      // Only check surviving rows (exclude rows skipped/merged in Step 3)
      const rowsToCheck = parsedRows.map((r, idx) => {
        if (skippedRows.has(idx)) return null; // merged away — skip
        let matchName = r.name ?? "";
        if (r.salutation && matchName.startsWith(r.salutation)) {
          matchName = matchName.slice(r.salutation.length).trim();
        }
        return { name: matchName, phone: r.phone ?? "", email: r.email ?? "", school: r.school ?? "", _origIdx: idx };
      }).filter((r): r is NonNullable<typeof r> => r !== null);

      // Collect all unique book codes from surviving rows only
      const allCodes = new Set<string>();
      for (let idx = 0; idx < parsedRows.length; idx++) {
        if (skippedRows.has(idx)) continue;
        const row = parsedRows[idx];
        const books = (row.books ?? row.booksAssigned ?? "").trim();
        if (books) {
          for (const code of books.split(",")) {
            const c = code.trim();
            if (c) allCodes.add(c);
          }
        }
      }

      // Build index remap: API rowIndex → original parsedRows index
      const filteredToOriginal = rowsToCheck.map((r) => r._origIdx);
      // Send to API without _origIdx
      const apiRows = rowsToCheck.map(({ _origIdx, ...rest }) => rest);

      const [rawMatches, bookLookupResult] = await Promise.all([
        checkDuplicatesAgainstDB(apiRows),
        allCodes.size > 0
          ? lookupBookCodes([...allCodes])
              .then((res) => ({ ok: true as const, mappings: res.mappings }))
              .catch(() => ({ ok: false as const, mappings: [] }))
          : Promise.resolve({ ok: true as const, mappings: [] }),
      ]);

      // Remap rowIndex back to original parsedRows indices
      const matches = rawMatches.map((m) => ({
        ...m,
        rowIndex: filteredToOriginal[m.rowIndex] ?? m.rowIndex,
      }));

      setDuplicateMatches(matches);

      if (bookLookupResult.ok) {
        const mappedCodes = new Set(bookLookupResult.mappings.map((m) => m.bookCode));
        setUnmappedBookCodes([...allCodes].filter((c) => !mappedCodes.has(c)));
        setMappedBookDetails(bookLookupResult.mappings.map((m) => ({ bookCode: m.bookCode, productTitle: m.productTitle, edition: m.edition, coverUrl: m.coverUrl })));
      }

      // Default: use_db for all matches
      // Split matches: auto-select phone-matched teacher first; fall back to email-matched
      const defaults = new Map<number, MergeDecision>();
      for (const m of matches) {
        if (m.isSplitMatch) {
          const autoTeacherId = m.phoneMatchTeacher?.id ?? m.emailMatchTeacher?.id;
          defaults.set(m.rowIndex, { action: "use_db", teacherId: autoTeacherId });
        } else {
          defaults.set(m.rowIndex, { action: "use_db" });
        }
      }
      setMergeDecisions(defaults);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to check duplicates");
      setDuplicateMatches([]);
      setMergeDecisions(new Map());
      setUnmappedBookCodes(null);
    } finally {
      setIsDuplicateChecking(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Final submit
  // ---------------------------------------------------------------------------

  const handleCreateBatch = async () => {
    if (!selectedFile || parsedRows.length === 0) return;

    // Validate: all merge decisions with nameConflict must have a name choice
    if (duplicateMatches) {
      const unresolved = duplicateMatches.filter((m) => {
        const d = mergeDecisions.get(m.rowIndex);
        return d?.action === "merge" && m.diff.nameConflict && !d.nameChoice;
      });
      if (unresolved.length > 0) {
        toast.error(`Please choose a name for ${unresolved.length} merge(s) with name conflicts`);
        return;
      }
    }

    setIsUploading(true);
    try {
      // Send all rows' channels (aligned to original indices — backend uses same indices)
      const teacherChannels = parsedRows.map((_, idx) => getEffectiveChannel(idx));

      // Skipped rows from in-sheet duplicate review
      const skippedRowIndices = skippedRows.size > 0 ? [...skippedRows] : undefined;

      // Serialize approved merge decisions (original rowIndex — no remapping needed)
      const serializedDecisions = duplicateMatches
        ? duplicateMatches
            .filter((match) => !skippedRows.has(match.rowIndex))
            .map((match) => {
              const decision = mergeDecisions.get(match.rowIndex);
              if (!decision) return null;
              if (decision.action === "create_new") {
                return { rowIndex: match.rowIndex, action: "create_new" as const };
              }
              if (decision.action === "use_db") {
                // Link to DB teacher ID but don't update DB record — file's phone/email used for sending
                // For split matches, decision.teacherId holds the user-chosen teacher
                const teacherId = (decision as { action: "use_db"; teacherId?: string }).teacherId ?? match.existingTeacher.id;
                return {
                  rowIndex: match.rowIndex,
                  action: "merge" as const,
                  teacherId,
                  nameChoice: "db" as const,
                  noChanges: true, // don't update DB record
                  phonesToAdd: [] as string[],
                  emailsToAdd: [] as string[],
                };
              }
              return {
                rowIndex: match.rowIndex,
                action: "merge" as const,
                teacherId: match.existingTeacher.id,
                nameChoice: decision.nameChoice,
                noChanges: match.diff.noChanges,
                phonesToAdd: match.diff.phonesToAdd,
                emailsToAdd: match.diff.emailsToAdd,
                newName: decision.nameChoice === "file" ? match.row.name : undefined,
              };
            })
            .filter((d): d is NonNullable<typeof d> => d !== null)
        : [];

      const result = await uploadSpecimen(selectedFile, globalChannel, teacherChannels, serializedDecisions, skippedRowIndices);
      toast.success(`Batch created with ${result.rowCount} teachers`);
      router.push(`/batches/${result.batchId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Derived counts
  // ---------------------------------------------------------------------------

  const channelCounts = useMemo(() => ({
    phoneOnly: parsedRows.filter((r) => r.phone && !r.email).length,
    emailOnly: parsedRows.filter((r) => !r.phone && r.email).length,
    both: parsedRows.filter((r) => r.phone && r.email).length,
    neither: parsedRows.filter((r) => !r.phone && !r.email).length,
  }), [parsedRows]);

  const estimatedOrders = parsedRows.reduce(
    (acc, row) => acc + (row.books ? row.books.split(",").length : 0),
    0
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Quick-map modal handlers
  // ---------------------------------------------------------------------------

  const openQuickMap = (code: string) => {
    setQuickMapCode(code);
    setQuickMapQuery("");
    setQuickMapHits([]);
    setQuickMapSelected(null);
    setQuickMapProducts([]);
  };

  const closeQuickMap = () => {
    setQuickMapCode(null);
    setQuickMapQuery("");
    setQuickMapHits([]);
    setQuickMapSelected(null);
    setQuickMapProducts([]);
  };

  const addQuickMapProduct = (hit: AlgoliaHit) => {
    if (quickMapProducts.some((p) => p.productId === hit.objectID)) return;
    setQuickMapProducts((prev) => [
      ...prev,
      {
        productId: hit.objectID,
        productTitle: hit.title ?? hit.objectID,
        authors: Array.isArray(hit.authors) ? hit.authors : [],
        edition: hit.edition ?? null,
        coverUrl: (hit["mainImage.url"] ?? hit.image ?? null) as string | null,
      },
    ]);
    setQuickMapQuery("");
    setQuickMapHits([]);
  };

  const removeQuickMapProduct = (productId: string) => {
    setQuickMapProducts((prev) => prev.filter((p) => p.productId !== productId));
  };

  const handleQuickMapSave = async () => {
    if (!quickMapCode || quickMapProducts.length === 0) return;
    setQuickMapSaving(true);
    try {
      await Promise.all(
        quickMapProducts.map((p) =>
          createBookMapping({
            bookCode: quickMapCode,
            productId: p.productId,
            productTitle: p.productTitle,
            authors: p.authors,
            edition: p.edition ?? undefined,
            coverUrl: p.coverUrl ?? undefined,
          })
        )
      );
      // Remove from unmapped list
      setUnmappedBookCodes((prev) => prev ? prev.filter((c) => c !== quickMapCode) : prev);
      toast.success(`Mapped "${quickMapCode}" → ${quickMapProducts.length} product(s)`);
      closeQuickMap();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save mapping");
    } finally {
      setQuickMapSaving(false);
    }
  };

  // Debounced Algolia search for quick-map modal
  useEffect(() => {
    if (!quickMapQuery.trim()) { setQuickMapHits([]); setQuickMapSearching(false); return; }
    setQuickMapSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchAlgolia(quickMapQuery);
        setQuickMapHits(res.hits);
      } catch {
        setQuickMapHits([]);
      } finally {
        setQuickMapSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [quickMapQuery]);

  // ---------------------------------------------------------------------------
  // Merge dialog handlers
  // ---------------------------------------------------------------------------

  const openMergeDialog = (group: SheetDuplicateGroup) => {
    const allGroupRows = group.rowIndices.map((i) => parsedRows[i]).filter(Boolean) as UploadRow[];
    const allPhones = [...new Set(allGroupRows.map((r) => r.phone).filter(Boolean) as string[])];
    const allEmails = [...new Set(allGroupRows.map((r) => r.email).filter(Boolean) as string[])];
    const allNames = [...new Set(allGroupRows.map((r) => r.name).filter(Boolean) as string[])];
    setPendingConfig({
      chosenName: allNames[0] ?? "",
      chosenPhones: new Set(allPhones),
      chosenEmails: new Set(allEmails),
      primaryPhone: allPhones[0] ?? "",
      primaryEmail: allEmails[allEmails.length - 1] ?? "",
    });
    setMergeDialogGroup(group);
  };

  const handleMergeConfirm = () => {
    if (!mergeDialogGroup || !pendingConfig) return;
    const group = mergeDialogGroup;
    const extraIndices = group.rowIndices.slice(1);
    setMergedSheetGroups((prev) => new Set([...prev, group.key]));
    setSkippedRows((prev) => {
      const next = new Set(prev);
      for (const idx of extraIndices) next.add(idx);
      return next;
    });
    setSheetMergeConfigs((prev) => {
      const next = new Map(prev);
      next.set(group.key, pendingConfig);
      return next;
    });
    setMergeDialogGroup(null);
    setPendingConfig(null);
  };

  return (
    <div className="space-y-8">
      {/* Merge Config Dialog */}
      {mergeDialogGroup && pendingConfig && (() => {
        const group = mergeDialogGroup;
        const allGroupRows = group.rowIndices.map((i) => parsedRows[i]).filter(Boolean) as UploadRow[];
        const allPhones = [...new Set(allGroupRows.map((r) => r.phone).filter(Boolean) as string[])];
        const allEmails = [...new Set(allGroupRows.map((r) => r.email).filter(Boolean) as string[])];
        const allNames = [...new Set(allGroupRows.map((r) => r.name).filter(Boolean) as string[])];
        const multipleNames = allNames.length > 1;
        return (
          <Portal>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl bg-card p-6 shadow-2xl border border-border space-y-5 max-h-[90vh] overflow-y-auto">
              <div>
                <h3 className="text-base font-semibold text-foreground">Configure Merge</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {group.rowIndices.length} rows matched: {group.matchReasons.join(", ")}. Choose what to keep.
                </p>
                <p className="text-xs text-primary dark:text-primary mt-1.5 font-medium">
                  The primary email and phone will be used for sending WhatsApp and Email messages.
                </p>
              </div>

              {/* Name */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Name</p>
                {multipleNames ? (
                  <div className="space-y-1.5">
                    {allNames.map((name) => (
                      <label key={name} className="flex items-center gap-3 cursor-pointer rounded-lg border border-border px-3 py-2.5 hover:bg-muted/30 transition-colors">
                        <input
                          type="radio"
                          checked={pendingConfig.chosenName === name}
                          onChange={() => setPendingConfig((prev) => prev ? { ...prev, chosenName: name } : prev)}
                          className="accent-blue-600"
                        />
                        <span className="text-sm font-medium text-foreground">{name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-border px-3 py-2.5 text-sm text-foreground flex items-center justify-between">
                    <span className="font-medium">{allNames[0] || "—"}</span>
                    <span className="text-xs text-muted-foreground">same across all rows</span>
                  </div>
                )}
              </div>

              {/* Phones */}
              {allPhones.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Phones</p>
                  <div className="space-y-1.5">
                    {allPhones.map((phone) => {
                      const included = pendingConfig.chosenPhones.has(phone);
                      const isPrimary = pendingConfig.primaryPhone === phone;
                      return (
                        <div key={phone} className={["flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors", isPrimary && included ? "border-blue-400 bg-blue-500/5" : "border-border hover:bg-muted/30"].join(" ")}>
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={() => setPendingConfig((prev) => {
                              if (!prev) return prev;
                              const next = new Set(prev.chosenPhones);
                              if (next.has(phone)) { next.delete(phone); return { ...prev, chosenPhones: next, primaryPhone: prev.primaryPhone === phone ? ([...next][0] ?? "") : prev.primaryPhone }; }
                              else { next.add(phone); return { ...prev, chosenPhones: next }; }
                            })}
                            className="accent-blue-600"
                          />
                          <span className="text-sm font-mono text-foreground flex-1">{phone}</span>
                          {isPrimary && included && (
                            <span className="rounded-full bg-primary/15 dark:bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary dark:text-primary">Primary</span>
                          )}
                          {!isPrimary && included && (
                            <button
                              type="button"
                              onClick={() => setPendingConfig((prev) => prev ? { ...prev, primaryPhone: phone } : prev)}
                              className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            >
                              Make Primary
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Emails */}
              {allEmails.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Emails</p>
                  <div className="space-y-1.5">
                    {allEmails.map((email) => {
                      const included = pendingConfig.chosenEmails.has(email);
                      const isPrimary = pendingConfig.primaryEmail === email;
                      return (
                        <div key={email} className={["flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors", isPrimary && included ? "border-blue-400 bg-blue-500/5" : "border-border hover:bg-muted/30"].join(" ")}>
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={() => setPendingConfig((prev) => {
                              if (!prev) return prev;
                              const next = new Set(prev.chosenEmails);
                              if (next.has(email)) { next.delete(email); return { ...prev, chosenEmails: next, primaryEmail: prev.primaryEmail === email ? ([...next][0] ?? "") : prev.primaryEmail }; }
                              else { next.add(email); return { ...prev, chosenEmails: next }; }
                            })}
                            className="accent-blue-600"
                          />
                          <span className="text-sm font-mono text-foreground flex-1">{email}</span>
                          {isPrimary && included && (
                            <span className="rounded-full bg-primary/15 dark:bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary dark:text-primary">Primary</span>
                          )}
                          {!isPrimary && included && (
                            <button
                              type="button"
                              onClick={() => setPendingConfig((prev) => prev ? { ...prev, primaryEmail: email } : prev)}
                              className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            >
                              Make Primary
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Preview */}
              <div className="rounded-lg border border-blue-400/40 bg-blue-500/5 p-3">
                <p className="text-xs font-semibold text-primary dark:text-primary mb-2">Merged Teacher Preview</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div>
                    <span className="text-muted-foreground block">Name</span>
                    <p className="font-medium text-foreground">{pendingConfig.chosenName || "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Primary Phone</span>
                    <p className="font-mono font-semibold text-foreground">{pendingConfig.primaryPhone || "—"}</p>
                    {pendingConfig.chosenPhones.size > 1 && (
                      <p className="font-mono text-muted-foreground mt-0.5">+{pendingConfig.chosenPhones.size - 1} secondary</p>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground block">Primary Email</span>
                    <p className="font-mono font-semibold text-foreground">{pendingConfig.primaryEmail || "—"}</p>
                    {pendingConfig.chosenEmails.size > 1 && (
                      <p className="font-mono text-muted-foreground mt-0.5">+{pendingConfig.chosenEmails.size - 1} secondary</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button
                  onClick={() => { setMergeDialogGroup(null); setPendingConfig(null); }}
                  className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMergeConfirm}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
                >
                  Confirm Merge
                </button>
              </div>
            </div>
          </div>
          </Portal>
        );
      })()}

      {/* Quick-Map Modal */}
      {quickMapCode && (
        <Portal>
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-visible">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">Map Book Code</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Code: <span className="font-mono font-semibold text-foreground">{quickMapCode}</span>
                  {" · "}One code can map to multiple products
                </p>
              </div>
              <button onClick={closeQuickMap} className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Algolia search */}
              <div className="relative">
                <label className="block text-sm font-medium text-foreground mb-1">Search &amp; Add Products</label>
                <input
                  value={quickMapQuery}
                  onChange={(e) => {
                    setQuickMapQuery(e.target.value);
                    if (e.target.value.trim()) setQuickMapSearching(true);
                    else { setQuickMapSearching(false); setQuickMapHits([]); }
                  }}
                  placeholder="Type product name or ISBN…"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                {quickMapQuery.trim() && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-card shadow-xl max-h-52 overflow-y-auto">
                    {quickMapSearching ? (
                      <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                      </div>
                    ) : quickMapHits.length === 0 ? (
                      <div className="px-3 py-4 text-center text-sm text-muted-foreground">No products found</div>
                    ) : (
                      quickMapHits.map((hit) => {
                        const alreadyAdded = quickMapProducts.some((p) => p.productId === hit.objectID);
                        return (
                          <button
                            key={hit.objectID}
                            onClick={() => addQuickMapProduct(hit)}
                            disabled={alreadyAdded}
                            className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted border-b border-border last:border-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-start gap-2.5"
                          >
                            {(hit["mainImage.url"] ?? hit.image) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={(hit["mainImage.url"] ?? hit.image) as string} alt="" className="h-10 w-8 shrink-0 rounded object-cover border border-border" />
                            ) : (
                              <div className="h-10 w-8 shrink-0 rounded border border-border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">IMG</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-foreground">{hit.title ?? hit.objectID}</span>
                              {alreadyAdded && <span className="ml-2 text-xs text-primary font-medium">Added</span>}
                              <div className="flex flex-wrap gap-x-2 mt-0.5">
                                {hit.isbn && <span className="text-xs text-muted-foreground">ISBN: {hit.isbn as string}</span>}
                                {hit.edition && <span className="text-xs text-muted-foreground">Ed: {hit.edition}</span>}
                                {hit.authors && hit.authors.length > 0 && (
                                  <span className="text-xs text-muted-foreground">by {hit.authors.map((a) => a.title).join(", ")}</span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {/* Selected products list */}
              {quickMapProducts.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Mapped Products <span className="text-muted-foreground font-normal">({quickMapProducts.length})</span>
                  </label>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {quickMapProducts.map((p) => (
                      <div key={p.productId} className="flex items-center gap-2 rounded-lg border border-blue-400/40 bg-blue-500/5 px-3 py-2">
                        {p.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.coverUrl} alt="" className="h-10 w-8 shrink-0 rounded object-cover border border-border" />
                        ) : null}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{p.productTitle}</p>
                          <p className="text-xs font-mono text-muted-foreground">{p.productId}</p>
                          {p.edition && <p className="text-xs text-muted-foreground">Edition: {p.edition}</p>}
                          {p.authors.length > 0 && (
                            <p className="text-xs text-muted-foreground">by {p.authors.map((a) => a.title).join(", ")}</p>
                          )}
                        </div>
                        <button
                          onClick={() => removeQuickMapProduct(p.productId)}
                          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {quickMapProducts.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Search above to add products. You can add multiple products per code.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
              <button onClick={closeQuickMap} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                Cancel
              </button>
              <button
                onClick={handleQuickMapSave}
                disabled={quickMapProducts.length === 0 || quickMapSaving}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {quickMapSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Save {quickMapProducts.length > 0 ? `${quickMapProducts.length} Mapping${quickMapProducts.length > 1 ? "s" : ""}` : "Mapping"}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* Header + Step indicator on same row */}
      <div className="flex items-start justify-between gap-4">
        <div className="shrink-0">
          <h1 className="text-2xl font-bold text-foreground">Upload Specimen</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Upload an Excel or CSV file to start a new distribution batch
          </p>
        </div>
        {parsedRows.length > 0 && (
          <div className="shrink-0">
            <StepIndicator current={step} />
          </div>
        )}
      </div>

      {/* Download Template — only shown before a file is uploaded */}
      {step === 1 && parsedRows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-foreground text-sm">Specimen Template</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Download the template, fill in teacher data, then upload below.
              </p>
            </div>
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50"
            >
              <Download className="h-3.5 w-3.5" />
              Download Template
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 1: Upload + Preview                                             */}
      {/* ------------------------------------------------------------------ */}
      {step === 1 && (
        <>
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-4 font-semibold text-foreground">Upload File</h2>
            {isParsing && (
              <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Parsing file…
              </p>
            )}
            <FileUploadZone onFileSelect={handleFileSelect} onClear={handleCancel} />
          </div>

          {parsedRows.length > 0 && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
                  <p className="text-sm text-muted-foreground">Teachers</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{parsedRows.length}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
                  <p className="text-sm text-muted-foreground">Estimated Orders</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{estimatedOrders}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
                  <p className="text-sm text-muted-foreground">File</p>
                  <p className="mt-1 text-sm font-medium text-foreground truncate">{selectedFile?.name}</p>
                </div>
              </div>

              <div className="min-w-0 w-full">
                <h2 className="mb-4 text-lg font-semibold text-foreground">Preview</h2>
                <DataTable
                  columns={previewColumns}
                  data={parsedRows}
                  keyExtractor={(_, idx) => String(idx)}
                  maxHeight="24rem"
                />
              </div>

              <div className="flex items-center justify-end gap-3">
                <button onClick={handleCancel} className="rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50">
                  Cancel
                </button>
                <button
                  onClick={() => setStep(2)}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary/90"
                >
                  Next: Select Channels <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 2: Channel Selection (global + per-teacher)                     */}
      {/* ------------------------------------------------------------------ */}
      {step === 2 && (
        <div className="space-y-6">

          {/* Global selector */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-1 text-lg font-semibold text-foreground">Select Notification Channel</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Choose a default channel for all teachers, then override per-teacher below.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <ChannelCard
                value="whatsapp" selected={globalChannel === "whatsapp"} onSelect={handleGlobalChannelChange}
                icon={<MessageCircle className={`h-6 w-6 ${globalChannel === "whatsapp" ? "text-white" : "text-green-600"}`} />}
                label="WhatsApp Only" description="Send via WhatsApp to teachers with a phone number"
                accentClass="bg-green-600/10 border-green-600"
              />
              <ChannelCard
                value="email" selected={globalChannel === "email"} onSelect={handleGlobalChannelChange}
                icon={<Mail className={`h-6 w-6 ${globalChannel === "email" ? "text-white" : "text-primary"}`} />}
                label="Email Only" description="Send via email to teachers with an email address"
                accentClass="bg-primary/10 border-primary"
              />
              <ChannelCard
                value="both" selected={globalChannel === "both"} onSelect={handleGlobalChannelChange}
                icon={<Users className={`h-6 w-6 ${globalChannel === "both" ? "text-white" : "text-purple-600"}`} />}
                label="Both (WhatsApp + Email)" description="Use all available contact methods"
                accentClass="bg-purple-600/10 border-purple-600"
              />
            </div>
          </div>

          {/* Contact coverage */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Contact Coverage</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <p className="text-xl font-bold text-foreground">{channelCounts.both}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Phone + Email</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <p className="text-xl font-bold text-foreground">{channelCounts.phoneOnly}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Phone Only</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <p className="text-xl font-bold text-foreground">{channelCounts.emailOnly}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Email Only</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                <p className="text-xl font-bold text-orange-500">{channelCounts.neither}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">No Contact Info</p>
              </div>
            </div>
          </div>

          {/* Per-teacher override table */}
          <div className="rounded-xl border border-border bg-card shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Per-Teacher Channel Override</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">[W]</span> WhatsApp &nbsp;
                  <span className="font-medium text-foreground">[E]</span> Email &nbsp;
                  <span className="font-medium text-foreground">[B]</span> Both
                  {overrideCount > 0 && (
                    <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary dark:bg-primary/20 dark:text-primary">
                      {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </p>
              </div>
              {overrideCount > 0 && (
                <button
                  onClick={() => setPerTeacherChannel(new Map())}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Reset all
                </button>
              )}
            </div>

            {/* Search */}
            <div className="border-b border-border px-5 py-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search by name, phone or email…"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {searchQuery && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {filteredIndexedRows.length} result{filteredIndexedRows.length !== 1 ? "s" : ""} for &quot;{searchQuery}&quot;
                </p>
              )}
            </div>

            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card border-b border-border">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">#</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">Name</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">Phone</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">Email</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase">Channel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {channelTableRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No teachers match your search.
                      </td>
                    </tr>
                  ) : (
                    channelTableRows.map(({ row, globalIdx }) => {
                      const effective = getEffectiveChannel(globalIdx);
                      const hasOverride = perTeacherChannel.has(globalIdx);
                      return (
                        <tr key={globalIdx} className={hasOverride ? "bg-blue-500/5" : "hover:bg-muted/20"}>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{globalIdx + 1}</td>
                          <td className="px-4 py-2 font-medium text-foreground text-xs">{row.name || "—"}</td>
                          <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.phone || "—"}</td>
                          <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.email || "—"}</td>
                          <td className="px-4 py-2 text-center">
                            <ChannelPill
                              value={effective}
                              onChange={(ch) => setTeacherChannel(globalIdx, ch)}
                              hasPhone={!!row.phone}
                              hasEmail={!!row.email}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table pagination */}
            {channelTableTotalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-5 py-3">
                <span className="text-xs text-muted-foreground">
                  Page {channelTablePage} of {channelTableTotalPages} · {filteredIndexedRows.length}{searchQuery ? ` matched` : ` teachers`}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setChannelTablePage(1)} disabled={channelTablePage <= 1}
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">«</button>
                  <button onClick={() => setChannelTablePage((p) => p - 1)} disabled={channelTablePage <= 1}
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">‹ Prev</button>
                  <button onClick={() => setChannelTablePage((p) => p + 1)} disabled={channelTablePage >= channelTableTotalPages}
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">Next ›</button>
                  <button onClick={() => setChannelTablePage(channelTableTotalPages)} disabled={channelTablePage >= channelTableTotalPages}
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">»</button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(1)}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50">
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            <button onClick={goToStep3}
              className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Next: File Review <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 3: Within-File Duplicates                                      */}
      {/* ------------------------------------------------------------------ */}
      {step === 3 && (
        <div className="space-y-6">
          {/* ── Section 1: In-sheet duplicates ─────────────────────────── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-foreground">Within-File Duplicates</h2>
                {inSheetDuplicates.length === 0 ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-400">
                    None found
                  </span>
                ) : (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
                    {inSheetDuplicates.length} group{inSheetDuplicates.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {(skippedRows.size > 0 || mergedSheetGroups.size > 0) && (
                <div className="flex items-center gap-3">
                  {skippedRows.size > 0 && <span className="text-xs text-muted-foreground">{skippedRows.size} row{skippedRows.size !== 1 ? "s" : ""} skipped</span>}
                  {mergedSheetGroups.size > 0 && <span className="text-xs text-muted-foreground">{mergedSheetGroups.size} group{mergedSheetGroups.size !== 1 ? "s" : ""} merged</span>}
                  <button onClick={() => { setSkippedRows(new Set()); setMergedSheetGroups(new Set()); }} className="text-xs text-primary hover:underline">Reset all</button>
                </div>
              )}
            </div>

            {inSheetDuplicates.length === 0 ? (
              <div className="flex items-center gap-2.5 px-5 py-4 text-sm text-green-700 dark:text-green-400">
                <CheckCircle className="h-4 w-4 shrink-0" />
                No duplicate phones or emails within the file — all {parsedRows.length.toLocaleString()} rows are unique.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {inSheetDuplicates.map((group) => {
                  const isMerged = mergedSheetGroups.has(group.key);
                  const keepIdx = group.rowIndices[0]!;
                  const extraIndices = group.rowIndices.slice(1);

                  // Build final merged teacher preview
                  const allGroupRows = group.rowIndices.map((i) => parsedRows[i]).filter(Boolean) as UploadRow[];
                  const finalName = allGroupRows[0]?.name || "—";
                  const allPhones = [...new Set(allGroupRows.map(r => r.phone).filter(Boolean) as string[])];
                  const allEmails = [...new Set(allGroupRows.map(r => r.email).filter(Boolean) as string[])];
                  const finalSchool = allGroupRows.find(r => r.school)?.school || "—";

                  const handleMerge = () => openMergeDialog(group);
                  const handleUndoMerge = () => {
                    setMergedSheetGroups(prev => { const n = new Set(prev); n.delete(group.key); return n; });
                    setSkippedRows(prev => {
                      const next = new Set(prev);
                      for (const idx of extraIndices) next.delete(idx);
                      return next;
                    });
                    setSheetMergeConfigs(prev => { const n = new Map(prev); n.delete(group.key); return n; });
                  };

                  return (
                    <div key={group.key} className={["px-5 py-4", isMerged ? "bg-blue-500/5" : ""].join(" ")}>
                      {/* Group header */}
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs">
                          {group.matchReasons.map((reason, ri) => {
                            const isPhone = reason.startsWith("Phone");
                            return (
                              <span key={ri} className={[
                                "rounded-full px-2 py-0.5 font-semibold",
                                isPhone
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                  : "bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary",
                              ].join(" ")}>
                                {reason}
                              </span>
                            );
                          })}
                          <span className="text-muted-foreground">· {group.rowIndices.length} rows — same teacher</span>
                          {isMerged && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary dark:bg-primary/20 dark:text-primary">
                              ✓ Merged → 1 teacher
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {isMerged ? (
                            <button onClick={handleUndoMerge}
                              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted">
                              Undo Merge
                            </button>
                          ) : (
                            <button onClick={handleMerge}
                              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-primary/90">
                              Merge into 1 Teacher
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Rows table */}
                      <div className="overflow-hidden rounded-lg border border-border">
                        <table className="min-w-full text-xs">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Row</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Name</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Phone</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Email</th>
                              <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">School</th>
                              {!isMerged && <th className="px-3 py-2 text-center font-semibold text-muted-foreground uppercase">Action</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {group.rowIndices.map((rowIdx, pos) => {
                              const row = parsedRows[rowIdx];
                              if (!row) return null;
                              const isSkippedByMerge = isMerged && pos > 0;
                              const isSkippedManual = !isMerged && skippedRows.has(rowIdx);
                              const isSkipped = isSkippedByMerge || isSkippedManual;
                              return (
                                <tr key={rowIdx} className={[
                                  isSkipped ? "opacity-40 bg-muted/20" : isMerged && pos === 0 ? "bg-blue-500/5" : "hover:bg-muted/10",
                                ].join(" ")}>
                                  <td className="px-3 py-2 text-muted-foreground">
                                    #{rowIdx + 1}
                                    {isMerged && pos === 0 && (
                                      <span className="ml-1.5 rounded bg-blue-600 px-1 py-0.5 text-[10px] font-semibold text-white">kept</span>
                                    )}
                                    {isSkippedByMerge && (
                                      <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">merged</span>
                                    )}
                                  </td>
                                  <td className={["px-3 py-2 font-medium", isSkipped ? "line-through text-muted-foreground" : "text-foreground"].join(" ")}>{row.name || "—"}</td>
                                  <td className="px-3 py-2 font-mono text-muted-foreground">{row.phone || "—"}</td>
                                  <td className="px-3 py-2 font-mono text-muted-foreground">{row.email || "—"}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{row.school || "—"}</td>
                                  {!isMerged && (
                                    <td className="px-3 py-2 text-center">
                                      <button
                                        onClick={() => setSkippedRows((prev) => {
                                          const next = new Set(prev);
                                          if (isSkippedManual) next.delete(rowIdx); else next.add(rowIdx);
                                          return next;
                                        })}
                                        className={[
                                          "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                                          isSkippedManual
                                            ? "bg-muted text-muted-foreground hover:bg-muted/70"
                                            : "bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400",
                                        ].join(" ")}
                                      >
                                        {isSkippedManual ? "Restore" : "Skip"}
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Final teacher preview (shown when merged) */}
                      {isMerged && (() => {
                        const cfg = sheetMergeConfigs.get(group.key);
                        const previewName = cfg?.chosenName || finalName;
                        const previewPrimaryPhone = cfg?.primaryPhone || allPhones[0] || "";
                        const previewPrimaryEmail = cfg?.primaryEmail || allEmails[0] || "";
                        const otherPhones = cfg ? [...cfg.chosenPhones].filter((p) => p !== cfg.primaryPhone).length : Math.max(0, allPhones.length - 1);
                        const otherEmails = cfg ? [...cfg.chosenEmails].filter((e) => e !== cfg.primaryEmail).length : Math.max(0, allEmails.length - 1);
                        return (
                          <div className="mt-3 rounded-lg border border-blue-400/40 bg-blue-500/5 p-3">
                            <p className="mb-2 text-xs font-semibold text-primary dark:text-primary">Final Teacher Record</p>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                              <div>
                                <span className="text-muted-foreground">Name</span>
                                <p className="font-medium text-foreground">{previewName}</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Primary Phone</span>
                                <p className="font-mono font-semibold text-foreground">{previewPrimaryPhone || "—"}</p>
                                {otherPhones > 0 && <p className="text-muted-foreground">+{otherPhones} secondary</p>}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Primary Email</span>
                                <p className="font-mono font-semibold text-foreground">{previewPrimaryEmail || "—"}</p>
                                {otherEmails > 0 && <p className="text-muted-foreground">+{otherEmails} secondary</p>}
                              </div>
                              <div>
                                <span className="text-muted-foreground">School</span>
                                <p className="text-foreground">{finalSchool}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Next step button */}
          <div className="flex items-center justify-between border-t border-border pt-6">
            <button onClick={() => setStep(2)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" /> Back to Channels
            </button>
            <button
              onClick={goToStep4}
              className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Next: DB Review <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 4: DB Review — book codes + database duplicates               */}
      {/* ------------------------------------------------------------------ */}
      {step === 4 && (
        <div className="space-y-6">

          {/* ── Section 2: Unmapped book codes ─────────────────────────── */}
          {unmappedBookCodes !== null && (
            <div className={[
              "rounded-xl border shadow-sm overflow-hidden",
              unmappedBookCodes.length > 0
                ? "border-orange-400/60 bg-orange-50/30 dark:bg-orange-950/10"
                : "border-green-200 bg-green-50/30 dark:bg-green-950/10",
            ].join(" ")}>
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
                <h2 className="font-semibold text-foreground">Book Code Mappings</h2>
                {unmappedBookCodes.length === 0 ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-400">
                    All mapped
                  </span>
                ) : (
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
                    {unmappedBookCodes.length} unmapped
                  </span>
                )}
              </div>
              <div className="px-5 py-4">
                {unmappedBookCodes.length === 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                      <CheckCircle className="h-4 w-4 shrink-0" />
                      All book codes mapped. Orders will generate correctly.
                    </div>
                    {mappedBookDetails.length > 0 && (
                      <div className="mt-2 rounded-lg border border-border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/50 border-b border-border">
                              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground w-24">Code</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Products</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const grouped = new Map<string, typeof mappedBookDetails>();
                              mappedBookDetails.forEach((m) => {
                                if (!grouped.has(m.bookCode)) grouped.set(m.bookCode, []);
                                grouped.get(m.bookCode)!.push(m);
                              });
                              return [...grouped.entries()].map(([code, products], rowIdx) => (
                                <tr key={code} className={rowIdx % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                                  <td className="px-3 py-3 align-top border-r border-border">
                                    <span className="font-mono font-bold text-foreground text-sm">{code}</span>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex flex-wrap gap-3">
                                      {products.map((m, i) => (
                                        <div key={i} className="flex items-start gap-2">
                                          {m.coverUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={m.coverUrl} alt="" className="h-12 w-9 shrink-0 rounded object-cover border border-border" />
                                          ) : (
                                            <div className="h-12 w-9 shrink-0 rounded border border-border bg-muted flex items-center justify-center text-[9px] text-muted-foreground">IMG</div>
                                          )}
                                          <div className="min-w-0">
                                            <p className="text-xs font-semibold text-foreground leading-tight">{m.productTitle}</p>
                                            {m.edition && <p className="text-[11px] text-muted-foreground mt-0.5">Ed: {m.edition}</p>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              ));
                            })()}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 text-sm text-orange-700 dark:text-orange-400">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <p>
                        The following book codes have no product mapping. Orders for these codes may not generate specimen links correctly.
                        You can still create the batch — add mappings in{" "}
                        <a href="/book-mappings" target="_blank" rel="noreferrer" className="underline font-medium hover:text-orange-800">
                          Book Mappings
                        </a>{" "}
                        before sending.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {unmappedBookCodes.map((code) => (
                        <button
                          key={code}
                          onClick={() => openQuickMap(code)}
                          className="rounded-md border border-orange-200 bg-orange-100 px-2 py-0.5 text-xs font-mono font-medium text-orange-800 hover:bg-orange-200 hover:border-orange-400 transition-colors cursor-pointer dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/50"
                          title={`Click to map "${code}" to a product`}
                        >
                          {code} +
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Section 3: DB duplicates ────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-1 text-lg font-semibold text-foreground">Database Duplicates</h2>
            <p className="text-sm text-muted-foreground">
              Checking all {parsedRows.length.toLocaleString()} rows against existing teachers in the database. Nothing merges until you approve.
            </p>
          </div>

          {/* Loading */}
          {isDuplicateChecking && (
            <div className="flex items-center justify-center gap-3 rounded-xl border border-border bg-card p-16 shadow-sm">
              <Loader2 className="h-6 w-6 animate-spin text-primary/70" />
              <div>
                <p className="font-medium text-foreground">Checking for duplicates…</p>
                <p className="text-sm text-muted-foreground mt-0.5">Matching phones, emails and names</p>
              </div>
            </div>
          )}

          {!isDuplicateChecking && duplicateMatches !== null && (() => {
            const noChangesCount = duplicateMatches.filter(m => m.diff.noChanges).length;
            const needsActionCount = duplicateMatches.filter(m => !m.diff.noChanges).length;

            return (
              <>
                {/* Summary bar */}
                {duplicateMatches.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-border bg-card p-3 text-center">
                      <p className="text-xl font-bold text-foreground">{duplicateMatches.length}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Potential matches</p>
                    </div>
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center dark:border-green-800 dark:bg-green-950/20">
                      <p className="text-xl font-bold text-green-700 dark:text-green-400">{noChangesCount}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Exact duplicate (skip)</p>
                    </div>
                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-center dark:border-orange-800 dark:bg-orange-950/20">
                      <p className="text-xl font-bold text-orange-700 dark:text-orange-400">{needsActionCount}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Has changes to review</p>
                    </div>
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center dark:border-blue-800 dark:bg-blue-950/20">
                      <p className="text-xl font-bold text-primary dark:text-primary">
                        {[...mergeDecisions.values()].filter(d => d?.action === "merge").length}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Approved merges</p>
                    </div>
                  </div>
                )}

                {duplicateMatches.length === 0 ? (
                  <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-6 dark:border-green-800 dark:bg-green-950/30">
                    <CheckCircle className="h-6 w-6 shrink-0 text-green-600" />
                    <div>
                      <p className="font-semibold text-green-700 dark:text-green-400">No duplicates found</p>
                      <p className="mt-0.5 text-sm text-green-600 dark:text-green-500">All {parsedRows.length.toLocaleString()} teachers are new records.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                    {duplicateMatches.map((match) => {
                      const decision = mergeDecisions.get(match.rowIndex) ?? null;
                      const isUseDb = decision?.action === "use_db";
                      const isMerging = decision?.action === "merge";
                      const isCreatingNew = decision?.action === "create_new";

                      return (
                        <div key={match.rowIndex} className={[
                          "rounded-xl border shadow-sm overflow-hidden",
                          isUseDb ? "border-primary/60" : isMerging ? "border-primary/40" : isCreatingNew ? "border-muted" : "border-primary/30",
                        ].join(" ")}>
                          {/* Card header */}
                          <div className={[
                            "flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs font-medium",
                            isUseDb ? "bg-primary/10" : isMerging ? "bg-primary/5" : isCreatingNew ? "bg-muted/30" : "bg-primary/5",
                          ].join(" ")}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-muted-foreground">Row #{match.rowIndex + 1}</span>
                              <span className="text-muted-foreground">·</span>
                              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary">
                                {match.confidence}% match
                              </span>
                              {match.isSplitMatch ? (
                                <>
                                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700 font-medium text-[10px]">
                                    Split match
                                  </span>
                                  {match.phoneMatchTeacher && (
                                    <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-blue-700 text-[10px]" title={`Phone match · DB ID: ${match.phoneMatchTeacher.id}`}>
                                      📞 {match.phoneMatchTeacher.name} · {match.phoneMatchTeacher.phones[0] ?? match.row.phone}
                                    </span>
                                  )}
                                  {match.emailMatchTeacher && (
                                    <span className="rounded-full bg-purple-50 border border-purple-200 px-2 py-0.5 text-purple-700 text-[10px]" title={`Email match · DB ID: ${match.emailMatchTeacher.id}`}>
                                      ✉ {match.emailMatchTeacher.name} · {match.emailMatchTeacher.emails[0] ?? match.row.email}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span className="text-muted-foreground">{match.matchReasons.join(" · ")}</span>
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground font-mono" title="Database teacher ID">
                                    DB: {match.existingTeacher.id}
                                  </span>
                                </>
                              )}
                            </div>
                            {/* Action buttons */}
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => {
                                  if (match.isSplitMatch) {
                                    // For split matches, toggle to use_db state without a specific teacher (will show picker below)
                                    setMergeDecisions(prev => { const n = new Map(prev); n.set(match.rowIndex, { action: "use_db", teacherId: undefined }); return n; });
                                  } else {
                                    setMergeDecisions(prev => { const n = new Map(prev); n.set(match.rowIndex, { action: "use_db" }); return n; });
                                  }
                                }}
                                className={[
                                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                                  isUseDb
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                                ].join(" ")}
                              >
                                {isUseDb ? "✓ Use DB" : "Use DB"}
                              </button>
                              <button
                                onClick={() => setMergeDecisions(prev => { const n = new Map(prev); n.set(match.rowIndex, { action: "create_new" }); return n; })}
                                className={[
                                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                                  isCreatingNew
                                    ? "bg-muted text-foreground ring-1 ring-border"
                                    : "text-muted-foreground hover:bg-muted",
                                ].join(" ")}
                              >
                                Create New
                              </button>
                            </div>
                          </div>

                          {/* Split match + Use DB: teacher picker */}
                          {isUseDb && match.isSplitMatch && (() => {
                            const chosenTeacherId = (decision as { action: "use_db"; teacherId?: string } | null)?.teacherId;
                            const ch = getEffectiveChannel(match.rowIndex);
                            return (
                              <div className="px-4 py-3 border-t border-border/50 text-xs space-y-2">
                                <p className="font-medium text-orange-600 dark:text-orange-400">
                                  Two different teachers matched — choose which DB teacher to link this record to:
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {match.phoneMatchTeacher && (
                                    <button
                                      onClick={() => setMergeDecisions(prev => { const n = new Map(prev); n.set(match.rowIndex, { action: "use_db", teacherId: match.phoneMatchTeacher!.id }); return n; })}
                                      className={[
                                        "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                                        chosenTeacherId === match.phoneMatchTeacher.id
                                          ? "border-blue-500 bg-blue-50 text-blue-700"
                                          : "border-border text-muted-foreground hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700",
                                      ].join(" ")}
                                      title="Phone match"
                                    >
                                      📞 {match.phoneMatchTeacher.name} · {match.phoneMatchTeacher.phones[0] ?? match.row.phone}
                                    </button>
                                  )}
                                  {match.emailMatchTeacher && (
                                    <button
                                      onClick={() => setMergeDecisions(prev => { const n = new Map(prev); n.set(match.rowIndex, { action: "use_db", teacherId: match.emailMatchTeacher!.id }); return n; })}
                                      className={[
                                        "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                                        chosenTeacherId === match.emailMatchTeacher.id
                                          ? "border-purple-500 bg-purple-50 text-purple-700"
                                          : "border-border text-muted-foreground hover:border-purple-400 hover:bg-purple-50 hover:text-purple-700",
                                      ].join(" ")}
                                      title="Email match"
                                    >
                                      ✉ {match.emailMatchTeacher.name} · {match.emailMatchTeacher.emails[0] ?? match.row.email}
                                    </button>
                                  )}
                                </div>
                                {chosenTeacherId && (
                                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1">
                                    <div>
                                      <span className="text-muted-foreground">File: </span>
                                      <span className="font-medium text-foreground">{match.row.name}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Send to: </span>
                                      <span className="font-mono text-foreground">{match.row.phone || match.row.email || "—"}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 ml-auto">
                                      <span className="text-muted-foreground">Channel:</span>
                                      <select
                                        value={ch}
                                        onChange={(e) => setTeacherChannel(match.rowIndex, e.target.value as ChannelOption)}
                                        className="rounded border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                      >
                                        <option value="both">Both</option>
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="email">Email</option>
                                      </select>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* Compact summary — shown for Use DB (non-split) and Create New */}
                          {((isUseDb && !match.isSplitMatch) || isCreatingNew) && (() => {
                            const ch = getEffectiveChannel(match.rowIndex);
                            // For Create New: phone/email will be blanked if already owned by another DB teacher
                            const phoneIsTaken = isCreatingNew && match.matchReasons.includes("Phone match");
                            const emailIsTaken = isCreatingNew && match.matchReasons.includes("Email match");
                            const effectivePhone = phoneIsTaken ? "" : match.row.phone;
                            const effectiveEmail = emailIsTaken ? "" : match.row.email;
                            const sendTo = effectivePhone || effectiveEmail || "—";
                            // Build ownership warning lines for Create New
                            const takenWarnings: string[] = [];
                            if (isCreatingNew && phoneIsTaken) {
                              const owner = match.isSplitMatch
                                ? match.phoneMatchTeacher?.name
                                : match.existingTeacher.name;
                              takenWarnings.push(`Phone ${match.row.phone} already belongs to "${owner ?? 'another teacher'}" — will be saved as empty`);
                            }
                            if (isCreatingNew && emailIsTaken) {
                              const owner = match.isSplitMatch
                                ? match.emailMatchTeacher?.name
                                : match.existingTeacher.name;
                              takenWarnings.push(`Email ${match.row.email} already belongs to "${owner ?? 'another teacher'}" — will be saved as empty`);
                            }
                            return (
                              <div className="px-4 py-2 text-xs border-t border-border/50 space-y-1.5">
                                {takenWarnings.length > 0 && (
                                  <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 space-y-0.5">
                                    {takenWarnings.map((w, i) => (
                                      <p key={i} className="text-destructive font-medium">⚠ {w}</p>
                                    ))}
                                  </div>
                                )}
                                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                                  {!isCreatingNew && (
                                    <div>
                                      <span className="text-muted-foreground">DB: </span>
                                      <span className="font-medium text-foreground">{match.existingTeacher.name}</span>
                                    </div>
                                  )}
                                  <div>
                                    <span className="text-muted-foreground">File: </span>
                                    <span className="font-medium text-foreground">{match.row.name}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Send to: </span>
                                    {sendTo === "—" ? (
                                      <span className="font-mono text-destructive font-semibold">— (no contact info, no message will be sent)</span>
                                    ) : (
                                      <span className="font-mono text-foreground">{sendTo}</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 ml-auto">
                                    <span className="text-muted-foreground">Channel:</span>
                                    <select
                                      value={ch}
                                      onChange={(e) => setTeacherChannel(match.rowIndex, e.target.value as ChannelOption)}
                                      className="rounded border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    >
                                      <option value="both">Both</option>
                                      <option value="whatsapp">WhatsApp</option>
                                      <option value="email">Email</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Merge detail — only shown when Merge is selected */}
                          {isMerging && (
                            <div className="px-4 py-3 border-t border-border/50 text-xs space-y-2">
                              {match.isSplitMatch && (
                                <p className="text-orange-600 dark:text-orange-400 font-medium">
                                  Split match: merging with phone-matched teacher ({match.phoneMatchTeacher?.name ?? match.existingTeacher.name})
                                </p>
                              )}
                              <div className="flex items-center gap-4">
                                <span className="font-medium text-primary">Which name to keep?</span>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input type="radio" name={`name-${match.rowIndex}`} checked={decision?.action === "merge" && decision.nameChoice === "db"}
                                    onChange={() => setMergeDecisions(prev => { const n = new Map(prev); n.set(match.rowIndex, { action: "merge", nameChoice: "db" }); return n; })}
                                    className="accent-primary" />
                                  <span className="text-foreground">DB: <strong>{match.existingTeacher.name}</strong></span>
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input type="radio" name={`name-${match.rowIndex}`} checked={decision?.action === "merge" && decision.nameChoice === "file"}
                                    onChange={() => setMergeDecisions(prev => { const n = new Map(prev); n.set(match.rowIndex, { action: "merge", nameChoice: "file" }); return n; })}
                                    className="accent-primary" />
                                  <span className="text-foreground">File: <strong>{match.row.name}</strong></span>
                                </label>
                              </div>
                              {match.diff.phonesToAdd.length > 0 && (
                                <p className="text-muted-foreground">+{match.diff.phonesToAdd.join(", ")} phone(s) will be added to DB</p>
                              )}
                              {match.diff.emailsToAdd.length > 0 && (
                                <p className="text-muted-foreground">+{match.diff.emailsToAdd.join(", ")} email(s) will be added to DB</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(3)} disabled={isUploading}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50">
              <ChevronLeft className="h-4 w-4" /> Back to File Review
            </button>
            {(() => {
              const unresolvedNameConflicts = duplicateMatches
                ? duplicateMatches.filter((m) => {
                    if (!m.diff.nameConflict) return false;
                    const d = mergeDecisions.get(m.rowIndex);
                    return d === null || d === undefined;
                  }).length
                : 0;
              const blockCount = unresolvedNameConflicts;
              return (
                <button
                  onClick={handleCreateBatch}
                  disabled={isUploading || isDuplicateChecking || blockCount > 0}
                  title={blockCount > 0 ? `Resolve ${blockCount} conflict(s) first` : undefined}
                  className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isUploading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Creating Batch…</>
                  ) : unresolvedNameConflicts > 0 ? (
                    <><AlertCircle className="h-4 w-4" /> Resolve {blockCount} conflict{blockCount !== 1 ? "s" : ""}</>
                  ) : (
                    <><CheckCircle className="h-4 w-4" /> Create Batch</>
                  )}
                </button>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
