"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Merge, FileText, CheckCircle, AlertCircle, Database } from "lucide-react";
import { toast } from "sonner";
import type { UploadRow, ReviewedRow, ChannelChoice } from "@/types";
import { uploadSpecimenReviewed, checkDuplicatesAgainstDB, mergeTeacher, type DBDuplicateMatch } from "@/services/api";
import {
  detectMergeGroups,
  mergeRows,
  type MergeGroup,
} from "@/utils/mergeDetection";
import { clsx } from "clsx";
import { Portal } from "@/components/Portal";

const STORAGE_KEY = "upload_review_rows";
const STORAGE_FILE_KEY = "upload_review_filename";
const STORAGE_LOGS_KEY = "upload_review_initial_logs";

type LogStep =
  | "file_selected"
  | "file_parsed"
  | "navigate_review"
  | "page_loaded"
  | "merge_groups_detected"
  | "merged"
  | "kept_separate"
  | "channel_applied"
  | "channel_per_teacher"
  | "contact_selected"
  | "distribution_clicked"
  | "validation_passed"
  | "upload_api_calling"
  | "upload_api_success"
  | "session_cleared"
  | "redirect"
  | "error";

interface StepLog {
  id: string;
  step: LogStep;
  stepNumber: number;
  timestamp: Date;
  message: string;
  detail?: string;
}

interface ReviewRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  school: string;
  books: string;
  phones: string[];
  emails: string[];
  phoneSelected: string;
  emailSelected: string;
  channels: ChannelChoice;
  mergedFrom?: number[];
  recordId?: string;
  booksAssigned?: string;
  teacherOwnerId?: string;
  teacherOwner?: string;
  firstName?: string;
  lastName?: string;
  institutionId?: string;
  institutionName?: string;
  salutation?: string;
}

function toReviewRow(row: UploadRow, id: string, idx?: number): ReviewRow {
  const phones = [row.phone].filter(Boolean);
  const emails = [row.email].filter(Boolean);
  return {
    id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    school: row.school,
    books: row.books,
    phones,
    emails,
    phoneSelected: phones[0] || "",
    emailSelected: emails[0] || "",
    channels: "both",
    mergedFrom: idx !== undefined ? [idx] : undefined,
    recordId: row.recordId,
    booksAssigned: row.booksAssigned,
    teacherOwnerId: row.teacherOwnerId,
    teacherOwner: row.teacherOwner,
    firstName: row.firstName,
    lastName: row.lastName,
    institutionId: row.institutionId,
    institutionName: row.institutionName,
    salutation: row.salutation,
  };
}

export default function UploadReviewPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [mergeGroups, setMergeGroups] = useState<MergeGroup[]>([]);
  const [mergedGroupIds, setMergedGroupIds] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [globalChannel, setGlobalChannel] = useState<ChannelChoice>("both");
  const [stepLogs, setStepLogs] = useState<StepLog[]>([]);
  const logIdRef = useRef(0);
  const stepNumberRef = useRef(0);

  // DB duplicate check state
  const [dbMatches, setDbMatches] = useState<DBDuplicateMatch[]>([]);
  const [isCheckingDB, setIsCheckingDB] = useState(false);
  const [dismissedDbMatches, setDismissedDbMatches] = useState<Set<number>>(new Set());
  const [removedRowIds, setRemovedRowIds] = useState<Set<string>>(new Set());

  const addLog = useCallback(
    (step: LogStep, message: string, detail?: string) => {
      const id = `log-${++logIdRef.current}`;
      const stepNumber = ++stepNumberRef.current;
      setStepLogs((prev) => [
        ...prev,
        { id, step, stepNumber, timestamp: new Date(), message, detail },
      ]);
    },
    []
  );

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const fname = sessionStorage.getItem(STORAGE_FILE_KEY);
    const initialLogs = sessionStorage.getItem(STORAGE_LOGS_KEY);

    if (raw && fname) {
      try {
        // Restore initial logs from upload page
        if (initialLogs) {
          try {
            const parsedLogs = JSON.parse(initialLogs) as Array<{ step: string; stepNumber: number; timestamp: string; message: string; detail?: string }>;
            if (Array.isArray(parsedLogs)) {
              const withStepNumbers: StepLog[] = parsedLogs.map((l, i) => ({
                id: `log-init-${i}`,
                step: l.step as LogStep,
                stepNumber: l.stepNumber,
                timestamp: new Date(l.timestamp),
                message: l.message,
                detail: l.detail,
              }));
              stepNumberRef.current = withStepNumbers.length;
              setStepLogs(withStepNumbers);
            }
            sessionStorage.removeItem(STORAGE_LOGS_KEY);
          } catch {
            /* ignore */
          }
        }

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error("Session data is empty or invalid format");
        }

        // Normalize rows (ensure expected shape)
        const normalized: UploadRow[] = parsed.map((r: Record<string, unknown>) => ({
          name: String(r?.name ?? "").trim(),
          phone: String(r?.phone ?? "").trim(),
          email: String(r?.email ?? "").trim(),
          school: String(r?.school ?? "").trim(),
          books: String(r?.books ?? "").trim(),
        }));

        setFileName(fname);
        const reviewRows = normalized.map((r, i) =>
          toReviewRow(r, `r-${i}`, i)
        );
        setRows(reviewRows);
        const groups = detectMergeGroups(normalized);
        setMergeGroups(groups);

        addLog(
          "page_loaded",
          `Review page loaded`,
          `Loaded ${normalized.length} teachers from "${fname}"`
        );
        addLog(
          "merge_groups_detected",
          `Duplicate detection complete`,
          groups.length > 0
            ? `${groups.length} merge suggestion(s) found`
            : "No duplicates detected"
        );

        // Check against existing DB teachers
        setIsCheckingDB(true);
        checkDuplicatesAgainstDB(
          normalized.map((r) => ({
            name: r.name,
            phone: r.phone,
            email: r.email,
            school: r.school,
          }))
        )
          .then((matches) => {
            setDbMatches(matches);
            if (matches.length > 0) {
              addLog(
                "merge_groups_detected",
                `Database check complete`,
                `${matches.length} teacher(s) already exist in the database`
              );
            } else {
              addLog(
                "merge_groups_detected",
                `Database check complete`,
                "No existing records found"
              );
            }
          })
          .catch(() => {
            // Non-fatal — DB check may fail if backend is unavailable
            addLog("merge_groups_detected", "Database check skipped", "Could not reach server");
          })
          .finally(() => setIsCheckingDB(false));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invalid session data";
        toast.error(msg);
        router.push("/upload");
      }
    } else {
      toast.error("No upload data found. Please upload a file first.");
      router.push("/upload");
    }
  }, [router, addLog]);

  const handleMerge = useCallback(
    (group: MergeGroup) => {
      const merged = mergeRows(group.rows);
      const first = group.rows[0] as UploadRow;
      addLog(
        "merged",
        `Merged ${group.rows.length} records (${group.reason})`,
        `Confidence: ${group.confidence}% • ${merged.name}`
      );
      const id = `merged-${group.indices.join("-")}`;
      const newRow: ReviewRow = {
        id,
        name: merged.name,
        phone: merged.phones[0] || "",
        email: merged.emails[0] || "",
        school: merged.school,
        books: merged.books,
        phones: merged.phones,
        emails: merged.emails,
        phoneSelected: merged.phones[0] || "",
        emailSelected: merged.emails[0] || "",
        channels: "both",
        mergedFrom: group.indices,
        recordId: first?.recordId,
        booksAssigned: first?.booksAssigned,
        teacherOwnerId: first?.teacherOwnerId,
        teacherOwner: first?.teacherOwner,
        firstName: first?.firstName,
        lastName: first?.lastName,
        institutionId: first?.institutionId,
        institutionName: first?.institutionName,
        salutation: first?.salutation,
      };
      setRows((prev) => {
        const exclude = new Set(group.indices);
        const kept = prev.filter((r) => {
          if (!r.mergedFrom) return true;
          const overlap = r.mergedFrom.some((i) => exclude.has(i));
          return !overlap;
        });
        return [...kept, newRow];
      });
      // Hide all groups that overlap with merged indices
      setMergedGroupIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        mergeGroups.forEach((g) => {
          const overlap = g.indices.some((i) => group.indices.includes(i));
          if (overlap) next.add(`merged-${g.indices.join("-")}`);
        });
        return next;
      });
    },
    [mergeGroups, addLog]
  );

  const handleKeepSeparate = useCallback(
    (group: MergeGroup) => {
      addLog(
        "kept_separate",
        `Kept ${group.rows.length} records separate`,
        `${group.reason} match (${group.confidence}% confidence)`
      );
      setMergeGroups((prev) => prev.filter((g) => g !== group));
    },
    [addLog]
  );

  const setPhoneSelected = useCallback(
    (rowId: string, phone: string) => {
      const row = rows.find((r) => r.id === rowId);
      addLog(
        "contact_selected",
        `Selected phone for ${row?.name || "teacher"}`,
        phone
      );
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, phoneSelected: phone } : r
        )
      );
    },
    [rows, addLog]
  );

  const setEmailSelected = useCallback(
    (rowId: string, email: string) => {
      const row = rows.find((r) => r.id === rowId);
      addLog(
        "contact_selected",
        `Selected email for ${row?.name || "teacher"}`,
        email
      );
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, emailSelected: email } : r
        )
      );
    },
    [rows, addLog]
  );

  const setChannels = useCallback(
    (rowId: string, channels: ChannelChoice) => {
      const row = rows.find((r) => r.id === rowId);
      addLog(
        "channel_per_teacher",
        `Channel changed for ${row?.name || "teacher"}`,
        `Set to: ${channels}`
      );
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, channels } : r))
      );
    },
    [rows, addLog]
  );

  const applyGlobalChannel = useCallback(() => {
    setRows((prev) =>
      prev.map((r) => ({ ...r, channels: globalChannel }))
    );
    addLog(
      "channel_applied",
      `Applied "${globalChannel}" to all teachers`,
      `${rows.length} teachers updated`
    );
    toast.success(`Applied "${globalChannel}" to all teachers`);
  }, [globalChannel, rows.length, addLog]);

  /** Get original row index(es) for a review row (for matching dbMatches) */
  const getRowIndices = useCallback((row: ReviewRow): number[] => {
    if (row.mergedFrom && row.mergedFrom.length > 0) return row.mergedFrom;
    const m = row.id.match(/^r-(\d+)$/);
    return m ? [parseInt(m[1], 10)] : [];
  }, []);

  const toReviewedRows = useCallback((): ReviewedRow[] => {
    return rows.map((r) => {
      const indices = getRowIndices(r);
      const exactMatch = dbMatches.find(
        (m) => m.diff.noChanges && indices.includes(m.rowIndex)
      );
      return {
        name: r.name,
        phone: r.phoneSelected || r.phone,
        email: r.emailSelected || r.email,
        school: r.school,
        books: r.books,
        phoneSelected: r.phones.length > 1 ? r.phoneSelected : undefined,
        emailSelected: r.emails.length > 1 ? r.emailSelected : undefined,
        channels: r.channels,
        existingTeacherId: exactMatch?.existingTeacher.id,
        recordId: r.recordId,
        booksAssigned: r.booksAssigned,
        teacherOwnerId: r.teacherOwnerId,
        teacherOwner: r.teacherOwner,
        firstName: r.firstName,
        lastName: r.lastName,
        institutionId: r.institutionId,
        institutionName: r.institutionName,
        salutation: r.salutation,
      };
    });
  }, [rows, dbMatches, getRowIndices]);

  const handleStartDistribution = async () => {
    const reviewed = toReviewedRows();
    const withContact = reviewed.filter(
      (r) =>
        r.channels !== "none" &&
        (((r.channels === "whatsapp" || r.channels === "both") &&
          (r.phoneSelected || r.phone)) ||
          ((r.channels === "email" || r.channels === "both") &&
            (r.emailSelected || r.email)))
    );

    addLog(
      "distribution_clicked",
      "Start Distribution clicked",
      `Preparing ${reviewed.length} teachers`
    );

    if (withContact.length === 0) {
      addLog("error", "Validation failed", "No teachers with contact and channel selected");
      toast.error("At least one teacher must have a contact and channel selected");
      return;
    }

    const channelSummary = withContact.reduce((acc, r) => { acc[r.channels] = (acc[r.channels] || 0) + 1; return acc; }, {} as Record<string, number>);
    const summaryStr = Object.entries(channelSummary).map(([k, v]) => `${v} ${k}`).join(', ');

    addLog(
      "validation_passed",
      "Validation passed",
      `${withContact.length} teacher(s) will receive messages (${summaryStr})`
    );

    setIsUploading(true);
    try {
      addLog("upload_api_calling", "Calling upload API", `Sending ${withContact.length} teachers with contact`);
      const result = await uploadSpecimenReviewed(withContact);
      addLog(
        "upload_api_success",
        "Upload API success",
        `Batch ${result.batchId} • ${result.teacherCount} teachers — pipeline started`
      );

      addLog("session_cleared", "Session cleared", "Removed temporary data");
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_FILE_KEY);

      addLog("redirect", "Redirecting to batch", result.batchId);
      toast.success("Distribution started");
      router.push(`/batches/${result.batchId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addLog("error", "Distribution failed", msg);
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  // Active merge modal
  const [mergeModalMatch, setMergeModalMatch] = useState<DBDuplicateMatch | null>(null);

  /** Canonical phone for comparison: 9997016578, +919997016578, 99997016578, 09997016578 → same */
  function phoneKey(phone: string): string {
    const d = (phone || "").replace(/\D/g, "");
    if (d.length === 10 && /^[6-9]/.test(d)) return d;
    if (d.length === 12 && d.startsWith("91")) return d.slice(2);
    if (d.length === 11 && (d.startsWith("0") || (d.startsWith("9") && /^[6-9]/.test(d[1] ?? "")))) return d.slice(1);
    return d;
  }

  /** Build merged phones: existing (deduped) + new at last index (= primary) */
  function buildMergedPhones(match: DBDuplicateMatch): string[] {
    const newKey = phoneKey(match.row.phone ?? "");
    const existing = (match.existingTeacher.phones || []).filter(
      (p) => phoneKey(p) !== newKey
    );
    return match.row.phone ? [...existing, match.row.phone] : existing;
  }

  /** Build merged emails: existing (deduped) + new at last index (= primary) */
  function buildMergedEmails(match: DBDuplicateMatch): string[] {
    const newEmail = match.row.email?.toLowerCase().trim() || "";
    const existing = (match.existingTeacher.emails || []).filter(
      (e) => e.toLowerCase().trim() !== newEmail
    );
    return newEmail ? [...existing, match.row.email] : existing;
  }

  // Remove a teacher from the upload (when admin decides not to re-send)
  const removeRowFromBatch = useCallback((match: DBDuplicateMatch) => {
    const rowId = `r-${match.rowIndex}`;
    setRemovedRowIds((prev) => new Set(prev).add(rowId));
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    setDismissedDbMatches((prev) => new Set(prev).add(match.rowIndex));
    setMergeModalMatch(null);
    addLog(
      "kept_separate",
      `Removed "${match.row.name}" from batch`,
      `Teacher already exists in DB (${match.confidence}% match)`
    );
    toast.success(`"${match.row.name}" removed from this batch`);
  }, [addLog]);

  const confirmMerge = useCallback(
    async (match: DBDuplicateMatch) => {
      const mergedPhones = buildMergedPhones(match);
      const mergedEmails = buildMergedEmails(match);
      try {
        await mergeTeacher({
          teacherId: match.existingTeacher.id,
          name: match.row.name,
          phones: mergedPhones,
          emails: mergedEmails,
        });
        setDismissedDbMatches((prev) => new Set(prev).add(match.rowIndex));
        setMergeModalMatch(null);
        addLog(
          "merged",
          `Merged and saved: ${match.row.name}`,
          `Updated DB record with ${mergedPhones.length} phone(s), ${mergedEmails.length} email(s)`
        );
        toast.success(`"${match.row.name}" merged and saved to database`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Merge failed";
        addLog("error", "Merge failed", msg);
        toast.error(msg);
      }
    },
    [addLog]
  );

  const pendingMergeGroups = mergeGroups.filter(
    (g) => !mergedGroupIds.has(`merged-${g.indices.join("-")}`)
  );

  const allPendingDbMatches = dbMatches.filter(
    (m) => !dismissedDbMatches.has(m.rowIndex) && !removedRowIds.has(`r-${m.rowIndex}`)
  );
  const exactMatchDb = allPendingDbMatches.filter((m) => m.diff.noChanges);
  const pendingDbMatches = allPendingDbMatches.filter((m) => !m.diff.noChanges);

  if (rows.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      <div>
        <button
          onClick={() => router.push("/upload")}
          className="mb-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Upload
        </button>
        <h1 className="text-2xl font-bold text-foreground">Review & Send</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review data, merge duplicates, choose contacts and channels before sending
        </p>
      </div>

      {/* Merge suggestions — Stage 1: within-CSV duplicate detection */}
      {pendingMergeGroups.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-amber-900">
            <Merge className="h-5 w-5" />
            Duplicate check — within this file ({pendingMergeGroups.length} found)
          </h2>
          <p className="mb-4 text-sm text-amber-700">
            These rows look like the same teacher. Merge to combine books and contacts, or keep separate.
            After upload, the system will also check against <strong>existing teachers in the database</strong>.
          </p>
          <div className="space-y-4">
            {pendingMergeGroups.map((group) => (
              <div
                key={group.indices.join("-")}
                className={clsx(
                  "rounded-lg border bg-card p-4",
                  group.confidence >= 90
                    ? "border-red-200"
                    : group.confidence >= 75
                    ? "border-amber-200"
                    : "border-orange-200"
                )}
              >
                {/* Header row: reason badge + confidence bar */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {/* Match type badge */}
                  <span
                    className={clsx(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      group.reason === "email" && "bg-blue-100 text-blue-700",
                      group.reason === "phone" && "bg-green-100 text-green-700",
                      group.reason === "name_school" && "bg-purple-100 text-purple-700"
                    )}
                  >
                    {group.reason === "email"
                      ? "Same email"
                      : group.reason === "phone"
                      ? "Same phone"
                      : "Similar name & school"}
                  </span>

                  {/* Confidence score badge */}
                  <span
                    className={clsx(
                      "rounded-full px-2.5 py-0.5 text-xs font-bold",
                      group.confidence >= 90
                        ? "bg-red-100 text-red-700"
                        : group.confidence >= 75
                        ? "bg-amber-100 text-amber-700"
                        : "bg-orange-100 text-orange-700"
                    )}
                  >
                    {group.confidence}% confidence
                  </span>

                  {/* Match detail chips */}
                  {group.matchDetails.map((d, idx) => (
                    <span
                      key={idx}
                      className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {d}
                    </span>
                  ))}
                </div>

                {/* Row comparison */}
                <div className="mb-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pb-1 pr-3 font-medium">Name</th>
                        <th className="pb-1 pr-3 font-medium">School</th>
                        <th className="pb-1 pr-3 font-medium">Phone</th>
                        <th className="pb-1 pr-3 font-medium">Email</th>
                        <th className="pb-1 font-medium">Books</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((r, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="py-1.5 pr-3 font-medium">{r.name}</td>
                          <td className="py-1.5 pr-3 text-muted-foreground">{r.school}</td>
                          <td className="py-1.5 pr-3 font-mono">{r.phone}</td>
                          <td className="py-1.5 pr-3">{r.email}</td>
                          <td className="max-w-[160px] truncate py-1.5 text-muted-foreground">{r.books}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleKeepSeparate(group)}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted/50"
                  >
                    Keep separate
                  </button>
                  <button
                    onClick={() => handleMerge(group)}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-amber-700"
                  >
                    <Merge className="h-4 w-4" />
                    Merge records
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exact matches — teacher already exists, saving skipped */}
      {!isCheckingDB && exactMatchDb.length > 0 && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3">
          <h2 className="mb-0.5 flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-100">
            <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Teacher already exists — saving skipped ({exactMatchDb.length})
          </h2>
          <p className="mb-2 text-xs text-emerald-700 dark:text-emerald-300">
            These teachers match existing records exactly (same name, email, phone). No merge needed — existing data will be used.
          </p>
          <div className="space-y-1">
            {exactMatchDb.map((match) => (
              <div
                key={match.rowIndex}
                className="flex items-center gap-3 rounded border border-emerald-200 dark:border-emerald-500/20 bg-white dark:bg-card px-3 py-1.5"
              >
                <p className="text-sm font-medium text-foreground">{match.row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {match.row.school} · {match.row.email || match.row.phone}
                </p>
                <span className="ml-auto shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Already in DB — using existing record
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DB duplicate check — loading */}
      {isCheckingDB && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <p className="text-sm text-blue-800">Checking against existing database records…</p>
        </div>
      )}

      {/* DB duplicate matches — compact cards */}
      {!isCheckingDB && pendingDbMatches.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/50 p-6">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-foreground">
            <Database className="h-5 w-5 text-primary" />
            Already in database ({pendingDbMatches.length} match{pendingDbMatches.length !== 1 ? "es" : ""})
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            These teachers already exist. Click <strong>Merge</strong> to preview how the records will be combined,
            or <strong>Remove</strong> to skip them from this batch.
          </p>

          <div className="space-y-3">
            {pendingDbMatches.map((match) => (
              <div
                key={match.rowIndex}
                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{match.row.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {match.row.school} · {match.row.email || match.row.phone}
                    </p>
                  </div>
                  <span className={clsx(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold",
                    match.confidence === 100
                      ? "bg-primary/20 text-primary"
                      : "bg-primary/15 text-primary"
                  )}>
                    {match.confidence}% match
                  </span>
                  {match.matchReasons.slice(0, 1).map((r, idx) => (
                    <span key={idx} className="hidden shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground sm:inline">
                      {r}
                    </span>
                  ))}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => removeRowFromBatch(match)}
                    className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    Remove
                  </button>
                  <button
                    onClick={() => setMergeModalMatch(match)}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Merge className="h-3.5 w-3.5" />
                    Merge
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Merge preview modal */}
      {mergeModalMatch && (() => {
        const match = mergeModalMatch;
        const mergedPhones = buildMergedPhones(match);
        const mergedEmails = buildMergedEmails(match);
        return (
          <Portal>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl">
              {/* Modal header */}
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div className="flex items-center gap-2">
                  <Merge className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Merge Teacher Record</h3>
                </div>
                <button
                  onClick={() => setMergeModalMatch(null)}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal body */}
              <div className="space-y-5 px-6 py-5">
                <p className="text-sm text-muted-foreground">
                  The existing record will be updated with new contact details.
                  The <span className="font-semibold text-primary">last entry</span> in each list
                  becomes the primary contact for this send.
                </p>

                {/* Name */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</p>
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3">
                    <span className="font-medium text-foreground">{match.row.name}</span>
                    {match.row.name !== match.existingTeacher.name && (
                      <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        updated from &ldquo;{match.existingTeacher.name}&rdquo;
                      </span>
                    )}
                  </div>
                </div>

                {/* Phone numbers */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Phone numbers
                  </p>
                  <div className="overflow-hidden rounded-lg border border-border">
                    {mergedPhones.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">No phone numbers</p>
                    ) : (
                      mergedPhones.map((phone, idx) => {
                        const isNew = phone === match.row.phone;
                        const isPrimary = idx === mergedPhones.length - 1;
                        return (
                          <div
                            key={idx}
                            className={clsx(
                              "flex items-center justify-between gap-4 px-4 py-3 text-sm",
                              idx < mergedPhones.length - 1 && "border-b border-border",
                              isPrimary ? "bg-primary/10" : "bg-muted/30"
                            )}
                          >
                            <span className="font-mono text-foreground">{phone}</span>
                            <div className="flex shrink-0 items-center gap-2">
                              {isNew && (
                                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                  new
                                </span>
                              )}
                              {isPrimary && (
                                <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-bold text-primary">
                                  ★ primary
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Email addresses */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Email addresses
                  </p>
                  <div className="overflow-hidden rounded-lg border border-border">
                    {mergedEmails.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">No email addresses</p>
                    ) : (
                      mergedEmails.map((email, idx) => {
                        const isNew = email === match.row.email;
                        const isPrimary = idx === mergedEmails.length - 1;
                        return (
                          <div
                            key={idx}
                            className={clsx(
                              "flex items-center justify-between gap-4 px-4 py-3 text-sm",
                              idx < mergedEmails.length - 1 && "border-b border-border",
                              isPrimary ? "bg-primary/10" : "bg-muted/30"
                            )}
                          >
                            <span className="min-w-0 truncate text-foreground">{email}</span>
                            <div className="flex shrink-0 items-center gap-2">
                              {isNew && (
                                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                  new
                                </span>
                              )}
                              {isPrimary && (
                                <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-bold text-primary">
                                  ★ primary
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">
                <button
                  onClick={() => removeRowFromBatch(match)}
                  className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Remove from batch
                </button>
                <button
                  onClick={() => confirmMerge(match)}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <CheckCircle className="h-4 w-4" />
                  Confirm merge &amp; send
                </button>
              </div>
            </div>
          </div>
          </Portal>
        );
      })()}

      {/* Global channel selection */}
      <div className="max-w-4xl rounded-lg border border-border bg-card px-4 py-3">
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          Channel selection
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">Apply to all:</span>
          {(["both", "whatsapp", "email", "none"] as const).map((ch) => (
            <label key={ch} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="globalChannel"
                value={ch}
                checked={globalChannel === ch}
                onChange={() => {
                  setGlobalChannel(ch);
                  addLog("channel_applied", `Applied "${ch}" to all teachers`, `${rows.length} teachers`);
                  setRows((prev) => prev.map((r) => ({ ...r, channels: ch })));
                }}
                className="h-4 w-4 border-border text-blue-600"
              />
              <span className="text-xs capitalize">
                {ch === "both" && "Both (WhatsApp + Email)"}
                {ch === "whatsapp" && "WhatsApp only"}
                {ch === "email" && "Email only"}
                {ch === "none" && "None"}
              </span>
            </label>
          ))}
          <button
            onClick={applyGlobalChannel}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-blue-700"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Final list */}
      <div className="w-full rounded-lg border border-border bg-card px-4 py-3">
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          Final list ({rows.length} teachers)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-1.5 pr-2">Name</th>
                <th className="pb-1.5 pr-2">School</th>
                <th className="pb-1.5 pr-2">Products</th>
                <th className="pb-1.5 pr-2">WhatsApp</th>
                <th className="pb-1.5 pr-2">Email</th>
                <th className="pb-1.5 pr-2">Channels</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border/50 hover:bg-muted/50"
                >
                  <td className="py-1.5 pr-2 font-medium">{row.name}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{row.school}</td>
                  <td className="max-w-[200px] truncate py-1.5 pr-2 text-muted-foreground">
                    {row.books}
                  </td>
                  <td className="py-1.5 pr-2">
                    {row.phones.length > 1 ? (
                      <select
                        value={row.phoneSelected}
                        onChange={(e) =>
                          setPhoneSelected(row.id, e.target.value)
                        }
                        className="rounded border border-border bg-card px-1.5 py-0.5 text-xs"
                      >
                        {row.phones.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-mono text-xs">
                        {row.phone || "—"}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    {row.emails.length > 1 ? (
                      <select
                        value={row.emailSelected}
                        onChange={(e) =>
                          setEmailSelected(row.id, e.target.value)
                        }
                        className="rounded border border-border bg-card px-1.5 py-0.5 text-xs"
                      >
                        {row.emails.map((e) => (
                          <option key={e} value={e}>
                            {e}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs">{row.email || "—"}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    <select
                      value={row.channels}
                      onChange={(e) =>
                        setChannels(row.id, e.target.value as ChannelChoice)
                      }
                      className="rounded border border-border bg-card px-1.5 py-0.5 text-xs"
                    >
                      <option value="both">Both</option>
                      <option value="whatsapp">WhatsApp only</option>
                      <option value="email">Email only</option>
                      <option value="none">None</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Step logs */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
          <FileText className="h-5 w-5" />
          Activity log — every step
        </h2>
        <div className="max-h-64 overflow-y-auto space-y-2">
          {stepLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet</p>
          ) : (
            stepLogs.map((log) => {
              const isError = log.step === "error";
              return (
                <div
                  key={log.id}
                  className={clsx(
                    "flex items-start gap-3 rounded-lg px-3 py-2 text-sm",
                    isError ? "bg-red-50" : "bg-muted/50"
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground/20 text-xs font-bold text-muted-foreground">
                    {log.stepNumber}
                  </span>
                  {isError ? (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  ) : (
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={clsx("font-medium", isError ? "text-red-900" : "text-foreground")}>
                      {log.message}
                    </p>
                    {log.detail && (
                      <p className={clsx("mt-0.5 text-xs", isError ? "text-red-700" : "text-muted-foreground")}>
                        {log.detail}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground/70">
                      {log.timestamp.toLocaleTimeString()} • {log.step}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">
          File: {fileName} • {rows.length} teachers
        </p>
        <button
          onClick={handleStartDistribution}
          disabled={isUploading}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-blue-700 disabled:opacity-50"
        >
          {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
          Start Distribution
        </button>
      </div>
    </div>
  );
}
