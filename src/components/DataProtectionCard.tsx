"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FolderSync, HardDrive, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { exportLocalRecoveryBundle, restoreLocalBackup, withWorkspaceClosed } from "@/lib/localdb";
import { decodeBackup, encodeBackup, type BackupData } from "@/lib/backup";
import {
  browserStorageIsPersistent,
  configureRecoveryFolder,
  recoveryFolderStatus,
  recoveryFolderError,
  requestPersistentBrowserStorage,
} from "@/lib/recovery-folder";

type FolderStatus = Awaited<ReturnType<typeof recoveryFolderStatus>> | "checking";

export default function DataProtectionCard() {
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [folder, setFolder] = useState<FolderStatus>("checking");
  const [busy, setBusy] = useState<"storage" | "folder" | "export" | "import" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupData | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([browserStorageIsPersistent(), recoveryFolderStatus()]).then(
      ([isPersistent, folderStatus]) => {
        setPersistent(isPersistent);
        setFolder(folderStatus);
      }
    ).catch(() => setMessage("Storage protection status could not be checked."));
    const refreshFolder = () => {
      void recoveryFolderStatus().then(setFolder).catch(() => setFolder("error"));
      const error = recoveryFolderError();
      if (error) setMessage(`Recovery folder is not up to date: ${error}. Download a backup or reconnect the folder.`);
    };
    window.addEventListener("voltline-recovery-status", refreshFolder);
    window.addEventListener("focus", refreshFolder);
    return () => {
      window.removeEventListener("voltline-recovery-status", refreshFolder);
      window.removeEventListener("focus", refreshFolder);
    };
  }, []);

  async function protectStorage() {
    setBusy("storage");
    setMessage(null);
    try {
      const granted = await requestPersistentBrowserStorage();
      setPersistent(granted || (await browserStorageIsPersistent()));
      setMessage(
        granted
          ? "This browser agreed not to evict Voltline data automatically."
          : "The browser did not grant persistent storage; use a recovery folder as the second copy."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Storage protection could not be requested.");
    } finally {
      setBusy(null);
    }
  }

  async function downloadBackup() {
    setBusy("export");
    setMessage(null);
    try {
      const data = await withWorkspaceClosed(exportLocalRecoveryBundle);
      const blob = await encodeBackup(data);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `voltline-${new Date().toISOString().slice(0, 10)}.voltline.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage(`Backup downloaded: ${data.snapshot.tables.projects?.length ?? 0} projects and ${data.files.length} plan PDFs. Keep this file on another drive.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Backup could not be downloaded.");
    } finally { setBusy(null); }
  }

  async function inspectBackup(file?: File) {
    if (!file) return;
    setBusy("import");
    setBackup(null);
    setMessage(null);
    try { setBackup(await decodeBackup(file)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Backup could not be read."); }
    finally { setBusy(null); if (input.current) input.current.value = ""; }
  }

  async function restoreBackup() {
    if (!backup) return;
    setBusy("import");
    try {
      await restoreLocalBackup(backup);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Restore failed. Existing work has been preserved.");
      setBusy(null);
    }
  }

  async function chooseFolder() {
    setBusy("folder");
    setMessage(null);
    try {
      const { snapshot, files } = await withWorkspaceClosed(exportLocalRecoveryBundle);
      await configureRecoveryFolder(snapshot, files);
      setFolder("ready");
      setMessage("Recovery folder connected. New changes and plan PDFs will be mirrored there.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("Folder selection was cancelled.");
      } else {
        setMessage(error instanceof Error ? error.message : "The recovery folder could not be connected.");
      }
      setFolder(await recoveryFolderStatus());
    } finally {
      setBusy(null);
    }
  }

  const folderReady = folder === "ready";
  return (
    <section className="local-card" aria-labelledby="data-protection-title">
      <div className="titlebar flex items-center gap-2" id="data-protection-title">
        <HardDrive size={14} />
        Data protection
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--color-fg-dim)]">Back up before moving computers or clearing site data. The file includes plan PDFs.</p>
      <div className="mt-3 space-y-1.5 border-t border-[var(--color-line)] pt-3 text-[11px] leading-4 text-[var(--color-fg-dim)]">
        <StatusRow
          ok={persistent === true}
          pending={persistent === null}
          label={persistent ? "Persistent browser storage" : "Browser storage can be evicted"}
        />
        <StatusRow
          ok={folderReady}
          pending={folder === "checking"}
          label={
            folderReady
              ? "Recovery folder connected"
              : folder === "error"
              ? "Recovery folder needs attention"
              : folder === "permission-needed"
              ? "Recovery folder permission expired"
              : folder === "unsupported"
              ? "Folder mirror unavailable in this browser"
              : "Recovery folder not connected"
          }
        />
        <StatusRow ok={false} label="Stored on this device only · cloud sync is not connected" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn btn-volt justify-center text-xs" aria-label="Download backup" onClick={downloadBackup} disabled={busy !== null}>
          <Download size={14} /> {busy === "export" ? "Preparing…" : "Download"}
        </button>
        <button className="btn justify-center text-xs" aria-label="Restore backup" onClick={() => input.current?.click()} disabled={busy !== null}>
          <Upload size={14} /> {busy === "import" ? "Checking…" : "Restore"}
        </button>
      </div>
      <input ref={input} type="file" accept=".json" className="sr-only" aria-label="Backup file" onChange={event => void inspectBackup(event.target.files?.[0])} />
      {(!persistent || folder !== "unsupported") && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {!persistent && (
            <button className="inline-flex items-center gap-1.5 text-[var(--color-volt)] underline-offset-2 hover:underline disabled:opacity-50" onClick={protectStorage} disabled={busy !== null}>
              <ShieldCheck size={12} /> {busy === "storage" ? "Requesting…" : "Protect browser storage"}
            </button>
          )}
          {folder !== "unsupported" && (
            <button className="inline-flex items-center gap-1.5 text-[var(--color-volt)] underline-offset-2 hover:underline disabled:opacity-50" onClick={chooseFolder} disabled={busy !== null}>
              <FolderSync size={12} /> {busy === "folder" ? "Connecting…" : folderReady ? "Change recovery folder" : "Choose recovery folder"}
            </button>
          )}
        </div>
      )}
      {backup && (
        <div className="mt-4 border border-[var(--color-line)] p-3" aria-label="Backup preview">
          <h3 className="text-sm font-semibold">Ready to restore</h3>
          <p className="mt-1 text-xs leading-5">{backup.snapshot.tables.projects.length} projects · {backup.files.length} plan PDFs · {new Date(backup.snapshot.exported_at).toLocaleString()}</p>
          <ul className="my-2 max-h-32 overflow-auto text-xs">{backup.snapshot.tables.projects.map(project => <li key={String(project.id)}>{String(project.name)}</li>)}</ul>
          <p className="text-xs leading-5">Restore requires an empty workspace. For a workspace that already has data, use a new browser profile.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-volt text-xs" onClick={restoreBackup} disabled={busy !== null}>Restore this backup</button>
            <button className="btn text-xs" onClick={() => { setBackup(null); setMessage(null); }} disabled={busy !== null}>Cancel</button>
          </div>
        </div>
      )}
      {message && <p className="mt-2 text-[10.5px] leading-4 text-[var(--color-fg-faint)]" role="status">{message}</p>}
    </section>
  );
}

function StatusRow({
  ok,
  pending = false,
  label,
}: {
  ok: boolean;
  pending?: boolean;
  label: string;
}) {
  const Icon = ok ? CheckCircle2 : ShieldAlert;
  return (
    <div className="flex items-start gap-2">
      <Icon
        size={13}
        className={`mt-0.5 shrink-0 ${ok ? "text-[var(--color-ok)]" : "text-[var(--color-warn)]"}`}
      />
      <span>{pending ? "Checking storage protection…" : label}</span>
    </div>
  );
}
