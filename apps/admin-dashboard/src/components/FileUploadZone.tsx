"use client";

import { useCallback, useState, useRef } from "react";
import { Upload, FileSpreadsheet, X } from "lucide-react";
import { clsx } from "clsx";

interface Props {
  onFileSelect: (file: File) => void;
  onClear?: () => void;
  accept?: string;
}

export default function FileUploadZone({
  onFileSelect,
  onClear,
  accept = ".xlsx,.csv",
}: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) {
        console.log("[FileUploadZone] File dropped:", file.name);
        setSelectedFile(file);
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      console.log("[FileUploadZone] File selected:", file?.name ?? "none");
      if (file) {
        setSelectedFile(file);
        onFileSelect(file);
      }
      // Reset so same file can be selected again
      setTimeout(() => { e.target.value = ""; }, 0);
    },
    [onFileSelect]
  );

  const clearFile = () => {
    setSelectedFile(null);
    if (inputRef.current) inputRef.current.value = "";
    onClear?.();
  };

  return (
    <div>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={clsx(
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/50"
        )}
      >
        <Upload
          className={clsx(
            "mb-4 h-10 w-10 transition-colors",
            isDragOver ? "text-primary" : "text-muted-foreground"
          )}
        />
        <p className="text-sm font-medium text-foreground">
          {isDragOver
            ? "Drop your file here"
            : "Drag and drop your specimen file here"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          or choose a file below. Accepts .xlsx, .csv
        </p>
        {/* Native file input - label makes the whole button trigger file picker */}
        <label className="mt-4 inline-flex cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            onChange={handleFileInput}
            className="hidden"
          />
          Choose file
        </label>
      </div>

      {selectedFile && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm transition-colors">
          <FileSpreadsheet className="h-8 w-8 text-green-500" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {selectedFile.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearFile();
            }}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
