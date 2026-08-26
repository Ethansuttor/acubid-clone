"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FolderSync, HardDrive, ShieldAlert, ShieldCheck } from "lucide-react";
import { exportLocalRecoveryBundle } from "@/lib/localdb";
import {
  browserStorageIsPersistent,
  configureRecoveryFolder,
  recoveryFolderStatus,
  requestPersistentBrowserStorage,
} from "@/lib/recovery-folder";

type FolderStatus = Awaited<ReturnType<typeof recoveryFolderStatus>> | "checking";

export default function DataProtectionCard() {
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [folder, setFolder] = useState<FolderStatus>("checking");
  const [busy, setBusy] = useState<"storage" | "folder" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([browserStorageIsPersistent(), recoveryFolderStatus()]).then(
      ([isPersistent, folderStatus]) => {
        setPersistent(isPersistent);
        setFolder(folderStatus);
      }
    );
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
    } finally {
      setBusy(null);
    }
  }

  async function chooseFolder() {
    setBusy("folder");
    setMessage(null);
    try {
      const { snapshot, files } = await exportLocalRecoveryBundle();
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
      <div className="flex items-center gap-2 text-sm font-medium" id="data-protection-title">
        <HardDrive size={16} className="text-[var(--color-volt)]" />
        Data protection
      </div>
      <div className="mt-3 space-y-2 text-[11px] leading-4 text-[var(--color-fg-dim)]">
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
              : folder === "unsupported"
              ? "Folder mirror unavailable in this browser"
              : "Recovery folder not connected"
          }
        />
        <StatusRow ok={false} label="Cloud sync needs Supabase credentials" />
      </div>
      <div className="mt-3 grid gap-2">
        {!persistent && (
          <button className="btn w-full justify-center !px-2 text-xs" onClick={protectStorage} disabled={busy !== null}>
            <ShieldCheck size={14} /> {busy === "storage" ? "Requesting…" : "Protect browser storage"}
          </button>
        )}
        {folder !== "unsupported" && (
          <button className="btn w-full justify-center !px-2 text-xs" onClick={chooseFolder} disabled={busy !== null}>
            <FolderSync size={14} /> {busy === "folder" ? "Connecting…" : folderReady ? "Change recovery folder" : "Choose recovery folder"}
          </button>
        )}
      </div>
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
        className={`mt-0.5 shrink-0 ${ok ? "text-[var(--color-success)]" : "text-[var(--color-volt)]"}`}
      />
      <span>{pending ? "Checking storage protection…" : label}</span>
    </div>
  );
}
