import { LogoutButton } from "@/components/auth/logout-button";

export function AdminPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-8 py-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
        )}
      </div>
      <LogoutButton />
    </header>
  );
}
