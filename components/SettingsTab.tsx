"use client";

import { useEffect, useState } from "react";
import { addCategory, deleteCategory, renameCategory, renamePartner, swapCategories } from "@/app/actions";
import type { Category } from "@/lib/ledger";
import type { LedgerData } from "./Ledger";
import { DeleteButton, FormMsg, Who, type Msg } from "./ui";

export default function SettingsTab({ data }: { data: LedgerData }) {
  return (
    <section className="grid gap-5">
      <PartnerNames data={data} />
      <Categories data={data} />
    </section>
  );
}

function PartnerNames({ data }: { data: LedgerData }) {
  const { partners, reload, partnerColor } = data;
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => setNames(Object.fromEntries(partners.map((p) => [p.id, p.name]))), [partners]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const changed = partners.filter((p) => (names[p.id] ?? "").trim() && names[p.id].trim() !== p.name);
    if (!changed.length) return setMsg({ text: "Nothing to save." });
    setBusy(true);
    for (const p of changed) {
      const res = await renamePartner(p.id, names[p.id]);
      if ("error" in res) {
        setBusy(false);
        return setMsg({ text: res.error, err: true });
      }
    }
    setBusy(false);
    setMsg({ text: "Saved." });
    reload();
  }

  return (
    <div className="card">
      <h2 className="font-display text-[19px] font-semibold">Partner names</h2>
      <form onSubmit={save} noValidate className="grid gap-3 sm:grid-cols-3">
        {partners.map((p, i) => (
          <div key={p.id} className="field">
            <label htmlFor={`n-${p.id}`}>
              <Who name={`Partner ${i + 1}`} color={partnerColor(p.id)} />
            </label>
            <input id={`n-${p.id}`} className="input" maxLength={60} value={names[p.id] ?? ""} onChange={(e) => setNames({ ...names, [p.id]: e.target.value })} />
          </div>
        ))}
        <div className="col-span-full flex flex-wrap items-center gap-2.5">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save names"}
          </button>
          <FormMsg msg={msg} />
        </div>
      </form>
    </div>
  );
}

function Categories({ data }: { data: LedgerData }) {
  const { categories, reload } = data;
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<Msg>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setMsg({ text: "Type a category name.", err: true });
    if (categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) return setMsg({ text: "That category already exists.", err: true });
    const res = await addCategory(n);
    if ("error" in res) return setMsg({ text: res.error, err: true });
    setName("");
    setMsg({ text: `Added ${n}.` });
    reload();
  }

  async function move(i: number, dir: -1 | 1) {
    const a = categories[i];
    const b = categories[i + dir];
    if (!a || !b) return;
    await swapCategories(a.id, b.id);
    reload();
  }

  const del = (c: Category) => async () => {
    const res = await deleteCategory(c.id);
    if ("error" in res) return res.error;
    await reload();
    return null;
  };

  return (
    <div className="card">
      <h2 className="font-display text-[19px] font-semibold">Categories</h2>
      <ul className="m-0 grid list-none p-0">
        {categories.map((c, i) => (
          <CategoryRow key={c.id} c={c} first={i === 0} last={i === categories.length - 1} onMove={(d) => move(i, d)} onDelete={del(c)} reload={reload} />
        ))}
      </ul>
      <form onSubmit={add} noValidate className="flex flex-wrap items-end gap-2.5">
        <div className="field min-w-[200px] flex-1">
          <label htmlFor="newCat">New category</label>
          <input id="newCat" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Travel" />
        </div>
        <button className="btn" type="submit">
          Add
        </button>
        <FormMsg msg={msg} />
      </form>
      <p className="note m-0">Renaming a category also renames it on past entries. Deleting one keeps past entries under their old name.</p>
    </div>
  );
}

function CategoryRow({
  c,
  first,
  last,
  onMove,
  onDelete,
  reload,
}: {
  c: Category;
  first: boolean;
  last: boolean;
  onMove: (d: -1 | 1) => void;
  onDelete: () => Promise<string | null>;
  reload: () => Promise<void>;
}) {
  const [value, setValue] = useState(c.name);
  const [err, setErr] = useState("");
  useEffect(() => setValue(c.name), [c.name]);

  async function rename() {
    const n = value.trim();
    if (!n || n === c.name) return setValue(c.name);
    const res = await renameCategory(c.id, n);
    if ("error" in res) {
      setErr(res.error);
      setValue(c.name);
    } else {
      setErr("");
      reload();
    }
  }

  const arrow = "cursor-pointer rounded-md border border-line px-2 py-1 text-xs text-muted disabled:opacity-30";
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-0">
      <input
        aria-label={`Rename ${c.name}`}
        className="input min-w-[160px] flex-1 py-1.5"
        maxLength={60}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={rename}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (e.target as HTMLInputElement).blur())}
      />
      <button type="button" className={arrow} disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${c.name} up`}>
        ↑
      </button>
      <button type="button" className={arrow} disabled={last} onClick={() => onMove(1)} aria-label={`Move ${c.name} down`}>
        ↓
      </button>
      <DeleteButton onDelete={onDelete} />
      {err && <span className="msg msg-err w-full">{err}</span>}
    </li>
  );
}
