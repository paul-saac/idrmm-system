import { activeOfflineOwner, localAll, localGet, localPut, localDelete, draftKey, manilaDate,
  offlineEntryState, queueOfflineLog, synchronizeOfflineLogs, subscribeOffline, prepareOfflineProject,
  lockOfflineWorkspace, queueOfflineIncident } from "/offline/storage.js";

const $ = id => document.getElementById(id);
const blank = () => ({ quantityCompletedToday: 0, costs: { labor: 0, material: 0, equipment: 0, other: 0 }, attendance: [], materialsUsed: [], unplannedMaterials: [], equipmentCostsUsed: [], unplannedEquipmentCosts: [], otherCostsUsed: [], unplannedOtherCosts: [] });
let projects = [], project, item, state, formInput, reviewId, pendingDraft = Promise.resolve(), blocked = false, rendering = false;
let loadingItem = false;
const peso = value => `₱${Number(value || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const prettyDate = date => new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
function element(tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith("on")) node.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "className") node.className = value;
    else if (name in node) node[name] = value;
    else node.setAttribute(name, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}
function notice(message) { $("notice").hidden = !message; $("notice").textContent = message; }
function field(label, value, name, options = {}) {
  const wrapper = element("label", {}, label);
  wrapper.append(element("input", { name, value: value ?? "", type: "text", autocomplete: "off", ...options }));
  return wrapper;
}
function numeric(label, value, name, options = {}) { return field(label, Number(value) === 0 ? "" : value, name, { type: "number", min: "0", step: "any", inputMode: "decimal", placeholder: "0", ...options }); }
function section(title) { const block = element("div", { className: "block" }); block.append(element("h3", {}, title)); $("form-content").append(block); return block; }
function addButton(parent, label, add) {
  parent.querySelector("h3").append(element("button", { type: "button", className: "section-add", title: label, "aria-label": label,
    onclick: () => { if (add() === false) return; renderForm(); scheduleDraft(); } }, "+"));
}
function removeButton(list, row) {
  const button = element("button", { type: "button", className: "remove", title: "Remove row", "aria-label": "Remove row", onclick: () => { list.splice(list.indexOf(row), 1); renderForm(); scheduleDraft(); } });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M18 6 6 18M6 6l12 12"); svg.append(path); button.append(svg);
  return button;
}
function inputField(row, key, label, number = false, options = {}) {
  const wrapper = number ? numeric(label, row[key], key, options) : field(label, row[key], key, options);
  wrapper.querySelector("input").addEventListener("input", event => { row[key] = number ? Number(event.target.value) : event.target.value; });
  return wrapper;
}
function costSummary(key, label, source) {
  const wrapper = field(label, peso(0), `summary-${key}`, { readOnly: true, className: "computed-cost", tabIndex: -1, "aria-describedby": `summary-${key}-source` });
  wrapper.className = "cost-summary";
  wrapper.append(element("span", { id: `summary-${key}-source`, className: "cost-source" }, source));
  return wrapper;
}
function prefilledField(label, value) {
  return field(label, value, "", { readOnly: true, tabIndex: -1, className: "prefilled-value" });
}
function openWorkforcePicker() {
  if (blocked || loadingItem || !project || !item || document.querySelector('#workforce-picker')) return;
  const projectKey = project.id, taskKey = item.key;
  let tab = "skilled";
  const dialog = element("dialog", { id: "workforce-picker", className: "workforce-picker", "aria-labelledby": "workforce-title", "aria-describedby": "workforce-description" });
  const heading = element("div", { className: "workforce-heading" });
  const icon = element("span", { className: "workforce-icon", "aria-hidden": "true" });
  // Same Users outline used by the online workforce picker.
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/></svg>';
  const title = element("div");
  title.append(element("h2", { id: "workforce-title" }, "Add workforce"), element("p", { id: "workforce-description" }, "Select a skilled worker or subcontractor who worked on this task today."));
  const close = () => { dialog.close(); dialog.remove(); document.querySelector('[aria-label="Add worker or subcontractor"]')?.focus(); };
  const x = element("button", { type: "button", className: "workforce-close", "aria-label": "Close Add workforce", onclick: close });
  x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m18 6-12 12M6 6l12 12"/></svg>';
  heading.append(icon, title, x);
  const content = element("div", { className: "workforce-content" });
  const search = element("input", { type: "search", placeholder: "Search member by name, role, or trade...", "aria-label": "Search workforce", autocomplete: "off" });
  const tabs = element("div", { className: "workforce-tabs", role: "tablist", "aria-label": "Worker categories" });
  const list = element("div", { className: "workforce-list", id: "workforce-list", role: "tabpanel", "aria-label": "Available workforce" });
  const available = () => project.workers.filter(worker => !formInput.attendance.some(row => String(row.workerId) === String(worker.id)));
  function choose(worker) {
    if (blocked || loadingItem || project?.id !== projectKey || item?.key !== taskKey) { close(); return; }
    if (!formInput.attendance.some(row => String(row.workerId) === String(worker.id))) {
      formInput.attendance.push({ workerId: worker.id, hours: 0, ...(worker.subcontractor ? { amount: 0 } : {}) });
      renderForm(); scheduleDraft();
    }
    close();
  }
  function renderList() {
    tabs.replaceChildren(); list.replaceChildren();
    for (const [key, label] of [["skilled", "Skilled Workers"], ["subcontractors", "Subcontractors"]]) {
      const button = element("button", { type: "button", role: "tab", "aria-controls": "workforce-list", "aria-selected": String(tab === key), onclick: () => { tab = key; renderList(); } });
      button.append(element("span", {}, label), element("span", { className: "workforce-count" }, String(available().filter(w => key === "subcontractors" ? w.subcontractor : !w.subcontractor).length)));
      button.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); tab = event.key === "Home" ? "skilled" : event.key === "End" ? "subcontractors" : tab === "skilled" ? "subcontractors" : "skilled";
        renderList(); tabs.querySelector('[aria-selected="true"]').focus();
      });
      tabs.append(button);
    }
    const query = search.value.trim().toLowerCase();
    const workers = available().filter(w => (tab === "subcontractors" ? w.subcontractor : !w.subcontractor) && [w.name, w.title, w.company].some(text => (text ?? "").toLowerCase().includes(query)));
    const table = element("table");
    const thead = element("thead"), headers = element("tr");
    for (const name of ["Member", "Role / Trade", "Rate", "Employment"]) headers.append(element("th", { scope: "col" }, name));
    thead.append(headers); table.append(thead);
    const tbody = element("tbody");
    for (const worker of workers) {
      const row = element("tr", { onclick: () => choose(worker) });
      const member = element("td"), button = element("button", { type: "button", className: "workforce-member" });
      const avatar = element("span", { className: "workforce-avatar", "aria-hidden": "true" }, worker.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join(""));
      avatar.style.backgroundColor = ["#dcfce7", "#e0f2fe", "#fef3c7", "#f3e8ff", "#ffe4e6"][Number(worker.id) % 5];
      button.append(avatar, element("span", {}, worker.name)); member.append(button);
      row.append(member, element("td", {}, worker.title || "—"), element("td", {}, worker.subcontractor ? "—" : `${peso(worker.rate)}/hr`), element("td", {}, worker.subcontractor ? `Subcontractor${worker.company ? ` (${worker.company})` : ""}` : "Employee"));
      tbody.append(row);
    }
    table.append(tbody); list.append(table);
    if (!workers.length) list.append(element("p", { className: "workforce-empty", role: "status" }, available().length === 0 ? "All available team members have already been added to this task." : query ? "No members match your search." : "No additional members in this category."));
  }
  search.addEventListener("input", renderList);
  content.append(search, tabs, list);
  const footer = element("div", { className: "workforce-footer" });
  footer.append(element("button", { type: "button", onclick: close }, "Cancel"));
  dialog.append(heading, content, footer);
  dialog.addEventListener("click", event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } });
  dialog.addEventListener("close", () => { dialog.remove(); document.querySelector('[aria-label="Add worker or subcontractor"]')?.focus(); });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); close(); } });
  document.body.append(dialog); renderList(); dialog.showModal(); search.focus();
}
function mergePlannedRows() {
  for (const id of item.workerIds) if (!formInput.attendance.some(r => String(r.workerId) === String(id))) {
    const worker = project.workers.find(w => String(w.id) === String(id));
    if (worker) formInput.attendance.push({ workerId: worker.id, hours: 0, ...(worker.subcontractor ? { amount: 0 } : {}) });
  }
  for (const r of item.materials) if (!formInput.materialsUsed.some(m => m.name === r.name && (m.unit ?? "") === (r.unit ?? ""))) formInput.materialsUsed.push({ ...r, quantity: 0 });
  for (const [key, suggestions] of [["equipmentCostsUsed", item.equipment], ["otherCostsUsed", item.other]]) for (const r of suggestions) if (!formInput[key].some(m => m.name === r.name)) formInput[key].push({ name: r.name, amount: 0 });
}
const materialKey = row => `${row.name.trim().toLowerCase()}:${(row.unit ?? "").trim().toLowerCase()}`;
function openMaterialPicker() {
  if (blocked || loadingItem || !project || !item || document.querySelector('#material-picker')) return;
  const projectKey = project.id, taskKey = item.key;
  const dialog = element("dialog", { id: "material-picker", className: "workforce-picker material-picker", "aria-labelledby": "material-picker-title", "aria-describedby": "material-picker-description" });
  const close = () => { dialog.close(); dialog.remove(); document.querySelector('[aria-label="Add material"]')?.focus(); };
  const heading = element("div", { className: "workforce-heading" }), title = element("div");
  const icon = element("span", { className: "workforce-icon", "aria-hidden": "true" });
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m12 3 9 5v8l-9 5-9-5V8Zm-9 5 9 5 9-5M12 13v8M7.5 5.5l9 5"/></svg>';
  title.append(element("h2", { id: "material-picker-title" }, "Select material from stock"), element("p", { id: "material-picker-description" }, "Choose a material from downloaded project stocks to record its usage today."));
  const x = element("button", { type: "button", className: "workforce-close", "aria-label": "Close material stock", onclick: close });
  x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 6-12 12M6 6l12 12"/></svg>';
  heading.append(icon, title, x);
  const content = element("div", { className: "workforce-content" });
  const search = element("input", { type: "search", placeholder: "Search material by name or unit...", "aria-label": "Search stock", autocomplete: "off" });
  const list = element("div", { className: "workforce-list", id: "material-stock-list" });
  function renderStocks() {
    list.replaceChildren();
    const excluded = new Set([...item.materials, ...formInput.materialsUsed, ...formInput.unplannedMaterials].map(materialKey));
    const query = search.value.trim().toLowerCase();
    const stocks = (project.materialStocks ?? []).filter(stock => !excluded.has(materialKey(stock)) && `${stock.name} ${stock.unit}`.toLowerCase().includes(query));
    const table = element("table"), thead = element("thead"), headers = element("tr"), tbody = element("tbody");
    for (const name of ["Material", "Unit", "Purchased", "Used", "Stock on hand", "Status"]) headers.append(element("th", { scope: "col" }, name));
    thead.append(headers); table.append(thead);
    for (const stock of stocks) {
      const choose = () => {
        if (blocked || loadingItem || project?.id !== projectKey || item?.key !== taskKey || stock.balance <= 0) return;
        if (![...formInput.materialsUsed, ...formInput.unplannedMaterials].some(row => materialKey(row) === materialKey(stock))) {
          formInput.unplannedMaterials.push({ name: stock.name, unit: stock.unit, quantity: 0, unitCost: stock.unitCost });
          renderForm(); scheduleDraft();
        }
        close();
      };
      const row = element("tr", { onclick: choose }), cell = element("td");
      cell.append(element("button", { type: "button", className: "workforce-member", disabled: stock.balance <= 0 }, stock.name));
      row.append(cell, element("td", {}, stock.unit));
      for (const value of [stock.purchased, stock.used, stock.balance]) row.append(element("td", {}, Number(value).toLocaleString("en-PH")));
      const status = element("td");
      status.append(element("span", { className: stock.balance > 0 ? "stock-available" : "stock-unavailable" }, stock.balance > 0 ? stock.status : "Out of stock")); row.append(status);
      tbody.append(row);
    }
    table.append(tbody); list.append(table);
    if (!stocks.length) list.append(element("p", { className: "workforce-empty", role: "status" }, !project.materialStocks ? "Update the offline copy while online to download material stocks." : "No additional materials match the downloaded stock list."));
  }
  search.addEventListener("input", renderStocks);
  content.append(search, element("p", { className: "footnote" }, `Stock snapshot: ${new Date(project.preparedAt).toLocaleString("en-PH")}. Quantities may change while offline.`), list);
  const footer = element("div", { className: "workforce-footer" }); footer.append(element("button", { type: "button", onclick: close }, "Close"));
  dialog.append(heading, content, footer);
  dialog.addEventListener("close", () => { dialog.remove(); document.querySelector('[aria-label="Add material"]')?.focus(); });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); close(); } });
  document.body.append(dialog); renderStocks(); dialog.showModal(); search.focus();
}
function updateCostSummary() {
  if (!formInput || !project) return;
  const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const laborRows = formInput.attendance.filter(row => amount(row.hours) !== 0 || amount(row.amount) !== 0);
  const labor = laborRows.length ? laborRows.reduce((total, row) => {
    const worker = project.workers.find(w => String(w.id) === String(row.workerId));
    return total + (row.amount != null ? amount(row.amount) : Math.round(amount(row.hours) * amount(worker?.rate) * 100) / 100);
  }, 0) : amount(formInput.costs.labor);
  const totals = { labor };
  for (const [key, planned, added] of [["equipment", "equipmentCostsUsed", "unplannedEquipmentCosts"], ["other", "otherCostsUsed", "unplannedOtherCosts"]]) {
    totals[key] = amount(formInput.costs[key]) + [...formInput[planned], ...formInput[added]].reduce((total, row) => total + amount(row.amount), 0);
  }
  for (const [key, total] of Object.entries(totals)) {
    const input = document.querySelector(`[name="summary-${key}"]`);
    if (input) input.value = peso(total);
  }
}
function costsBlock(title, plannedName, unplannedName, suggestions) {
  const block = section(title);
  for (const name of [plannedName, unplannedName]) for (const row of formInput[name]) {
    const container = element("div", { className: "resource cost-row" });
    const planned = name === plannedName || suggestions.some(r => r.name === row.name);
    container.append(inputField(row, "name", "Description", false, { placeholder: "Cost description", readOnly: planned, ...(planned ? { tabIndex: -1 } : {}) }), inputField(row, "amount", "Amount", true));
    if (!planned) container.append(removeButton(formInput[name], row));
    block.append(container);
  }
  const directAmount = formInput.costs[plannedName === "equipmentCostsUsed" ? "equipment" : "other"];
  if (directAmount) block.append(element("p", { className: "footnote" }, `Previously recorded non-itemized amount: ${peso(directAmount)}`));
  addButton(block, `Add ${title.toLowerCase()}`, () => formInput[unplannedName].push({ name: "", amount: 0 }));
  if (!formInput[plannedName].length && suggestions.length) {
    const select = element("select", { "aria-label": `Add planned ${title.toLowerCase()}` });
    select.append(element("option", { value: "", hidden: true }, "Add planned item"));
    suggestions.forEach((r, i) => select.append(element("option", { value: String(i) }, r.name)));
    select.addEventListener("change", () => { if (select.value !== "") { formInput[plannedName].push({ name: suggestions[Number(select.value)].name, amount: 0 }); renderForm(); scheduleDraft(); } });
    block.append(select);
  }
}
function renderForm() {
  rendering = true;
  $("form-content").replaceChildren();
  if (!item) { rendering = false; return; }
  if (reviewId) {
    const current = state.input ?? blank(), comparison = element("details", { className: "review", open: true });
    comparison.append(element("summary", {}, "Current saved log"), element("p", {}, `Quantity: ${current.quantityCompletedToday} ${item.unit}`));
    if (current.costs.labor) comparison.append(element("p", {}, `Labor amount: ${peso(current.costs.labor)}`));
    for (const r of current.attendance ?? []) comparison.append(element("p", {}, `${project.workers.find(w => w.id === r.workerId)?.name ?? "Previously recorded worker"}: ${r.amount != null ? peso(r.amount) : `${r.hours} hours`}`));
    for (const r of [...(current.materialsUsed ?? []), ...(current.unplannedMaterials ?? [])]) comparison.append(element("p", {}, `${r.name}: ${r.quantity} ${r.unit ?? ""}${r.unitCost != null ? ` at ${peso(r.unitCost)}` : ""}`));
    for (const r of [...(current.equipmentCostsUsed ?? []), ...(current.unplannedEquipmentCosts ?? []), ...(current.otherCostsUsed ?? []), ...(current.unplannedOtherCosts ?? [])]) comparison.append(element("p", {}, `${r.name}: ${peso(r.amount)}`));
    if (current.costs.equipment) comparison.append(element("p", {}, `Additional equipment: ${peso(current.costs.equipment)}`));
    if (current.costs.other) comparison.append(element("p", {}, `Additional other cost: ${peso(current.costs.other)}`));
    comparison.append(element("p", {}, "Your offline values are below. Check every resource before saving a replacement for this day."));
    $("form-content").append(comparison);
  }
  const work = section("Daily accomplishment"), columns = element("div", { className: "two-cols" });
  const quantity = inputField(formInput, "quantityCompletedToday", "Quantity completed", true, { max: String(Math.max(0, item.quantity - Number(state.totalQuantity) + Number(state.input?.quantityCompletedToday || 0))) });
  const quantityGroup = element("div"); quantityGroup.append(quantity);
  const hint = element("div", { className: "hint" });
  hint.append(element("span", {}, `Logged: ${Number((state.totalQuantity || 0) - (state.pendingQuantity || 0)).toLocaleString("en-PH")} ${item.unit}`), element("span", {}, `Planned: ${item.quantity.toLocaleString("en-PH")} ${item.unit}`)); quantityGroup.append(hint);
  columns.append(quantityGroup, costSummary("labor", "Labor cost", "From labor"), costSummary("equipment", "Equipment cost", "From items"), costSummary("other", "Other cost", "From items"));
  work.append(columns);
  if (state.pendingQuantity) work.append(element("p", { className: "footnote" }, `Pending sync on other dates: ${state.pendingQuantity} ${item.unit}`));

  const labor = section("Labor costs");
  for (const row of formInput.attendance) {
    const worker = project.workers.find(w => String(w.id) === String(row.workerId));
    const container = element("div", { className: "resource" });
    container.append(prefilledField("Worker", worker?.name ?? "Previously recorded worker"));
    if (worker?.subcontractor || row.amount != null) {
      row.hours = 0; row.amount ??= 0;
      container.append(prefilledField("Rate", "Daily amount"), inputField(row, "amount", "Amount", true));
    } else container.append(prefilledField("Rate", `${peso(worker?.rate)}/hr`), inputField(row, "hours", "Hours worked", true, { max: "24" }));
    if (!item.workerIds.some(id => String(id) === String(row.workerId))) container.append(removeButton(formInput.attendance, row));
    labor.append(container);
  }
  addButton(labor, "Add worker or subcontractor", () => {
    openWorkforcePicker();
    return false;
  });
  if (formInput.costs.labor && !formInput.attendance.some(r => r.hours || r.amount)) labor.append(element("p", { className: "footnote" }, `Previously recorded non-itemized labor: ${peso(formInput.costs.labor)}`));

  const materials = section("Materials used");
  for (const name of ["materialsUsed", "unplannedMaterials"]) for (const row of formInput[name]) {
    const container = element("div", { className: `resource ${name === "unplannedMaterials" ? "material-row" : ""}` });
    const planned = name === "materialsUsed" || item.materials.some(r => r.name === row.name && (r.unit ?? "") === (row.unit ?? ""));
    const stock = (project.materialStocks ?? []).find(stock => materialKey(stock) === materialKey(row));
    const prefilled = planned || !!stock;
    container.append(inputField(row, "name", "Material", false, { placeholder: "Material description", readOnly: prefilled, ...(prefilled ? { tabIndex: -1 } : {}) }), inputField(row, "quantity", "Quantity", true), inputField(row, "unit", "Unit", false, { maxLength: 40, readOnly: prefilled, ...(prefilled ? { tabIndex: -1 } : {}) }));
    if (name === "unplannedMaterials") container.append(inputField(row, "unitCost", "Unit cost", true, stock ? { readOnly: true, tabIndex: -1 } : {}));
    if (!planned) container.append(removeButton(formInput[name], row));
    materials.append(container);
  }
  addButton(materials, "Add material", () => { openMaterialPicker(); return false; });
  costsBlock("Equipment costs", "equipmentCostsUsed", "unplannedEquipmentCosts", item.equipment);
  costsBlock("Other costs", "otherCostsUsed", "unplannedOtherCosts", item.other);
  $("log-form").querySelectorAll("input,select,button").forEach(node => { node.disabled = blocked; });
  updateCostSummary();
  updateSave();
  rendering = false;
}
function normalized(source = formInput) {
  const input = { ...blank(), ...structuredClone(source) };
  for (const name of ["equipmentCostsUsed", "unplannedEquipmentCosts", "otherCostsUsed", "unplannedOtherCosts"]) input[name] = input[name].filter(r => r.amount !== 0).map(r => ({ ...r, name: r.name.trim() }));
  for (const name of ["materialsUsed", "unplannedMaterials"]) input[name] = input[name].filter(r => r.quantity !== 0).map(r => ({ ...r, name: r.name.trim(), unit: r.unit?.trim() || null }));
  input.attendance = input.attendance.filter(r => r.hours !== 0 || (r.amount ?? 0) !== 0);
  if (input.attendance.length) input.costs.labor = 0;
  return input;
}
function inputKey(input) {
  const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  const value = stable(normalized(input));
  for (const [key, rows] of Object.entries(value)) if (Array.isArray(rows)) value[key] = rows.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(value);
}
function updateSave() {
  $("save").disabled = blocked || loadingItem || !formInput || inputKey(formInput) === inputKey(state.input ?? blank());
}
function scheduleDraft() {
  if (rendering || blocked || loadingItem || !project || !item) return;
  updateCostSummary();
  updateSave();
  const draft = { id: draftKey(project.ownerId, project.projectId, item.key, $("date").value), ownerId: project.ownerId,
    input: structuredClone(formInput), expectedVersion: state.version, reviewId, savedAt: new Date().toISOString() };
  $("draft-status").textContent = "Saving draft on this device…";
  // Queue writes in order, including task/date switches. Do not acknowledge
  // persistence until IndexedDB's transaction has committed.
  pendingDraft = pendingDraft.catch(() => {}).then(() => localPut("drafts", draft)).then(() => {
    if (project && item && draft.id === draftKey(project.ownerId, project.projectId, item.key, $("date").value)) $("draft-status").textContent = "Draft saved on this device";
  }).catch(() => { notice("Could not save the draft on this device. Check browser storage before closing this screen."); throw new Error("Draft storage failed"); });
  // The Save handler still awaits this promise and can surface a quota error.
  pendingDraft.catch(() => {});
}
async function openItem(overrideInput, reviewing) {
  loadingItem = true;
  $("log-form").querySelectorAll("input,select,button").forEach(node => { node.disabled = true; });
  await pendingDraft.catch(() => {});
  item = project.items.find(row => row.key === $("task").value);
  if (!item) { $("editor").hidden = true; return; }
  const date = $("date").value;
  state = await offlineEntryState(project, item, date);
  const draft = await localGet("drafts", draftKey(project.ownerId, project.projectId, item.key, date));
  const queued = (await localAll("outbox")).find(row => row.ownerId === project.ownerId && row.projectId === project.projectId && `${row.kind}-${row.itemId}` === item.key && row.workDate === date && row.status !== "synced");
  // Count unsynchronized quantities on other dates too. The server repeats
  // this check against current official data when the queue synchronizes.
  const pending = (await localAll("outbox")).filter(row => row.ownerId === project.ownerId && row.projectId === project.projectId && row.kind === item.kind && row.itemId === item.id && row.workDate !== date && row.status !== "synced");
  state.pendingQuantity = 0;
  for (const row of pending) state.pendingQuantity += row.input.quantityCompletedToday - (project.states[`${item.key}:${row.workDate}`]?.input?.quantityCompletedToday ?? 0);
  state.totalQuantity += state.pendingQuantity;
  reviewId = reviewing ?? draft?.reviewId;
  blocked = !!queued && queued.id !== reviewId;
  formInput = structuredClone(overrideInput ?? (blocked ? queued.input : draft?.input ?? state.input ?? blank()));
  // A restored draft keeps its original concurrency baseline, even if another
  // tab downloaded newer data. The server must still detect that conflict.
  if (draft && !overrideInput) state = { ...state, version: draft.expectedVersion };
  for (const name of ["attendance", "materialsUsed", "unplannedMaterials", "equipmentCostsUsed", "unplannedEquipmentCosts", "otherCostsUsed", "unplannedOtherCosts"]) formInput[name] ??= [];
  mergePlannedRows();
  loadingItem = false; renderForm();
  $("draft-status").textContent = blocked ? "This entry is already saved on this device. Check Saved entries for its synchronization status." : draft ? "Restored draft from this device" : "";
}
async function selectProject(key, itemKey, date, overrideInput, reviewing) {
  project = await localGet("projects", key);
  if (!project) return;
  $("editor").hidden = !project.items.length;
  $("downloaded").textContent = `Downloaded ${new Date(project.preparedAt).toLocaleString("en-PH")}`;
  $("task").replaceChildren(...project.items.map(row => element("option", { value: row.key }, row.phase ? `${row.name} · ${row.phase}` : row.name)));
  if (itemKey) $("task").value = itemKey;
  $("date").min = project.availableFrom ?? project.workDate; $("date").max = manilaDate(); $("date").value = date ?? manilaDate();
  if (project.items.length) await openItem(overrideInput, reviewing);
  else notice("No daily-log tasks were included in this offline copy. Update the project while online.");
  document.querySelectorAll(".project").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.key === key)));
}
async function refreshEntries() {
  const owner = await activeOfflineOwner();
  if (!owner || owner.locked) return;
  const rows = (await localAll("outbox")).filter(row => row.ownerId === owner.ownerId).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  $("saved").hidden = rows.length === 0;
  $("pending-count").textContent = `${rows.filter(row => row.status !== "synced").length} pending`;
  $("outbox").replaceChildren();
  const statuses = { pending: "Pending sync", syncing: "Synchronizing…", synced: "Synced", "needs-review": "Needs review", "auth-required": "Sign in to sync" };
  for (const row of rows.slice(0, 100)) {
    const cached = projects.find(p => p.projectId === row.projectId), task = cached?.items.find(i => `${i.kind}-${i.id}` === `${row.kind}-${row.itemId}`);
    const container = element("div", { className: "entry" }), details = element("div");
    details.append(element("strong", {}, `${task?.name ?? "Saved task"} · ${prettyDate(row.workDate)}`), element("p", {}, `${cached?.name ?? "Project"} · ${row.input.quantityCompletedToday} ${task?.unit ?? ""}`));
    if (row.error) details.append(element("p", { className: "error" }, row.error));
    const actions = element("div"); actions.append(element("span", { className: `status ${row.status === "synced" ? "synced" : "pending"}` }, statuses[row.status]));
    if (row.status === "needs-review") actions.append(element("button", { type: "button", onclick: async () => {
      try {
        await prepareOfflineProject(row.projectId, row.workDate);
        projects = (await localAll("projects")).filter(p => p.ownerId === owner.ownerId);
        const fresh = projects.find(p => p.projectId === row.projectId);
        if (!fresh?.items.some(i => i.kind === row.kind && i.id === row.itemId)) { notice("The original task is unavailable. Contact your Project Manager; this entry remains saved on this device."); return; }
        await selectProject(fresh.id, `${row.kind}-${row.itemId}`, row.workDate, row.input, row.id);
        notice("Compare your offline values with the latest saved record. Saving will replace that day's values after validation.");
        $("editor").scrollIntoView({ behavior: "smooth" });
      } catch (error) { notice(error.message); }
    } }, "Review"));
    if (row.status === "needs-review") {
      let confirmed = false;
      const discard = element("button", { type: "button", className: "discard", onclick: async () => {
        if (!confirmed) { confirmed = true; discard.textContent = "Confirm discard"; return; }
        discard.disabled = true;
        try {
          await pendingDraft.catch(() => {});
          await localDelete("outbox", row.id);
          await localDelete("drafts", draftKey(row.ownerId, row.projectId, `${row.kind}-${row.itemId}`, row.workDate));
          if (project?.projectId === row.projectId && item?.key === `${row.kind}-${row.itemId}` && $("date").value === row.workDate) await openItem();
          await refreshEntries(); notice("Offline copy discarded. Official records are unchanged.");
        } catch { notice("Could not discard the offline copy. Try again."); discard.disabled = false; }
      } }, "Discard offline copy");
      actions.append(discard);
    }
    container.append(details, actions); $("outbox").append(container);
  }
}
async function start() {
  const owner = await activeOfflineOwner();
  projects = owner && !owner.locked ? (await localAll("projects")).filter(row => row.ownerId === owner.ownerId) : [];
  $("projects").replaceChildren();
  if (!projects.length) {
    const message = element("div", { className: "empty" });
    message.append(element("h2", {}, "No projects available offline"), element("p", {}, owner?.locked ? "This offline workspace was locked after signing out. Sign in online with the original account to reopen it. Saved entries are retained." : "While online, open your project and choose Make available offline."), element("a", { href: "/" }, "Sign in to IDRMM"));
    $("projects").append(message); $("editor").hidden = true; $("saved").hidden = true; return;
  }
  projects.forEach(row => {
    const button = element("button", { type: "button", className: "project", "data-key": row.id, onclick: () => selectProject(row.id).catch(error => notice(error.message)) });
    button.append(element("strong", {}, row.name), element("span", {}, `${row.items.length} tasks · ${row.ownerName}`)); $("projects").append(button);
  });
  const requested = Number(new URL(location.href).searchParams.get("project"));
  await selectProject((projects.find(p => p.projectId === requested) ?? projects[0]).id);
  await refreshEntries();
}
$("task").addEventListener("change", () => openItem().catch(error => notice(error.message)));
$("date").addEventListener("change", () => { if ($("date").validity.valid) openItem().catch(error => notice(error.message)); });
$("log-form").addEventListener("input", scheduleDraft);
$("log-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (blocked || loadingItem || $("save").disabled) return;
  $("save").disabled = true;
  try {
    await pendingDraft;
    const input = normalized();
    await queueOfflineLog(project, item, $("date").value, input, state.version, reviewId);
    notice("Entry saved on this device. It becomes official after synchronization succeeds.");
    await openItem(); await refreshEntries();
    void synchronizeOfflineLogs(true);
  } catch (error) { notice(error.message); $("save").disabled = false; }
});
$("sync").addEventListener("click", async () => { $("sync").disabled = true; await synchronizeOfflineLogs(true); $("sync").disabled = false; await refreshEntries(); });
function connectivity() {
  const offline = navigator.onLine === false;
  $("connection").replaceChildren(
    element("span", { className: offline ? "connection-offline" : "connection-online" }, offline ? "Offline" : "Connected"),
    element("small", {}, offline ? "Saved on this device" : "Synchronization available")
  );
}
window.addEventListener("online", () => { connectivity(); void synchronizeOfflineLogs(true); });
window.addEventListener("offline", connectivity);
window.addEventListener("focus", () => void synchronizeOfflineLogs());
subscribeOffline(() => {
  void activeOfflineOwner().then(async owner => {
    if (!owner || owner.locked || project && owner.ownerId !== project.ownerId) {
      document.querySelector('#workforce-picker')?.close();
      document.querySelector('#material-picker')?.close();
      $("editor").hidden = true; $("saved").hidden = true; project = undefined; item = undefined;
      await start();
    } else {
      if (project && item && formInput && !loadingItem) {
        const latest = await localGet("projects", project.id);
        if (latest && latest.preparedAt !== project.preparedAt) {
          const latestItem = latest.items.find(row => row.key === item.key);
          if (latestItem) {
            project = latest; item = latestItem;
            $("downloaded").textContent = `Downloaded ${new Date(project.preparedAt).toLocaleString("en-PH")}`;
            mergePlannedRows(); renderForm();
          }
        }
      }
      await refreshEntries();
    }
  }).catch(() => {});
});
window.addEventListener("idrmm-offline-synced", async event => {
  if (project?.projectId === event.detail.projectId) {
    project = await localGet("projects", project.id);
    // Never replace an unsaved form while its user is typing.
    if (blocked) await openItem();
  }
});
connectivity();
async function boot() {
  // Check identities before rendering cached data when a connection exists.
  // A missing live session permits local entry only; synchronization still
  // requires the original authenticated account.
  if (navigator.onLine !== false) try {
    const response = await fetch("/api/offline/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const current = await response.json(), owner = await activeOfflineOwner();
      if (owner && current.id !== owner.ownerId) await lockOfflineWorkspace();
    }
  } catch { /* A disconnected device opens only its previously prepared copy. */ }
  await start(); void synchronizeOfflineLogs();
}
boot().catch(() => notice("This browser could not open offline storage. Use a regular browser window with site storage enabled."));
setInterval(() => void synchronizeOfflineLogs(), 15000);

$("report-incident").addEventListener("click", async () => {
  if (!project || !item) return;
  const savedProject=project, savedItem=item;
  const key=`incident-draft:${project.ownerId}:${project.projectId}:${item.key}`;
  const previous=await localGet("settings",key);
  const dialog=element("dialog",{className:"workforce-picker offline-incident","aria-label":"Report incident"});
  const heading=element("div",{className:"workforce-heading"});
  const icon=element("span",{className:"incident-heading-icon","aria-hidden":"true"});icon.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 22V3m0 1c5-4 11 4 16 0v11c-5 4-11-4-16 0"/></svg>';
  heading.append(icon,element("h2",{},"Report Incident"));
  const close=()=>{dialog.close();dialog.remove();};
  function crossButton(label, action) {
    const button=element("button",{type:"button",className:"remove","aria-label":label,onclick:action});
    button.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    return button;
  }
  heading.append(crossButton("Close",close));
  const form=element("form",{autocomplete:"off"});
  const content=element("div",{className:"incident-fields"});
  const addField=(label,name,type="text",required=false)=>{const labelNode=field(label,"",name,{type,required});content.append(labelNode);return labelNode.querySelector("input");};
  const peopleHeading=element("h3",{},"Persons involved");content.append(peopleHeading);
  const people=element("div");content.append(people);
  function addPerson(person={}) {const row=element("div",{className:"incident-person"});for(const [label,name]of [["Name","name"],["Role","role"],["Contact information","contact"]])row.append(field(label,person[name]??"",`person-${name}`));row.append(crossButton("Remove person involved",()=>row.remove()));people.append(row);}
  (previous?.people?.length?previous.people:[{}]).forEach(addPerson);
  peopleHeading.append(element("button",{type:"button",className:"section-add","aria-label":"Add person involved",onclick:()=>{if(people.children.length<10)addPerson();}},"+"));
  content.append(element("h3",{},"Incident details"));
  const date=addField("Date *","occurredOn","date",true);date.value=manilaDate();date.max=manilaDate();
  const time=addField("Time *","occurredTime","text",true);time.placeholder="hh:mm";time.pattern="(0?[1-9]|1[0-2]):[0-5][0-9]";time.maxLength=5;
  const periods=element("span",{className:"incident-period"});
  for(const value of ["AM","PM"]){const choice=element("label",{className:"incident-choice"});choice.append(element("input",{type:"checkbox",name:"period",value,checked:value==="AM",onchange:event=>{for(const input of periods.querySelectorAll("input"))input.checked=input===event.target;event.target.checked=true;}}),document.createTextNode(value));periods.append(choice);}time.parentNode.append(periods);
  addField("Location","location");
  const kinds=element("fieldset");kinds.append(element("legend",{},"Type of incident *"));
  for(const [value,label]of Object.entries({injury:"Worker injury",equipment_damage:"Equipment incident",fall_slip:"Fall / slip",property_damage:"Property / material damage",excavation:"Excavation / trenching",fire:"Fire / explosion",vehicle:"Vehicle incident",hazardous_exposure:"Hazardous substance exposure",near_miss:"Near miss",other:"Other"})) {const choice=element("label",{className:"incident-choice"});choice.append(element("input",{type:"checkbox",name:"incidentKind",value}),document.createTextNode(label));kinds.append(choice);}content.append(kinds);
  const other=addField("Other incident type *","otherType");other.parentNode.hidden=true;
  kinds.addEventListener("change",()=>{other.parentNode.hidden=!kinds.querySelector('[value=other]').checked;other.required=!other.parentNode.hidden;});
  const describe=element("label",{},"Describe the incident *");describe.append(element("textarea",{name:"description",rows:1,required:true,maxLength:5000}));content.append(describe);
  content.append(element("h3",{},"Injuries and medical attention"));
  function yesNo(label,name){const group=element("fieldset");group.append(element("legend",{},label));for(const [value,text]of [["yes","Yes"],["no","No"]]){const choice=element("label",{className:"incident-choice"});choice.append(element("input",{type:"radio",name,value,required:true}),document.createTextNode(text));group.append(choice);}content.append(group);}
  yesNo("Was anyone injured? *","injured");
  const injuryLabel=element("label",{},"Describe the injury");const injury=element("textarea",{name:"injuryDescription",rows:1,maxLength:2000});injuryLabel.append(injury);content.append(injuryLabel);
  yesNo("Was first aid administered? *","firstAid");yesNo("Was EMS / hospital transport required? *","hospitalTransport");
  addField("First responder / medical provider","medicalProvider");
  const attachments=addField("Attachments","attachments","file");attachments.multiple=true;attachments.accept="image/jpeg,image/png,application/pdf";
  const attachmentLabel=attachments.parentNode;attachmentLabel.replaceChildren();
  const attachmentHeading=element("h3",{},"Attachments");attachmentLabel.append(attachmentHeading,attachments);attachments.hidden=true;
  const fileNames=element("div",{className:"incident-files"});
  attachmentLabel.append(element("button",{type:"button",className:"incident-upload",onclick:()=>attachments.click()},"? Add attachments"),fileNames);
  attachments.addEventListener("change",()=>{fileNames.replaceChildren();for(const file of attachments.files)fileNames.append(element("p",{},file.name));});
  const error=element("p",{className:"error",role:"alert"});
  // Edge-to-edge sections follow the online incident form.
  const nodes=[...content.children];content.replaceChildren();let block;
  for(const node of nodes){if(node.tagName==="H3"||node===attachmentLabel){block=element("section",{className:"incident-section"});content.append(block);}block.append(node);}
  const detailSection=content.children[1];const dateTime=element("div",{className:"incident-two-cols"});dateTime.append(date.parentNode,time.parentNode);detailSection.insertBefore(dateTime,detailSection.children[1]);
  const medical=content.children[2];const medicalQuestions=element("div",{className:"incident-two-cols"});const groups=medical.querySelectorAll("fieldset");medicalQuestions.append(groups[1],groups[2]);medical.insertBefore(medicalQuestions,medical.lastElementChild);
  content.append(error);
  for(const control of content.querySelectorAll("textarea"))control.addEventListener("input",()=>{control.style.height="auto";control.style.height=`${control.scrollHeight}px`;});
  for(const label of content.querySelectorAll("label,legend")){const first=label.firstChild;if(first?.nodeType===Node.TEXT_NODE&&first.textContent.includes("*")){const text=first.textContent;first.textContent=text.replace("*","");const mark=element("span",{className:"required-mark","aria-hidden":"true"},"*");first.after(mark);}}

  const footer=element("div",{className:"form-footer"});const submit=element("button",{type:"submit",className:"primary"},"Submit incident");footer.append(element("button",{type:"button",onclick:close},"Cancel"),submit);
  form.append(content,footer);dialog.append(heading,form);document.body.append(dialog);
  if(previous?.values)for(const control of form.elements){if(!control.name||control.type==="file")continue;const value=previous.values[control.name];if(control.type==="checkbox"||control.type==="radio")control.checked=Array.isArray(value)&&value.includes(control.value);else if(value!==undefined)control.value=value;}
  other.parentNode.hidden=!kinds.querySelector('[value=other]').checked;other.required=!other.parentNode.hidden;
  function capture(){const data=new FormData(form),values={};for(const control of form.elements){if(!control.name||control.type==="file"||control.name.startsWith("person-"))continue;values[control.name]=control.type==="radio"||control.type==="checkbox"?data.getAll(control.name):control.value;}return {id:key,values,people:[...people.children].map(row=>Object.fromEntries([...row.querySelectorAll("input")].map(input=>[input.name.slice(7),input.value]))) };}
  const timeTitle=element("span",{className:"incident-time-label"});
  for(const node of [...time.parentNode.childNodes])if(node.nodeType===Node.TEXT_NODE||node.classList?.contains("required-mark"))timeTitle.append(node);
  time.parentNode.prepend(timeTitle);
  let draftWrites=Promise.resolve();
  form.addEventListener("input",()=>{const draft=capture();draftWrites=draftWrites.then(()=>localPut("settings",draft)).catch(()=>{error.textContent="Could not save the draft on this device.";});});
  form.addEventListener("submit",async event=>{event.preventDefault();if(submit.disabled)return;error.textContent="";const data=new FormData(form),selected=data.getAll("incidentKind");other.required=selected.includes("other");injury.required=data.get("injured")==="yes";
    if(!selected.length){error.textContent="Select an incident type.";return;}if(!form.reportValidity())return;
    const period=form.querySelector('[name=period]:checked')?.value??"AM";
    const match=/^(0?[1-9]|1[0-2]):([0-5]\d)$/.exec(time.value);if(!match){error.textContent="Enter a valid time.";return;}
    const time24=`${String(Number(match[1])%12+(period==="PM"?12:0)).padStart(2,"0")}:${match[2]}`;
    const files=[...attachments.files];if(files.length>5||files.some(file=>file.size>10*1024*1024)||files.reduce((n,file)=>n+file.size,0)>15*1024*1024){error.textContent="Use up to 5 attachments, 10 MB each and 15 MB total.";return;}
    submit.disabled=true;submit.textContent="Saving...";
    try{await draftWrites;const draft=capture();await queueOfflineIncident(savedProject,savedItem,{incidentType:selected.find(kind=>["injury","equipment_damage","property_damage","near_miss","other"].includes(kind))??"other",severity:"minor",occurredOn:String(data.get("occurredOn")),occurredTime:time24,location:String(data.get("location")),description:String(data.get("description")),details:JSON.stringify({people:draft.people,kinds:selected,otherType:other.value,injured:data.get("injured")==="yes",injuryDescription:injury.value,firstAid:data.get("firstAid")==="yes",hospitalTransport:data.get("hospitalTransport")==="yes",medicalProvider:String(data.get("medicalProvider"))})},files);await localDelete("settings",key);close();notice("Incident saved on this device. It will synchronize when connected and signed in.");void synchronizeOfflineLogs();await refreshIncidentEntries();}
    catch(cause){error.textContent=cause.message;submit.disabled=false;submit.textContent="Submit incident";}
  });
  dialog.addEventListener("cancel",event=>{event.preventDefault();close();});dialog.showModal();
});
async function refreshIncidentEntries(){
  const owner=await activeOfflineOwner();const holder=$("offline-incidents")??element("section",{id:"offline-incidents"});if(!holder.parentNode)$("saved").after(holder);
  holder.replaceChildren();if(!owner||owner.locked)return;
  const reports=(await localAll("settings")).filter(row=>row.id.startsWith("incident:")&&row.ownerId===owner.ownerId).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));
  if(!reports.length)return;holder.append(element("h2",{},"Saved incident reports"));
  for(const row of reports){const card=element("div",{className:"entry"});card.append(element("strong",{},`${row.taskName} ? ${prettyDate(row.fields.occurredOn)}`),element("p",{},row.fields.description),element("span",{className:`status ${row.status==="synced"?"synced":"pending"}`},row.status==="synced"?"Synced":"Pending sync"));if(row.error)card.append(element("p",{className:"error"},row.error));holder.append(card);}
}
subscribeOffline(()=>void refreshIncidentEntries());void refreshIncidentEntries();
