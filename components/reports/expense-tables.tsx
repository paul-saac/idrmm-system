import type {
  LaborExpenseGroup,
  MaterialExpenseGroup,
  EquipmentExpenseGroup,
} from "@/lib/expenses/data";

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function TableCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="bg-zinc-800 px-4 py-2 text-sm font-medium text-white">
        {title}
      </div>
      {children}
    </div>
  );
}

const PROCUREMENT_TYPE_LABELS: Record<string, string> = {
  direct_purchase: "Direct Purchase",
  supplier_delivery: "Supplier Delivery",
};

export function MaterialExpenseTable({ groups }: { groups: MaterialExpenseGroup[] }) {
  const rows = groups.flatMap((group) =>
    group.procurements.flatMap((proc) =>
      proc.items.map((item) => ({
        key: `${item.id}`,
        date: group.logDate,
        supplier: proc.supplierName || PROCUREMENT_TYPE_LABELS[proc.procurementType],
        materialName: item.materialName,
        specification: item.specification,
        quantity: item.quantity,
        unit: item.unit,
        subTotal: item.subTotal,
      }))
    )
  );

  return (
    <TableCard title="Material Expenses">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">
          No material expenses in this range.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Supplier / Type</th>
                <th className="px-4 py-2 font-medium">Material</th>
                <th className="px-4 py-2 font-medium">Specification</th>
                <th className="px-4 py-2 font-medium">Qty</th>
                <th className="px-4 py-2 font-medium">Unit</th>
                <th className="px-4 py-2 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-2.5 text-zinc-600">{formatDate(row.date)}</td>
                  <td className="px-4 py-2.5 text-zinc-700">{row.supplier}</td>
                  <td className="px-4 py-2.5 font-medium text-zinc-900">
                    {row.materialName}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600">
                    {row.specification || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700">{row.quantity}</td>
                  <td className="px-4 py-2.5 text-zinc-600">{row.unit || "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-700">
                    {formatCurrency(row.subTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}

export function LaborExpenseTable({ groups }: { groups: LaborExpenseGroup[] }) {
  const rows = groups.flatMap((group) =>
    group.items.map((item) => ({ key: `${item.id}`, date: group.logDate, ...item }))
  );

  return (
    <TableCard title="Labor Expenses">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">
          No labor expenses in this range.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Worker Role</th>
                <th className="px-4 py-2 font-medium">Worker Count</th>
                <th className="px-4 py-2 font-medium">Daily Rate</th>
                <th className="px-4 py-2 font-medium">OT Hours</th>
                <th className="px-4 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-2.5 text-zinc-600">{formatDate(row.date)}</td>
                  <td className="px-4 py-2.5 font-medium text-zinc-900">
                    {row.workerRole}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700">{row.workerCount}</td>
                  <td className="px-4 py-2.5 text-zinc-700">
                    {formatCurrency(row.dailyRate)}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700">{row.otHours}</td>
                  <td className="px-4 py-2.5 text-zinc-700">
                    {formatCurrency(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}

const ACQUISITION_TYPE_LABELS: Record<string, string> = {
  rental: "Rental",
  purchase: "Purchase",
};

export function EquipmentExpenseTable({ groups }: { groups: EquipmentExpenseGroup[] }) {
  const rows = groups.flatMap((group) =>
    group.items.map((item) => ({ key: `${item.id}`, date: group.logDate, ...item }))
  );

  return (
    <TableCard title="Equipment Expenses">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">
          No equipment expenses in this range.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Equipment</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Qty</th>
                <th className="px-4 py-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-2.5 text-zinc-600">{formatDate(row.date)}</td>
                  <td className="px-4 py-2.5 font-medium text-zinc-900">
                    {row.equipmentName}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700">
                    {ACQUISITION_TYPE_LABELS[row.acquisitionType]}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700">{row.quantity}</td>
                  <td className="px-4 py-2.5 text-zinc-700">
                    {formatCurrency(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}
