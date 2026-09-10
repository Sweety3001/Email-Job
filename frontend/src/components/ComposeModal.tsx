import { useRef, useState } from "react";
import { api } from "../api/client";
import { Button } from "../components/Button";
import { Input, Textarea } from "../components/Input";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { parseEmailFile } from "../lib/csv";
import { toDateTimeLocalValue } from "../lib/format";

export interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

export function ComposeModal({ open, onClose, onScheduled }: ComposeModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(Date.now() + 2 * 60 * 1000); // default: 2 minutes from now
    return toDateTimeLocalValue(d);
  });
  const [delaySeconds, setDelaySeconds] = useState("5");
  const [hourlyLimit, setHourlyLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setSubject("");
    setBody("");
    setRecipients([]);
    setFileName(null);
    setDuplicateCount(0);
    setDelaySeconds("5");
    setHourlyLimit("");
    setErrors({});
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    const { emails, duplicates } = parseEmailFile(text);
    setRecipients(emails);
    setDuplicateCount(duplicates);
    setFileName(file.name);
    if (emails.length === 0) {
      toast("No valid email addresses found in that file", "error");
    }
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!subject.trim()) e.subject = "Subject is required";
    if (!body.trim()) e.body = "Body is required";
    if (recipients.length === 0) e.recipients = "Upload a CSV/text file with email leads";
    if (!startTime) e.startTime = "Start time is required";
    else if (new Date(startTime).getTime() <= Date.now() - 60_000) e.startTime = "Start time must be in the future";
    const d = Number(delaySeconds);
    if (!Number.isFinite(d) || d < 0) e.delaySeconds = "Delay must be a non-negative number of seconds";
    if (hourlyLimit) {
      const h = Number(hourlyLimit);
      if (!Number.isFinite(h) || h < 1) e.hourlyLimit = "Hourly limit must be ≥ 1";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await api.campaigns.create({
        subject: subject.trim(),
        body: body.trim(),
        recipients,
        startTime: new Date(startTime).toISOString(),
        delaySeconds: Number(delaySeconds),
        hourlyLimit: hourlyLimit ? Number(hourlyLimit) : undefined,
      });
      toast(`Scheduled ${res.queued} email(s) — first send at ${new Date(res.firstSendAt).toLocaleTimeString()}`, "success");
      reset();
      onClose();
      onScheduled();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Compose New Email" wide>
      <div className="space-y-4">
        <Input
          label="Subject"
          name="subject"
          placeholder="Quick question about your outreach stack"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          error={errors.subject}
        />

        <Textarea
          label="Body"
          name="body"
          placeholder={"Hi {{first_name}},\n\nI noticed your team is scaling outreach..."}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={errors.body}
        />

        {/* Lead upload */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Upload leads (CSV / TXT)</label>
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-8 transition-colors hover:border-brand-400 hover:bg-brand-50/40"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
              <path d="M12 16V4m0 0 4 4m-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
            </svg>
            <p className="mt-2 text-sm text-gray-600">
              <span className="font-medium text-brand-600">Click to upload</span> or drag &amp; drop
            </p>
            <p className="text-xs text-gray-400">CSV or TXT with email addresses</p>
          </div>

          {recipients.length > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3 text-sm">
              <div>
                <span className="font-semibold text-emerald-700">{recipients.length} email address{recipients.length === 1 ? "" : "es"} detected</span>
                {fileName && <span className="text-emerald-600"> in {fileName}</span>}
                {duplicateCount > 0 && <span className="text-emerald-600"> · {duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"} removed</span>}
              </div>
              <button
                className="text-xs font-medium text-emerald-700 underline hover:text-emerald-800"
                onClick={() => {
                  setRecipients([]);
                  setFileName(null);
                  setDuplicateCount(0);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Clear
              </button>
            </div>
          )}
          {errors.recipients && <p className="mt-1 text-xs text-red-600">{errors.recipients}</p>}
          {recipients.length > 0 && recipients.length <= 3 && (
            <p className="mt-1 truncate text-xs text-gray-400">{recipients.join(", ")}</p>
          )}
          {recipients.length > 3 && <p className="mt-1 truncate text-xs text-gray-400">{recipients.slice(0, 3).join(", ")} +{recipients.length - 3} more</p>}
        </div>

        {/* Scheduling config */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Start time"
            name="startTime"
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            error={errors.startTime}
          />
          <Input
            label="Delay between emails (s)"
            name="delaySeconds"
            type="number"
            min="0"
            value={delaySeconds}
            onChange={(e) => setDelaySeconds(e.target.value)}
            hint="Seconds between each send"
            error={errors.delaySeconds}
          />
          <Input
            label="Hourly limit (optional)"
            name="hourlyLimit"
            type="number"
            min="1"
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(e.target.value)}
            hint="Leave empty to use server default"
            error={errors.hourlyLimit}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            Schedule {recipients.length > 0 ? `${recipients.length} email${recipients.length === 1 ? "" : "s"}` : ""}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
