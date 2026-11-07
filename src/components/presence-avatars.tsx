import { Hint } from "~/components/issue-parts";
import { AvatarGroup } from "~/components/ui/avatar";
import { UserAvatar } from "~/components/user-avatar";
import { usePresence } from "~/lib/presence";
import { useWorkspace } from "~/lib/use-workspace";

const shown = 3;

export const PresenceAvatars = ({ targetId }: { targetId: string }) => {
  const workspace = useWorkspace();
  const viewers = usePresence(workspace.slug, targetId);

  if (viewers.length === 0) {
    return null;
  }

  const names = viewers.map((viewer) => viewer.displayName || viewer.username);
  const label = `Also viewing: ${names.join(", ")}`;

  return (
    <Hint label={label}>
      <AvatarGroup className="mr-1 shrink-0">
        <span className="sr-only">{label}</span>
        {viewers.slice(0, shown).map((viewer, index) => (
          <UserAvatar
            avatarUrl={viewer.avatarUrl}
            key={viewer.username}
            name={names[index] ?? viewer.username}
          />
        ))}
      </AvatarGroup>
    </Hint>
  );
};
