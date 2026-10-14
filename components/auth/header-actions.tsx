import { ProfileMenu } from "@/components/auth/profile-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";

/** Every page header's right side: the notification bell, a divider, then
 * the signed-in user's own menu (Settings, Log out). */
export function HeaderActions() {
  return (
    // self-stretch: as tall as the header's content, so the divider can
    // reach both of its edges — -my-5 takes back the header's own py-5
    // (every header that uses this has it).
    <div className="flex items-center gap-4 self-stretch">
      <NotificationBell />
      <span aria-hidden="true" className="-my-5 w-px self-stretch bg-zinc-200" />
      <ProfileMenu />
    </div>
  );
}
