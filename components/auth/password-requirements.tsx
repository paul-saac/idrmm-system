import { Check, Circle } from "lucide-react";
import { getPasswordError, getPasswordRequirements } from "@/lib/auth/password-policy";

export function PasswordRequirements({ password, id }: { password: string; id: string }) {
  const rules = getPasswordRequirements(password);
  const extraError = password && rules.every(rule => rule.met) ? getPasswordError(password) : null;
  return (
    <div id={id} className="space-y-2 text-xs">
      <p className="font-medium text-zinc-700">Password requirements</p>
      <ul className="space-y-1">
        {rules.map(rule => {
          const met = Boolean(password) && rule.met;
          const Icon = met ? Check : Circle;
          return <li key={rule.id} className={`flex items-start gap-2 ${met ? "text-emerald-700" : "text-zinc-500"}`}>
            <Icon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
            <span>{rule.label}</span>
          </li>;
        })}
      </ul>
      {extraError && <p role="alert" className="text-red-600">{extraError}</p>}
    </div>
  );
}
