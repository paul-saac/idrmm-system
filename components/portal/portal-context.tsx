"use client";

import { createContext, useContext, type ReactNode } from "react";

export type PortalBasePath = "/admin" | "/foreman";

export type Portal = {
  /** Route prefix every in-app link is built from. */
  basePath: PortalBasePath;
  /** Admin-only controls (editing/deleting a project, creating projects,
   * managing the equipment inventory) are hidden when false. Purely a UI
   * affordance — the server actions and RLS enforce the real rules. */
  isAdmin: boolean;
  /** Who's signed in — the profile menu in every page header. */
  user: { name: string; email: string | null; roleLabel: string };
};

const PortalContext = createContext<Portal | null>(null);

export function PortalProvider({
  portal,
  children,
}: {
  portal: Portal;
  children: ReactNode;
}) {
  return <PortalContext.Provider value={portal}>{children}</PortalContext.Provider>;
}

export function usePortal(): Portal {
  const portal = useContext(PortalContext);
  if (!portal) {
    throw new Error("usePortal must be used inside a PortalProvider (see the portal layouts).");
  }
  return portal;
}
