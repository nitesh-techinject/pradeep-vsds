"use client";

import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { clsx } from "clsx";
import { Portal } from "@/components/Portal";
import { useQueryClient } from "@tanstack/react-query";
import DataTable, { type Column } from "@/components/DataTable";
import LoadingSpinner from "@/components/LoadingSpinner";
import type { Teacher } from "@/types";
import { useTeachers } from "@/hooks/useTeachers";
import { formatDate } from "@/utils/date";
import { addTeacherContacts, type ContactConflict } from "@/services/api";

const columns: Column<Teacher>[] = [
  { key: "id", header: "DB ID", mobileHidden: true, render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.id}</span> },
  {
    key: "name",
    header: "Teacher Name",
    render: (row) => <span className="font-medium text-foreground">{row.name}</span>,
  },
  { key: "salutation", header: "Salutation", mobileHidden: true },
  { key: "firstName", header: "First Name", mobileHidden: true },
  { key: "lastName", header: "Last Name", mobileHidden: true },
  {
    key: "phone",
    header: "Phone",
    render: (row) => {
      const phones = row.phones?.length ? row.phones : row.phone ? [row.phone] : [];
      return (
        <div className="flex flex-wrap gap-1">
          {phones.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            phones.map((p, i) => (
              <span
                key={i}
                className={clsx(
                  "font-mono text-sm",
                  i === phones.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {p}
                {i < phones.length - 1 ? "," : ""}
              </span>
            ))
          )}
        </div>
      );
    },
  },
  {
    key: "email",
    header: "Email",
    render: (row) => {
      const emails = row.emails?.length ? row.emails : row.email ? [row.email] : [];
      return (
        <div className="flex flex-wrap gap-1">
          {emails.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            emails.map((e, i) => (
              <span
                key={i}
                className={clsx(
                  "text-sm",
                  i === emails.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {e}
                {i < emails.length - 1 ? "," : ""}
              </span>
            ))
          )}
        </div>
      );
    },
  },
  { key: "school", header: "School" },
  { key: "institutionName", header: "Institution Name", mobileHidden: true },
  { key: "institutionId", header: "Institution Id", mobileHidden: true },
  { key: "booksAssigned", header: "Books Assigned", mobileHidden: true },
  { key: "teacherOwner", header: "Teacher Owner", mobileHidden: true },
  { key: "teacherOwnerId", header: "Teacher Owner Id", mobileHidden: true },
  { key: "city", header: "City" },
  {
    key: "createdAt",
    header: "Added",
    render: (row) => formatDate(row.createdAt),
  },
  { key: "recordId", header: "Record Id", mobileHidden: true },
];

function hasNoContacts(row: Teacher) {
  const hasPhone = row.phones?.length ? row.phones.some(Boolean) : !!row.phone;
  const hasEmail = row.emails?.length ? row.emails.some(Boolean) : !!row.email;
  return !hasPhone && !hasEmail;
}

// ─── Add Contact Modal ────────────────────────────────────────────────────────

function AddContactModal({
  teacher,
  onClose,
  onSaved,
}: {
  teacher: Teacher;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<ContactConflict[]>([]);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!phone.trim() && !email.trim()) {
      setError("Enter at least a phone number or email.");
      return;
    }
    setSaving(true);
    setConflicts([]);
    setError("");
    try {
      const result = await addTeacherContacts(teacher.id, {
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      if (result.conflicts?.length) {
        setConflicts(result.conflicts);
      } else {
        onSaved();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Add Contact Info</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{teacher.name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setConflicts([]); setError(""); }}
              placeholder="e.g. 9876543210"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {conflicts.find(c => c.field === "phone") && (
              <p className="mt-1 text-xs text-red-600">
                Already used by <strong>{conflicts.find(c => c.field === "phone")!.ownerName}</strong>
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setConflicts([]); setError(""); }}
              placeholder="e.g. teacher@school.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {conflicts.find(c => c.field === "email") && (
              <p className="mt-1 text-xs text-red-600">
                Already used by <strong>{conflicts.find(c => c.field === "email")!.ownerName}</strong>
              </p>
            )}
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeachersPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [addContactTeacher, setAddContactTeacher] = useState<Teacher | null>(null);
  const queryClient = useQueryClient();

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: response, isLoading } = useTeachers({
    page,
    pageSize,
    search: debouncedSearch || undefined,
  });

  const teachers = response?.data || [];
  const total = response?.total || 0;
  const totalPages = response?.totalPages || Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Teachers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search and manage teacher records
        </p>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="text"
            placeholder="Search by name, phone, email, school, or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {total.toLocaleString()} teacher{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <DataTable
          columns={columns}
          data={teachers}
          keyExtractor={(row) => row.id}
          onRowClick={(row) => {
            if (hasNoContacts(row)) setAddContactTeacher(row);
          }}
          rowClassName={(row) =>
            hasNoContacts(row)
              ? "bg-red-50 cursor-pointer hover:bg-red-100"
              : ""
          }
          pagination={{
            page,
            pageSize,
            total,
            totalPages,
            onPageChange: setPage,
            onPageSizeChange: (s) => { setPageSize(s); setPage(1); },
            pageSizeOptions: [10, 20, 50, 100],
          }}
        />
      )}

      {addContactTeacher && (
        <AddContactModal
          teacher={addContactTeacher}
          onClose={() => setAddContactTeacher(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["teachers"] })}
        />
      )}
    </div>
  );
}
