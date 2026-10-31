"use client";

import { Fragment, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronRight, Info, ListFilter, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { ViewMenu } from "@/components/ui/view-menu";
import type { DraftCategory } from "./import-bom-modal-content";

type DraftTask = DraftCategory["tasks"][number];
type DraftMaterial = DraftTask["materials"][number];

// Keep an unknown source value distinct from a deliberately entered zero.
function numberValue(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function materialAmount(material: DraftMaterial): number | null {
  const quantity = numberValue(material.quantity);
  const cost = numberValue(material.unitCost);
  return quantity === null || cost === null ? null : quantity * cost;
}

function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function taskAmount(task: DraftTask) { return sumKnown(task.materials.map(materialAmount)); }
function categoryAmount(category: DraftCategory) {
  return category.tasks.length ? sumKnown(category.tasks.map(taskAmount)) : numberValue(category.amount);
}
function currency(value: number | null) {
  return value === null ? "—" : `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}
function taskMissing(task: DraftTask) { return !task.name.trim() || numberValue(task.quantity) === null || !task.unit.trim(); }
function materialMissing(material: DraftMaterial) {
  return !material.name.trim() || numberValue(material.quantity) === null || !material.unit.trim() || numberValue(material.unitCost) === null;
}
function categoryMissing(category: DraftCategory): boolean {
  return !category.name.trim() || (!category.tasks.length && numberValue(category.amount) === null) ||
    category.tasks.some(task => taskMissing(task) || task.materials.some(materialMissing));
}

function RowMenu({ name, actions }: { name: string; actions: { label: string; run: () => void; destructive?: boolean }[] }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  return <>
    <button type="button" popoverTarget={id} aria-label={`Manage ${name || "row"}`} title="Manage row"
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({ left: Math.max(8, Math.min(rect.right - 172, window.innerWidth - 180)), top: Math.min(rect.bottom + 4, window.innerHeight - actions.length * 34 - 16) });
      }} className="flex size-7 cursor-pointer items-center justify-center rounded text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-zinc-400">
      <MoreHorizontal aria-hidden className="size-4" />
    </button>
    <div ref={menu} id={id} popover="auto" role="menu" aria-label={`Manage ${name || "row"}`} style={{ ...position, right: "auto", bottom: "auto" }}
      className="fixed m-0 w-43 overflow-hidden rounded border border-zinc-200 bg-white p-0 text-xs text-zinc-700 shadow-md">
      {actions.map(action => <button key={action.label} type="button" role="menuitem" onClick={() => { menu.current?.hidePopover(); action.run(); }}
        className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-100 ${action.destructive ? "text-red-600" : "text-zinc-700"}`}>
        {action.destructive ? <Trash2 aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}{action.label}
      </button>)}
    </div>
  </>;
}

function Cell({ value, label, onChange, numeric = false, missing = false, nameId, money = false }: {
  value: string; label: string; onChange: (value: string) => void; numeric?: boolean; missing?: boolean; nameId?: string; money?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const number = numeric ? numberValue(value) : null;
  const displayed = !editing && number !== null ? (money ? currency(number) : number.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 6 })) : value;
  return <input type="text" inputMode={numeric ? "decimal" : undefined} value={displayed} aria-label={label}
    onFocus={event => {
      if (!numeric) return;
      // Show the raw editable value before selecting it; otherwise changing
      // from formatted text can disturb the first keystroke's selection.
      flushSync(() => setEditing(true));
      event.currentTarget.select();
    }} onBlur={() => setEditing(false)}
    data-missing={missing || undefined} data-draft-name={nameId} onChange={event => onChange(event.target.value)} placeholder="—"
    className={`h-7 w-full min-w-0 rounded border px-2 text-xs outline-none transition-colors focus:border-zinc-400 focus:bg-white ${numeric ? "text-right tabular-nums" : "text-left"} ${missing ? "border-amber-200 bg-amber-50/80 placeholder:text-amber-600" : "border-transparent bg-transparent placeholder:text-zinc-400 hover:bg-zinc-100/80"}`} />;
}

export function ImportBomDraftReview({ categories, onChange, onBack, onConfirm, error }: {
  categories: DraftCategory[];
  onChange: Dispatch<SetStateAction<DraftCategory[]>>;
  onBack: () => void;
  onConfirm: () => void;
  error: string | null;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "missing">("all");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(new Set());
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [focusName, setFocusName] = useState<string | null>(null);
  const tableScroll = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const categoryId = categories.some(category => category.id === selectedCategoryId) ? selectedCategoryId : categories[0]?.id;
  const selectedCategory = categories.find(category => category.id === categoryId);
  const selectedTask = selectedCategory?.tasks.find(task => task.id === selectedTaskId) ?? selectedCategory?.tasks[0];
  const hasMissing = categories.some(categoryMissing);
  const grandTotal = categories.reduce((sum, category) => sum + (categoryAmount(category) ?? 0), 0);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (name: string) => !normalizedQuery || name.toLowerCase().includes(normalizedQuery);
  const visibleCategories = categories.filter(category =>
    (filter === "all" || categoryMissing(category)) && (matches(category.name) || category.tasks.some(task => matches(task.name) || task.materials.some(material => matches(material.name)))));
  const allCollapsed = visibleCategories.length > 0 && visibleCategories.every(category => collapsedCategories.has(category.id));

  useEffect(() => {
    if (!focusName) return;
    const frame = requestAnimationFrame(() => {
      const input = root.current?.querySelector<HTMLInputElement>(`input[data-draft-name="${CSS.escape(focusName)}"]`);
      input?.focus();
      input?.select();
      input?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusName]);

  function toggle(setter: Dispatch<SetStateAction<Set<string>>>, id: string) {
    setter(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function expandCategory(id: string) { setCollapsedCategories(previous => { const next = new Set(previous); next.delete(id); return next; }); }
  function updateCategory(id: string, patch: Partial<Pick<DraftCategory, "name" | "amount">>) {
    onChange(previous => previous.map(category => category.id === id ? { ...category, ...patch } : category));
  }
  function updateTask(id: string, taskId: string, patch: Partial<Pick<DraftTask, "name" | "quantity" | "unit">>) {
    onChange(previous => previous.map(category => category.id !== id ? category : { ...category, tasks: category.tasks.map(task => task.id === taskId ? { ...task, ...patch } : task) }));
  }
  function updateMaterial(id: string, taskId: string, materialId: string, patch: Partial<Omit<DraftMaterial, "id">>) {
    onChange(previous => previous.map(category => category.id !== id ? category : { ...category, tasks: category.tasks.map(task => task.id !== taskId ? task : { ...task, materials: task.materials.map(material => material.id === materialId ? { ...material, ...patch } : material) }) }));
  }
  function addCategory() {
    const id = crypto.randomUUID();
    onChange(previous => [...previous, { id, name: "New category", amount: "", tasks: [] }]);
    setQuery(""); setFilter("all"); setSelectedCategoryId(id); setFocusName(id);
  }
  function addTask(id: string) {
    const taskId = crypto.randomUUID();
    onChange(previous => previous.map(category => category.id !== id ? category : { ...category, tasks: [...category.tasks, { id: taskId, name: "New task", quantity: "", unit: "", materials: [] }] }));
    setQuery(""); setFilter("all"); expandCategory(id); setSelectedCategoryId(id); setSelectedTaskId(taskId); setFocusName(taskId);
  }
  function addMaterial(id: string, taskId: string) {
    const materialId = crypto.randomUUID();
    onChange(previous => previous.map(category => category.id !== id ? category : { ...category, tasks: category.tasks.map(task => task.id !== taskId ? task : { ...task, materials: [...task.materials, { id: materialId, name: "", quantity: "", unit: "", unitCost: "" }] }) }));
    setQuery(""); setFilter("all"); expandCategory(id);
    setCollapsedTasks(previous => { const next = new Set(previous); next.delete(taskId); return next; });
    setSelectedCategoryId(id); setSelectedTaskId(taskId); setFocusName(materialId);
  }
  function jumpToCategory(id: string) {
    setQuery(""); setFilter("all"); expandCategory(id); setSelectedCategoryId(id);
    requestAnimationFrame(() => tableScroll.current?.querySelector(`[data-draft-category="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" }));
  }
  function reviewMissing() {
    setQuery(""); setFilter("missing"); setCollapsedCategories(new Set()); setCollapsedTasks(new Set()); setFocusName(null);
    requestAnimationFrame(() => {
      const input = tableScroll.current?.querySelector<HTMLInputElement>('input[data-missing="true"]');
      input?.focus(); input?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }

  return <div ref={root} className="flex h-full min-h-0 flex-col bg-white text-zinc-800">
    <section className="shrink-0 px-5 pt-5 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-2xl font-semibold tracking-tight text-zinc-900">Review your AI draft</h3>
          <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-500">DRAFT · NOT ADDED</span>
        </div>
        <ol aria-label="Import steps" className="flex items-center gap-2 text-[11px] text-zinc-500">
          <li className="flex items-center gap-1.5"><Check aria-hidden className="size-3" />Import</li><li aria-hidden><ChevronRight className="size-3" /></li>
          <li aria-current="step" className="font-semibold text-zinc-900">Review &amp; edit</li><li aria-hidden><ChevronRight className="size-3" /></li><li>Project data</li>
        </ol>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">Check the estimate, edit any cell, and manage tasks and materials. Nothing is added to your project until you confirm.</p>
      {hasMissing && <div className="mt-3 grid grid-cols-[16px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border border-amber-200 bg-amber-50/70 px-3 py-2 sm:grid-cols-[16px_minmax(0,1fr)_auto]">
        <AlertTriangle aria-hidden className="size-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-zinc-800">Some quantities, units and unit costs need a check</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">Highlighted cells are missing source data or need correction. Blank values are not treated as zero in this draft.</p></div>
        <button type="button" onClick={reviewMissing} className="col-start-2 flex cursor-pointer items-center justify-self-start gap-2 rounded border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 hover:bg-zinc-50 sm:col-start-3 sm:row-start-1 sm:justify-self-end"><ArrowRight aria-hidden className="size-3.5" />Review missing fields</button>
      </div>}
    </section>

    <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-y border-zinc-200 px-5 py-2.5">
      <label className="relative min-w-44 flex-1 sm:max-w-70"><Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input aria-label="Find a category, task or material" value={query} onChange={event => { setQuery(event.target.value); setFocusName(null); setCollapsedCategories(new Set()); setCollapsedTasks(new Set()); }} placeholder="Find a category, task or material..." className="h-8 w-full rounded border border-zinc-200 bg-white pr-2 pl-7 text-[11px] outline-none placeholder:text-zinc-400 focus:border-zinc-400" />
      </label>
      <div className="[&_button]:text-xs [&_svg]:size-3.5"><ViewMenu value={filter} onChange={value => { setFilter(value); setFocusName(null); setCollapsedCategories(new Set()); setCollapsedTasks(new Set()); }} views={[{ value: "all", label: "All items", icon: <ListFilter /> }, { value: "missing", label: "Missing fields", icon: <AlertTriangle /> }]} /></div>
      <span className="hidden text-[11px] text-zinc-500 lg:inline">Click any value to edit</span>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => { setFocusName(null); setCollapsedCategories(allCollapsed ? new Set() : new Set(visibleCategories.map(category => category.id))); }} className="cursor-pointer px-2 py-1.5 text-xs text-zinc-800 hover:text-zinc-500">{allCollapsed ? "Expand all" : "Collapse all"}</button>
        <button type="button" disabled={!categoryId} onClick={() => categoryId && addTask(categoryId)} className="flex h-8 cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-2.5 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"><Plus aria-hidden className="size-3.5" />Add task</button>
        <button type="button" onClick={addCategory} className="flex h-8 cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-2.5 text-xs hover:bg-zinc-50"><Plus aria-hidden className="size-3.5" />Add category</button>
      </div>
    </div>

    <div className="flex min-h-0 flex-1 gap-4 px-5 pt-4 pb-3">
      <aside aria-label="Draft outline" className="hidden w-43 shrink-0 flex-col md:flex">
        <h4 className="mb-4 px-2 text-[10px] font-semibold tracking-widest text-zinc-500">DRAFT OUTLINE</h4>
        <nav className="min-h-0 flex-1 overflow-y-auto">
          {categories.map((category, index) => <Fragment key={category.id}>
            {index === 7 && <p className="px-2 pt-5 pb-3 text-[10px] text-zinc-500">FURTHER IN THIS DRAFT</p>}
            <button type="button" onClick={() => jumpToCategory(category.id)} aria-current={category.id === categoryId ? "location" : undefined} title={category.name}
              className={`mb-1 flex min-h-8 w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left text-[11px] leading-relaxed hover:bg-zinc-100 ${category.id === categoryId ? "bg-zinc-100 font-semibold text-zinc-900" : "text-zinc-600"}`}>
              {category.id === categoryId ? <ChevronDown aria-hidden className="size-3 shrink-0 text-zinc-400" /> : <ChevronRight aria-hidden className="size-3 shrink-0 text-zinc-400" />}<span className="truncate">{category.name || "Untitled category"}</span>
            </button>
          </Fragment>)}
        </nav>
        <p className="mt-4 max-w-40 text-[11px] leading-relaxed text-zinc-500">Scroll the estimate to review the remaining tasks and materials.</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={tableScroll} className="min-h-0 flex-1 overflow-auto border border-zinc-200 [scroll-padding-top:32px]">
          <table className="w-full min-w-160 table-fixed border-collapse text-left text-xs">
            <colgroup><col /><col className="w-22" /><col className="w-18" /><col className="w-26" /><col className="w-28" /><col className="w-8" /></colgroup>
            <thead className="sticky top-0 z-10 bg-zinc-50 text-[10px] font-normal text-zinc-500"><tr className="h-7 border-b border-zinc-200">
              <th scope="col" className="px-3 font-normal">Description</th><th scope="col" className="px-2 text-right font-normal">Quantity</th><th scope="col" className="px-2 font-normal">Unit</th><th scope="col" className="px-2 text-right font-normal">Unit cost (₱)</th><th scope="col" className="px-2 text-right font-normal">Amount (₱)</th><th scope="col"><span className="sr-only">Row actions</span></th>
            </tr></thead>
            <tbody>
              {visibleCategories.map(category => {
                const categoryMatch = matches(category.name);
                const tasks = category.tasks.filter(task => (filter === "all" || taskMissing(task) || task.materials.some(materialMissing)) && (categoryMatch || matches(task.name) || task.materials.some(material => matches(material.name))));
                const collapsed = collapsedCategories.has(category.id);
                return <Fragment key={category.id}>
                  <tr data-draft-category={category.id} onClick={() => setSelectedCategoryId(category.id)} className="h-8 border-b border-zinc-200 bg-zinc-100/90 font-semibold">
                    <td className="pl-2 [&_input]:text-[10px] [&_input]:font-semibold [&_input]:uppercase"><div className="flex items-center gap-1">
                      <button type="button" onClick={() => { toggle(setCollapsedCategories, category.id); setFocusName(null); }} aria-label={`${collapsed ? "Expand" : "Collapse"} ${category.name}`} aria-expanded={!collapsed} disabled={!category.tasks.length} className="flex size-5 shrink-0 cursor-pointer items-center justify-center text-zinc-400 disabled:invisible">{collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}</button>
                      <Cell nameId={category.id} value={category.name} label="Category name" missing={!category.name.trim()} onChange={name => updateCategory(category.id, { name })} />
                    </div></td>
                    <td className="px-2 text-right font-normal text-zinc-400">—</td><td className="px-2 font-normal text-zinc-400">—</td><td className="px-2 text-right font-normal text-zinc-400">—</td>
                    <td className="px-1 text-right tabular-nums">{category.tasks.length ? <span className="px-1">{currency(categoryAmount(category))}</span> : <Cell value={category.amount} label={`Amount for ${category.name}`} numeric money missing={numberValue(category.amount) === null} onChange={amount => updateCategory(category.id, { amount })} />}</td>
                    <td className="pr-1"><RowMenu name={category.name} actions={[{ label: "Add task", run: () => addTask(category.id) }, { label: "Delete category", destructive: true, run: () => { setFocusName(null); onChange(previous => previous.filter(row => row.id !== category.id)); } }]} /></td>
                  </tr>
                  {!collapsed && tasks.map(task => {
                    const taskMatch = categoryMatch || matches(task.name);
                    const materials = task.materials.filter(material => (filter === "all" || taskMissing(task) || materialMissing(material)) && (taskMatch || matches(material.name)));
                    const taskCollapsed = collapsedTasks.has(task.id);
                    return <Fragment key={task.id}>
                      <tr onClick={() => { setSelectedCategoryId(category.id); setSelectedTaskId(task.id); }} className="h-8 border-b border-zinc-200 bg-white font-medium hover:bg-zinc-50/50">
                        <td className="pl-5"><div className="flex items-center gap-1">
                          {taskMissing(task) ? <AlertTriangle aria-hidden className="mx-1 size-3.5 shrink-0 text-amber-600" /> : <button type="button" disabled={!task.materials.length} aria-label={`${taskCollapsed ? "Expand" : "Collapse"} ${task.name}`} aria-expanded={!taskCollapsed} onClick={() => { toggle(setCollapsedTasks, task.id); setFocusName(null); }} className="flex size-5 shrink-0 cursor-pointer items-center justify-center text-zinc-400 disabled:invisible">{taskCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}</button>}
                          <Cell nameId={task.id} value={task.name} label="Task name" missing={!task.name.trim()} onChange={name => updateTask(category.id, task.id, { name })} />
                          <button type="button" onClick={() => addMaterial(category.id, task.id)} aria-label={`Add material to ${task.name}`} title="Add material" className="mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><Plus aria-hidden className="size-3.5" /></button>
                        </div></td>
                        <td className="px-1"><Cell value={task.quantity} label={`Quantity for ${task.name}`} numeric missing={numberValue(task.quantity) === null} onChange={quantity => updateTask(category.id, task.id, { quantity })} /></td>
                        <td className="px-1"><Cell value={task.unit} label={`Unit for ${task.name}`} missing={!task.unit.trim()} onChange={unit => updateTask(category.id, task.id, { unit })} /></td>
                        <td className="px-2 text-right font-normal text-zinc-400">—</td><td className="px-2 text-right font-semibold tabular-nums">{currency(taskAmount(task))}</td>
                        <td className="pr-1"><RowMenu name={task.name} actions={[{ label: "Add material", run: () => addMaterial(category.id, task.id) }, { label: "Delete task", destructive: true, run: () => { setFocusName(null); onChange(previous => previous.map(row => row.id !== category.id ? row : { ...row, tasks: row.tasks.filter(item => item.id !== task.id) })); } }]} /></td>
                      </tr>
                      {!taskCollapsed && materials.map(material => <tr key={material.id} onClick={() => { setSelectedCategoryId(category.id); setSelectedTaskId(task.id); }} className="h-8 border-b border-zinc-200 bg-white hover:bg-zinc-50/50">
                        <td className="pl-11"><div className="ml-1 flex items-center border-l border-zinc-300 pl-1"><Cell nameId={material.id} value={material.name} label="Material name" missing={!material.name.trim()} onChange={name => updateMaterial(category.id, task.id, material.id, { name })} /></div></td>
                        <td className="px-1"><Cell value={material.quantity} label={`Quantity for ${material.name || "material"}`} numeric missing={numberValue(material.quantity) === null} onChange={quantity => updateMaterial(category.id, task.id, material.id, { quantity })} /></td>
                        <td className="px-1"><Cell value={material.unit} label={`Unit for ${material.name || "material"}`} missing={!material.unit.trim()} onChange={unit => updateMaterial(category.id, task.id, material.id, { unit })} /></td>
                        <td className="px-1"><Cell value={material.unitCost} label={`Unit cost for ${material.name || "material"}`} numeric missing={numberValue(material.unitCost) === null} onChange={unitCost => updateMaterial(category.id, task.id, material.id, { unitCost })} /></td>
                        <td className="px-2 text-right tabular-nums text-zinc-700">{currency(materialAmount(material))}</td>
                        <td className="pr-1"><RowMenu name={material.name || "material"} actions={[{ label: "Delete material", destructive: true, run: () => { setFocusName(null); onChange(previous => previous.map(row => row.id !== category.id ? row : { ...row, tasks: row.tasks.map(item => item.id !== task.id ? item : { ...item, materials: item.materials.filter(line => line.id !== material.id) }) })); } }]} /></td>
                      </tr>)}
                    </Fragment>;
                  })}
                </Fragment>;
              })}
              {!visibleCategories.length && <tr><td colSpan={6} className="px-5 py-14 text-center text-xs text-zinc-500">{categories.length ? "No items match your search or filter." : "Add a category to start your draft."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pt-2 text-[10px] text-zinc-500">
          <button type="button" onClick={() => tableScroll.current?.scrollBy({ top: tableScroll.current.clientHeight * 0.75, behavior: "smooth" })} className="flex cursor-pointer items-center gap-1 hover:text-zinc-800"><ChevronDown aria-hidden className="size-3" />Continue to the remaining estimate</button>
          <div className="flex items-center gap-2"><button type="button" disabled={!categoryId || !selectedTask} onClick={() => categoryId && selectedTask && addMaterial(categoryId, selectedTask.id)} className="cursor-pointer hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40">+ Add material</button><span aria-hidden>·</span><span className="flex items-center gap-1"><MoreHorizontal aria-hidden className="size-3.5" />Manage row</span></div>
        </div>
      </div>
    </div>

    <footer className="shrink-0 border-t border-zinc-200 px-5 pt-3.5 pb-3">
      {error && <p role="alert" className="mb-3 text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4"><div><p className="text-[11px] text-zinc-500">Estimated total</p><p className="mt-0.5 text-2xl font-semibold tracking-tight text-zinc-900" aria-live="polite">{currency(grandTotal)}</p></div>
          <p className="hidden text-[11px] leading-relaxed text-zinc-500 sm:block">Full draft total · not just visible rows<br />Missing amounts are excluded from the estimate.</p></div>
        <div className="flex items-center gap-2"><button type="button" onClick={onBack} className="cursor-pointer rounded border border-zinc-200 bg-white px-3 py-2.5 text-xs hover:bg-zinc-50">Back</button>
          <button type="button" onClick={onConfirm} disabled={!categories.some(category => category.name.trim())} className="flex cursor-pointer items-center gap-2 rounded border border-zinc-900 bg-zinc-900 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"><Check aria-hidden className="size-3.5" />Confirm &amp; create tasks</button></div>
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500"><Info aria-hidden className="mt-px size-3 shrink-0" />Confirming adds the draft categories, tasks and materials to project data. Review any highlighted fields before you confirm.</p>
    </footer>
  </div>;
}
