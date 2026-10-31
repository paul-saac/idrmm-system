"use client";

import { Fragment, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ListFilter, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { ViewMenu } from "@/components/ui/view-menu";
import { DIVIDER, GROUP_ROW, MAIN_TASK_ROW, SUBTASK_NAME_CELL, TREE_CELL, TreeLine } from "./breakdown-table-shared";
import { importResourceTotals } from "@/lib/bom-import/estimate-resources";
import type { DraftCategory, DraftResources } from "./import-bom-modal-content";

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

function hasResources(owner: DraftResources) {
  return !!owner.materials?.length || !!owner.equipment?.length || !!owner.otherCosts?.length || owner.laborEstimate !== undefined;
}
function taskAmount(task: DraftTask) { return resourceAmount(task); }
function resourceAmount(owner: DraftResources) {
  const hasValues = !!owner.amount?.trim() || !!owner.laborEstimate?.trim() || (owner.materials ?? []).some(line => materialAmount(line) !== null) ||
    [...(owner.equipment ?? []), ...(owner.otherCosts ?? [])].some(line => numberValue(line.amount) !== null);
  return hasValues ? importResourceTotals(owner).total : null;
}
function categoryAmount(category: DraftCategory) {
  return category.tasks.length ? sumKnown(category.tasks.map(taskAmount)) : resourceAmount(category);
}
function currency(value: number | null) {
  return value === null ? "—" : `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}
function taskMissing(task: DraftTask) { return !task.name.trim(); }
function materialMissing(material: DraftMaterial) {
  return !material.name.trim() || numberValue(material.quantity) === null || !material.unit.trim() || numberValue(material.unitCost) === null;
}
function resourcesMissing(owner: DraftResources) {
  return (owner.laborEstimate !== undefined && numberValue(owner.laborEstimate) === null) ||
    (!!owner.amount?.trim() && numberValue(owner.amount) === null) ||
    (owner.materials ?? []).some(materialMissing) || [...(owner.equipment ?? []), ...(owner.otherCosts ?? [])].some(line => !line.name.trim() || numberValue(line.amount) === null);
}
function resourceMatch(owner: DraftResources, matches: (name: string) => boolean) {
  return (owner.laborEstimate !== undefined && matches("Labor")) || [...(owner.materials ?? []), ...(owner.equipment ?? []), ...(owner.otherCosts ?? [])].some(line => matches(line.name));
}
function categoryMissing(category: DraftCategory): boolean {
  return !category.name.trim() || (!category.tasks.length && (resourceAmount(category) === null || resourcesMissing(category))) ||
    category.tasks.some(task => taskMissing(task) || resourcesMissing(task));
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

function Cell({ value, label, onChange, numeric = false, missing = false, nameId, money = false, alignRight = false }: {
  value: string; label: string; onChange: (value: string) => void; numeric?: boolean; missing?: boolean; nameId?: string; money?: boolean; alignRight?: boolean;
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
    className={`h-9 w-full min-w-0 rounded border px-2 text-xs font-medium text-zinc-700 outline-none transition-colors focus:border-zinc-400 focus:bg-white ${numeric || alignRight ? "text-right tabular-nums" : "text-left"} ${missing ? "border-amber-200 bg-amber-50/80 placeholder:text-amber-600" : "border-transparent bg-transparent placeholder:text-zinc-400 hover:bg-zinc-100/80"}`} />;
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
  const [outlineCategoryId, setOutlineCategoryId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [focusName, setFocusName] = useState<string | null>(null);
  const tableScroll = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const hasMissing = categories.some(categoryMissing);
  const grandTotal = categories.reduce((sum, category) => sum + (categoryAmount(category) ?? 0), 0);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (name: string) => !normalizedQuery || name.toLowerCase().includes(normalizedQuery);
  const matchingCategories = categories.filter(category =>
    (filter === "all" || categoryMissing(category)) && (matches(category.name) || resourceMatch(category, matches) || category.tasks.some(task => matches(task.name) || resourceMatch(task, matches))));
  const categoryId = matchingCategories.some(category => category.id === selectedCategoryId) ? selectedCategoryId : matchingCategories[0]?.id;
  const outlineId = matchingCategories.some(category => category.id === outlineCategoryId) ? outlineCategoryId : null;
  const selectedCategory = categories.find(category => category.id === categoryId);
  const selectedTask = selectedCategory?.tasks.find(task => task.id === selectedTaskId) ?? selectedCategory?.tasks[0];
  const visibleCategories = outlineId ? matchingCategories.filter(category => category.id === outlineId) : matchingCategories;
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
  function addCategory() {
    const id = crypto.randomUUID();
    onChange(previous => [...previous, { id, name: "New category", amount: "", amountType: "other", tasks: [] }]);
    setQuery(""); setFilter("all"); setSelectedCategoryId(id); setOutlineCategoryId(null); setFocusName(id);
  }
  function addTask(id: string) {
    const taskId = crypto.randomUUID();
    onChange(previous => previous.map(category => category.id !== id ? category : {
      ...category, amount: "", laborEstimate: undefined, materials: [], equipment: [], otherCosts: [],
      tasks: [...category.tasks, { id: taskId, name: "New task", quantity: "", unit: "", materials: [],
        ...(!category.tasks.length ? { amount: category.amount, amountType: category.amountType, laborEstimate: category.laborEstimate,
          materials: category.materials ?? [], equipment: category.equipment ?? [], otherCosts: category.otherCosts ?? [] } : {}),
      }],
    }));
    setQuery(""); setFilter("all"); expandCategory(id); setSelectedCategoryId(id); setSelectedTaskId(taskId); setFocusName(taskId);
  }
  function updateOwner(categoryId: string, taskId: string | null, patch: Partial<DraftResources>) {
    onChange(previous => previous.map(category => category.id !== categoryId ? category : taskId
      ? { ...category, tasks: category.tasks.map(task => task.id === taskId ? { ...task, ...patch } : task) }
      : { ...category, ...patch }));
  }
  function resourceActions(categoryId: string, taskId: string | null, owner: DraftResources) {
    const update = (patch: Partial<DraftResources>) => {
      updateOwner(categoryId, taskId, patch); setQuery(""); setFilter("all"); expandCategory(categoryId);
      if (taskId) setCollapsedTasks(previous => { const next = new Set(previous); next.delete(taskId); return next; });
    };
    return [
      { label: "Add material", run: () => { const id = crypto.randomUUID(); update({ materials: [...(owner.materials ?? []), { id, name: "", quantity: "", unit: "", unitCost: "" }] }); setFocusName(id); } },
      { label: "Add labor amount", run: () => update({ laborEstimate: owner.laborEstimate ?? "" }) },
      ...(["equipment", "otherCosts"] as const).map(key => ({ label: key === "equipment" ? "Add equipment cost" : "Add other cost", run: () => {
        const id = crypto.randomUUID();
        update({ [key]: [...(owner[key] ?? []), { id, name: "", amount: "" }] }); setFocusName(id);
        if (taskId) setCollapsedTasks(previous => { const next = new Set(previous); next.delete(taskId); return next; });
      } })),
    ];
  }
  function addSelectedResource(label: string) {
    if (!categoryId || !selectedCategory) return;
    const owner = selectedTask ?? selectedCategory;
    resourceActions(categoryId, selectedTask?.id ?? null, owner).find(action => action.label === label)?.run();
  }
  function resourceRows(categoryId: string, taskId: string | null, owner: DraftResources & { id: string; name: string }, nameMatches: boolean, lastTask: boolean) {
    const update = (patch: Partial<DraftResources>) => updateOwner(categoryId, taskId, patch);
    const selectOwner = () => { setSelectedCategoryId(categoryId); setSelectedTaskId(taskId); };
    const costLabel = owner.amountType === "labor" ? "Labor" : owner.amountType === "equipment" ? "Equipment" : owner.amountType === "other" ? "Other cost" : "Material";
    return <>
      {hasResources(owner) && !!owner.amount?.trim() && <tr onClick={selectOwner} className={`${GROUP_ROW} bg-white`}>
        <td className={TREE_CELL}>{!lastTask && <TreeLine />}</td>
        <td className={`${DIVIDER} pl-6 pr-2`}><span className="text-[10px] text-zinc-400">{costLabel}</span><p className="py-2">{owner.name}</p></td>
        <td className={DIVIDER}><Cell value={owner.amount} label={`Direct amount for ${owner.name}`} numeric money missing={numberValue(owner.amount) === null} onChange={amount => update({ amount })} /></td><td />
      </tr>}
      {owner.laborEstimate !== undefined && <tr onClick={selectOwner} className={`${GROUP_ROW} bg-white`}><td className={TREE_CELL}>{!lastTask && <TreeLine />}</td>
        <td className={`${DIVIDER} pl-6 text-zinc-500`}>Labor</td>
        <td className={DIVIDER}><Cell value={owner.laborEstimate} label={`Labor amount for ${owner.name}`} numeric money missing={numberValue(owner.laborEstimate) === null} onChange={laborEstimate => update({ laborEstimate })} /></td>
        <td className="pr-1"><RowMenu name={`labor for ${owner.name}`} actions={[{ label: "Remove labor amount", destructive: true, run: () => update({ laborEstimate: undefined }) }]} /></td>
      </tr>}
      {(owner.materials ?? []).filter(line => (filter === "all" || materialMissing(line)) && (nameMatches || matches(line.name))).map(material => <tr key={material.id} onClick={selectOwner} data-resource-kind="material" className={`${GROUP_ROW} bg-[rgba(252,211,77,0.08)]`}>
        <td className={TREE_CELL}>{!lastTask && <TreeLine />}</td>
        <td className={`${DIVIDER} border-l-3 border-l-zinc-300`}><div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,1fr)] divide-x divide-zinc-200">
          <label className="min-w-0 pl-4 pt-1.5"><span className="block px-2 text-[10px] text-zinc-400">Material</span><Cell nameId={material.id} value={material.name} label="Material name" missing={!material.name.trim()} onChange={name => update({ materials: owner.materials!.map(line => line.id === material.id ? { ...line, name } : line) })} /></label>
          <label className="min-w-0 pt-1.5"><span className="block px-2 text-right text-[10px] text-zinc-400">Quantity</span><Cell value={material.quantity} label={`Material quantity for ${material.name || "material"}`} numeric missing={numberValue(material.quantity) === null} onChange={quantity => update({ materials: owner.materials!.map(line => line.id === material.id ? { ...line, quantity } : line) })} /></label>
          <label className="min-w-0 pt-1.5"><span className="block px-2 text-right text-[10px] text-zinc-400">Unit</span><Cell value={material.unit} label={`Unit for ${material.name || "material"}`} alignRight missing={!material.unit.trim()} onChange={unit => update({ materials: owner.materials!.map(line => line.id === material.id ? { ...line, unit } : line) })} /></label>
          <label className="min-w-0 pt-1.5"><span className="block px-2 text-right text-[10px] text-zinc-400">Unit Cost</span><Cell value={material.unitCost} label={`Unit cost for ${material.name || "material"}`} numeric missing={numberValue(material.unitCost) === null} onChange={unitCost => update({ materials: owner.materials!.map(line => line.id === material.id ? { ...line, unitCost } : line) })} /></label>
        </div></td>
        <td className={`${DIVIDER} px-4 text-right tabular-nums`}>{currency(materialAmount(material))}</td>
        <td className="pr-1"><RowMenu name={material.name || "material"} actions={[{ label: "Delete material", destructive: true, run: () => update({ materials: owner.materials!.filter(line => line.id !== material.id) }) }]} /></td>
      </tr>)}
      {(["equipment", "otherCosts"] as const).flatMap(key => (owner[key] ?? []).filter(line => (filter === "all" || !line.name.trim() || numberValue(line.amount) === null) && (nameMatches || matches(line.name))).map(line => <tr key={line.id} onClick={selectOwner} data-resource-kind={key} className={`${GROUP_ROW} bg-zinc-50/50`}>
        <td className={TREE_CELL}>{!lastTask && <TreeLine />}</td>
        <td className={`${DIVIDER} pl-6 pr-2`}><label className="block min-w-0 pt-1.5"><span className="block px-2 text-[10px] text-zinc-400">{key === "equipment" ? "Equipment description" : "Other cost description"}</span>
          <Cell nameId={line.id} value={line.name} label={`${key === "equipment" ? "Equipment" : "Other cost"} name`} missing={!line.name.trim()} onChange={name => update({ [key]: owner[key]!.map(item => item.id === line.id ? { ...item, name } : item) })} /></label></td>
        <td className={DIVIDER}><Cell value={line.amount} label={`Amount for ${line.name || (key === "equipment" ? "equipment" : "other cost")}`} numeric money missing={numberValue(line.amount) === null} onChange={amount => update({ [key]: owner[key]!.map(item => item.id === line.id ? { ...item, amount } : item) })} /></td>
        <td className="pr-1"><RowMenu name={line.name || key} actions={[{ label: key === "equipment" ? "Delete equipment cost" : "Delete other cost", destructive: true, run: () => update({ [key]: owner[key]!.filter(item => item.id !== line.id) }) }]} /></td>
      </tr>))}
    </>;
  }

  function jumpToCategory(id: string) {
    setOutlineCategoryId(previous => previous === id ? null : id);
    setQuery(""); setFilter("all"); expandCategory(id); setSelectedCategoryId(id); setSelectedTaskId(null); setCollapsedTasks(new Set());
    requestAnimationFrame(() => tableScroll.current?.querySelector(`[data-draft-category="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" }));
  }

  return <div ref={root} className="flex h-full min-h-0 flex-col bg-white text-zinc-800">
    <section className="shrink-0 px-5 pt-5 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-2xl font-semibold tracking-tight text-zinc-900">Review your AI draft</h3>
          <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-500">DRAFT · NOT ADDED</span>
        </div>

      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">Check the estimate, edit any cell, and manage tasks and planned costs. Nothing is added to your project until you confirm.</p>
      {hasMissing && <div className="mt-3 grid grid-cols-[16px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border border-amber-200 bg-amber-50/70 px-3 py-2">
        <AlertTriangle aria-hidden className="size-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-zinc-800">Some quantities, units and unit costs need a check</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">Highlighted cells are missing source data or need correction. Blank values are not treated as zero in this draft.</p></div>
      </div>}
    </section>

    <div className="relative z-20 flex shrink-0 flex-wrap items-center gap-2.5 border-y border-zinc-200 px-5 py-2.5">
      <label className="relative min-w-44 flex-1 sm:max-w-70"><Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input aria-label="Find a category, task or material" value={query} onChange={event => { setQuery(event.target.value); setFocusName(null); setCollapsedCategories(new Set()); setCollapsedTasks(new Set()); }} placeholder="Find a category, task or material..." className="h-8 w-full rounded border border-zinc-200 bg-white pr-2 pl-7 text-[11px] outline-none placeholder:text-zinc-400 focus:border-zinc-400" />
      </label>
      <div className="[&_button]:text-xs [&_svg]:size-3.5"><ViewMenu value={filter} onChange={value => { setFilter(value); setFocusName(null); setCollapsedCategories(new Set()); setCollapsedTasks(new Set()); }} views={[{ value: "all", label: "All items", icon: <ListFilter /> }, { value: "missing", label: "Missing fields", icon: <AlertTriangle /> }]} /></div>
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
          {matchingCategories.map(category => <Fragment key={category.id}>
            <button type="button" onClick={() => jumpToCategory(category.id)} aria-current={category.id === outlineId ? "location" : undefined} title={category.name}
              className={`mb-1 flex min-h-8 w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left text-[11px] leading-relaxed hover:bg-zinc-100 ${category.id === outlineId ? "bg-zinc-100 font-semibold text-zinc-900" : "text-zinc-600"}`}>
              {category.id === outlineId ? <ChevronDown aria-hidden className="size-3 shrink-0 text-zinc-400" /> : <ChevronRight aria-hidden className="size-3 shrink-0 text-zinc-400" />}<span className="truncate">{category.name || "Untitled category"}</span>
            </button>
          </Fragment>)}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={tableScroll} className="min-h-0 flex-1 overflow-auto border border-zinc-200 [scroll-padding-top:32px]">
          <table className="w-full min-w-180 table-fixed border-collapse text-left text-xs">
            <colgroup><col className="w-9" /><col /><col className="w-32" /><col className="w-8" /></colgroup>
            <thead className="sticky top-0 z-10 bg-zinc-50 text-xs font-medium text-zinc-500"><tr>
              <th scope="col" colSpan={2} className={`${DIVIDER} border-b px-4 py-2.5 font-medium`}>Task</th>
              <th scope="col" className={`${DIVIDER} border-b px-4 py-2.5 text-right font-medium`}>Amount</th>
              <th scope="col" className="border-b border-zinc-200"><span className="sr-only">Row actions</span></th>
            </tr></thead>
            <tbody>
              {visibleCategories.map(category => {
                const categoryMatch = matches(category.name);
                const tasks = category.tasks.filter(task => (filter === "all" || taskMissing(task) || resourcesMissing(task)) && (categoryMatch || matches(task.name) || resourceMatch(task, matches)));
                const collapsed = collapsedCategories.has(category.id);
                return <Fragment key={category.id}>
                  <tr data-draft-category={category.id} onClick={() => { setSelectedCategoryId(category.id); setSelectedTaskId(null); }} className={MAIN_TASK_ROW}>
                    <td colSpan={2} className={`${DIVIDER} px-4`}><div className="flex items-center gap-1">
                      <button type="button" onClick={() => { toggle(setCollapsedCategories, category.id); setFocusName(null); }} aria-label={`${collapsed ? "Expand" : "Collapse"} ${category.name}`} aria-expanded={!collapsed} disabled={!category.tasks.length} className="flex size-5 shrink-0 cursor-pointer items-center justify-center text-zinc-400 disabled:hidden">{collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}</button>
                      <Cell nameId={category.id} value={category.name} label="Category name" missing={!category.name.trim()} onChange={name => updateCategory(category.id, { name })} />
                    </div></td>
                    <td className={`${DIVIDER} text-right font-medium tabular-nums`}>{!category.tasks.length && !hasResources(category)
                      ? <Cell value={category.amount} label={`Amount for ${category.name}`} numeric money onChange={amount => updateCategory(category.id, { amount })} />
                      : <span className="px-4">{currency(categoryAmount(category))}</span>}</td>
                    <td className="pr-1"><RowMenu name={category.name} actions={[{ label: "Add task", run: () => addTask(category.id) }, ...(!category.tasks.length ? resourceActions(category.id, null, category) : []), { label: "Delete category", destructive: true, run: () => { setFocusName(null); onChange(previous => previous.filter(row => row.id !== category.id)); } }]} /></td>
                  </tr>
                  {!collapsed && !category.tasks.length && resourceRows(category.id, null, category, categoryMatch, true)}
                  {!collapsed && tasks.map((task, taskIndex) => {
                    const taskMatch = categoryMatch || matches(task.name);
                    const taskCollapsed = collapsedTasks.has(task.id);
                    const lastTask = taskIndex === tasks.length - 1;
                    return <Fragment key={task.id}>
                      <tr onClick={() => { setSelectedCategoryId(category.id); setSelectedTaskId(task.id); }} className={`${GROUP_ROW} bg-white`}>
                        <td className={TREE_CELL}><TreeLine branch end={lastTask} /></td>
                        <td className={SUBTASK_NAME_CELL}><div className="flex items-center gap-1">
                          {<button type="button" disabled={!task.materials.length && !task.equipment?.length && !task.otherCosts?.length && task.laborEstimate === undefined} aria-label={`${taskCollapsed ? "Expand" : "Collapse"} ${task.name}`} aria-expanded={!taskCollapsed} onClick={() => { toggle(setCollapsedTasks, task.id); setFocusName(null); }} className="flex size-5 shrink-0 cursor-pointer items-center justify-center text-zinc-400 disabled:hidden">{taskCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}</button>}
                          <Cell nameId={task.id} value={task.name} label="Task name" missing={!task.name.trim()} onChange={name => updateTask(category.id, task.id, { name })} />
                        </div></td>
                        <td className={`${DIVIDER} text-right font-medium tabular-nums`}>{!hasResources(task)
                          ? <Cell value={task.amount ?? ""} label={`Amount for ${task.name}`} numeric money onChange={amount => updateOwner(category.id, task.id, { amount })} />
                          : <span className="px-4">{currency(taskAmount(task))}</span>}</td>
                        <td className="pr-1"><RowMenu name={task.name} actions={[...resourceActions(category.id, task.id, task), { label: "Delete task", destructive: true, run: () => { setFocusName(null); onChange(previous => previous.map(row => row.id !== category.id ? row : { ...row, tasks: row.tasks.filter(item => item.id !== task.id) })); } }]} /></td>
                      </tr>
                      {!taskCollapsed && resourceRows(category.id, task.id, task, taskMatch, lastTask)}
                    </Fragment>;
                  })}
                </Fragment>;
              })}
              {!visibleCategories.length && <tr><td colSpan={4} className="px-5 py-14 text-center text-xs text-zinc-500">{categories.length ? "No items match your search or filter." : "Add a category to start your draft."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pt-2 text-[10px] text-zinc-500">
          <button type="button" onClick={() => tableScroll.current?.scrollBy({ top: tableScroll.current.clientHeight * 0.75, behavior: "smooth" })} className="flex cursor-pointer items-center gap-1 hover:text-zinc-800"><ChevronDown aria-hidden className="size-3" />Scroll down</button>
          <div className="flex flex-wrap items-center gap-3">
            {([ ["+ Add material", "Add material"], ["+ Add equipment", "Add equipment cost"], ["+ Add other", "Add other cost"] ] as const).map(([label, action]) => <button key={action} type="button" disabled={!categoryId} title={`${action} to ${selectedTask?.name ?? selectedCategory?.name ?? "the selected task"}`} onClick={() => addSelectedResource(action)} className="cursor-pointer hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40">{label}</button>)}
            <span aria-hidden>&middot;</span><span className="flex items-center gap-1"><MoreHorizontal aria-hidden className="size-3.5" />Manage row</span>
          </div>
        </div>
      </div>
    </div>

    <footer className="shrink-0 border-t border-zinc-200 px-5 pt-3.5 pb-3">
      {error && <p role="alert" className="mb-3 text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4"><div><p className="text-[11px] text-zinc-500">Estimated total</p><p className="mt-0.5 text-2xl font-semibold tracking-tight text-zinc-900" aria-live="polite">{currency(grandTotal)}</p></div>
        </div>
        <div className="flex items-center gap-2"><button type="button" onClick={onBack} className="cursor-pointer rounded border border-zinc-200 bg-white px-3 py-2.5 text-xs hover:bg-zinc-50">Back</button>
          <button type="button" onClick={onConfirm} disabled={!categories.some(category => category.name.trim())} className="flex cursor-pointer items-center gap-2 rounded border border-zinc-900 bg-zinc-900 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"><Check aria-hidden className="size-3.5" />Confirm &amp; create tasks</button></div>
      </div>
    </footer>
  </div>;
}
