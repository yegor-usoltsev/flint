import { cn } from "cn";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";

export const UserAvatar = ({
  avatarUrl,
  className,
  name,
}: {
  avatarUrl: string;
  className?: string;
  name: string;
}) => (
  <Avatar className={cn("size-6", className)}>
    {avatarUrl === "" ? null : <AvatarImage alt="" src={avatarUrl} />}
    <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
  </Avatar>
);
