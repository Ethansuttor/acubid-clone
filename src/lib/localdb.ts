"use client";

// Local mode: an in-browser stand-in for the narrow supabase-js subset this
// app uses, persisted to localStorage. Enabled with NEXT_PUBLIC_LOCAL_MODE=1.
// Exists so the app can run and be end-to-end tested in environments where
// egress to supabase.co is unavailable. Production uses real Supabase.

const LOCAL_USER = {
  id: "00000000-0000-4000-8000-00000000cafe",
  email: "local@voltline.dev",
};

type Row = Record<string, unknown>;

function loadTable(table: string): Row[] {
  try {
    return JSON.parse(localStorage.getItem(`voltline.local.${table}`) ?? "[]");
  } catch {
    return [];
  }
}

function saveTable(table: string, rows: Row[]) {
  localStorage.setItem(`voltline.local.${table}`, JSON.stringify(rows));
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private rows: Row[] = [];
  private patch: Row = {};
  private filters: ((r: Row) => boolean)[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private wantSingle = false;

  constructor(private table: string) {}

  select(_cols?: string) {
    void _cols;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[]) {
    this.op = "upsert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }

  private matches(r: Row) {
    return this.filters.every((f) => f(r));
  }

  private run(): { data: unknown; error: unknown } {
    let all = loadTable(this.table);
    if (this.op === "insert" || this.op === "upsert") {
      const defaults = () => ({
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      const inserted: Row[] = [];
      for (const raw of this.rows) {
        const row = { ...defaults(), ...raw };
        const idx = all.findIndex((r) => r.id === row.id);
        if (idx >= 0 && this.op === "upsert") all[idx] = { ...all[idx], ...row };
        else if (idx >= 0) return { data: null, error: { message: "duplicate id" } };
        else all.push(row);
        inserted.push(row);
      }
      saveTable(this.table, all);
      return { data: this.wantSingle ? inserted[0] : inserted, error: null };
    }
    if (this.op === "update") {
      all = all.map((r) => (this.matches(r) ? { ...r, ...this.patch } : r));
      saveTable(this.table, all);
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      // emulate FK cascades used by the schema
      const doomed = all.filter((r) => this.matches(r));
      saveTable(this.table, all.filter((r) => !this.matches(r)));
      cascadeDelete(this.table, doomed);
      return { data: null, error: null };
    }
    // select
    let out = all.filter((r) => this.matches(r));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out = [...out].sort((a, b) => {
        const av = a[col] as string | number;
        const bv = b[col] as string | number;
        return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    if (this.wantSingle) {
      return out.length === 1
        ? { data: out[0], error: null }
        : { data: null, error: { message: `expected 1 row, got ${out.length}` } };
    }
    return { data: out, error: null };
  }

  then<T1 = { data: unknown; error: unknown }, T2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): Promise<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

const CASCADES: Record<string, { child: string; fk: string }[]> = {
  projects: [
    { child: "documents", fk: "project_id" },
    { child: "sheets", fk: "project_id" },
    { child: "layers", fk: "project_id" },
    { child: "takeoffs", fk: "project_id" },
  ],
  documents: [{ child: "sheets", fk: "document_id" }],
  sheets: [{ child: "takeoffs", fk: "sheet_id" }],
  layers: [{ child: "takeoffs", fk: "layer_id" }],
  items: [{ child: "assembly_items", fk: "item_id" }],
  assemblies: [{ child: "assembly_items", fk: "assembly_id" }],
};

function cascadeDelete(table: string, doomed: Row[]) {
  const ids = new Set(doomed.map((r) => r.id));
  if (ids.size === 0) return;
  for (const { child, fk } of CASCADES[table] ?? []) {
    const rows = loadTable(child);
    const dead = rows.filter((r) => ids.has(r[fk]));
    if (dead.length === 0) continue;
    saveTable(child, rows.filter((r) => !ids.has(r[fk])));
    cascadeDelete(child, dead);
  }
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function createLocalClient() {
  return {
    auth: {
      async getUser() {
        const on = localStorage.getItem("voltline.local.signedin") === "1";
        return { data: { user: on ? LOCAL_USER : null }, error: null };
      },
      async signInWithPassword(_creds: { email: string; password: string }) {
        void _creds;
        localStorage.setItem("voltline.local.signedin", "1");
        return { data: { user: LOCAL_USER }, error: null };
      },
      async signOut() {
        localStorage.removeItem("voltline.local.signedin");
        return { error: null };
      },
      async getSession() {
        return { data: { session: { access_token: "local" } }, error: null };
      },
    },
    from(table: string) {
      return new Query(table);
    },
    storage: {
      from(_bucket: string) {
        void _bucket;
        return {
          async upload(path: string, bytes: ArrayBuffer | Uint8Array | Blob) {
            const buf =
              bytes instanceof Blob
                ? new Uint8Array(await bytes.arrayBuffer())
                : bytes instanceof Uint8Array
                ? bytes
                : new Uint8Array(bytes);
            localStorage.setItem(`voltline.local.file.${path}`, b64(buf));
            return { data: { path }, error: null };
          },
          async download(path: string) {
            const s = localStorage.getItem(`voltline.local.file.${path}`);
            if (!s) return { data: null, error: { message: "file not found" } };
            const bin = atob(s);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return { data: new Blob([bytes], { type: "application/pdf" }), error: null };
          },
        };
      },
    },
  };
}
