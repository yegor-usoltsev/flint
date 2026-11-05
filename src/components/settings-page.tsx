import { useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { SearchIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { SaveState } from "~/components/conflict-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "~/components/ui/input-group";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { useAutosaveText } from "~/lib/use-autosave-text";

export interface SettingsParent {
  label: string;
  link: ReactElement;
}

export const SettingsHeader = ({
  label,
  parent,
}: {
  label?: string;
  parent?: SettingsParent;
}) => {
  const account = useLocation({
    select: (location) =>
      /\/settings\/account(?:\/|$)/u.test(location.pathname),
  });

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger className="-ml-1" />
      <Separator
        className="mr-1 data-vertical:h-4 data-vertical:self-center"
        orientation="vertical"
      />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="max-md:hidden">
            {account ? "Account" : "Workspace"}
          </BreadcrumbItem>
          {parent === undefined ? null : (
            <>
              <BreadcrumbSeparator className="max-md:hidden" />
              <BreadcrumbItem className="min-w-6 shrink-[100]">
                <BreadcrumbLink
                  className="hit-area relative min-w-0"
                  render={parent.link}
                >
                  <span className="block truncate">{parent.label}</span>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </>
          )}
          {label === undefined ? null : (
            <>
              <BreadcrumbSeparator
                className={cn(parent === undefined && "max-md:hidden")}
              />
              <BreadcrumbItem className="min-w-12">
                <span className="text-foreground truncate font-medium">
                  {label}
                </span>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
};

export const SettingsPage = ({
  actions,
  children,
  description,
  heading,
  parent,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  heading?: ReactNode;
  parent?: SettingsParent;
  title: string;
}) => (
  <>
    <SettingsHeader label={title} parent={parent} />
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-192 flex-col gap-8 px-4 pt-8 pb-16 md:pt-12">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1 px-0.5">
            <h1 className="text-2xl font-medium">{heading ?? title}</h1>
            {description === undefined ? null : (
              <p className="text-muted-foreground text-pretty">{description}</p>
            )}
          </div>
          {actions === undefined ? null : (
            <div className="flex h-8 shrink-0 items-center gap-2">
              {actions}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  </>
);

export const SettingsSection = ({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  title?: string;
}) => (
  <section className="flex flex-col gap-3">
    {title === undefined ? null : (
      <div className="flex items-end gap-4 px-0.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-prose font-medium">{title}</h2>
          {description === undefined ? null : (
            <p className="text-muted-foreground text-pretty">{description}</p>
          )}
        </div>
        {action}
      </div>
    )}
    <div className="bg-card shadow-raised divide-y rounded-lg border px-4">
      {children}
    </div>
  </section>
);

export const SettingsRow = ({
  children,
  description,
  htmlFor,
  label,
}: {
  children?: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  label: ReactNode;
}) => (
  <div className="flex min-h-15 flex-wrap items-center gap-x-4 gap-y-2 py-3">
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      {htmlFor === undefined ? (
        <span className="font-medium">{label}</span>
      ) : (
        <label className="font-medium" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {description === undefined ? null : (
        <p className="text-muted-foreground text-xs text-pretty">
          {description}
        </p>
      )}
    </div>
    {children}
  </div>
);

export const SettingsInput = ({
  disabled,
  id,
  maxLength,
  onSave,
  prefix,
  validate,
  value,
}: {
  disabled: boolean;
  id: string;
  maxLength: number;
  onSave: (value: string) => Promise<void>;
  prefix?: string;
  validate?: (value: string) => string | null;
  value: string;
}) => {
  const field = useAutosaveText(value, onSave, validate);
  const invalid = !disabled && field.problem !== null;

  const props = {
    "aria-describedby": invalid ? `${id}-problem` : undefined,
    "aria-invalid": invalid || undefined,
    autoCapitalize: "none",
    autoComplete: "off",
    disabled,
    id,
    maxLength,
    onBlur: () => {
      void field.flush();
    },
    onChange: (event: { target: { value: string } }) => {
      field.edit(event.target.value);
    },
    onKeyDown: (event: { key: string }) => {
      if (event.key === "Enter") {
        void field.flush();
      }

      if (event.key === "Escape") {
        field.revert();
      }
    },
    readOnly: field.status === "saving",
    required: true,
    spellCheck: false,
    value: disabled ? value : field.text,
  } as const;

  return (
    <div className="flex w-full flex-col items-end gap-1 sm:w-64">
      {prefix === undefined ? (
        <Input {...props} />
      ) : (
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>{prefix}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput {...props} />
        </InputGroup>
      )}
      {field.status === "idle" || disabled ? null : (
        <div id={`${id}-problem`}>
          <SaveState
            onRetry={() => {
              void field.flush();
            }}
            problem={field.problem}
            status={field.status}
          />
        </div>
      )}
    </div>
  );
};

export const tableHead =
  "text-muted-foreground flex h-8 items-center gap-3 px-2 text-xs font-medium";

export const tableRow =
  "hover:bg-row-focus focus-visible:bg-row-focus relative flex min-h-11 items-center gap-3 rounded-md px-2 outline-none";

export const tableGroup =
  "bg-group-header flex h-9 items-center gap-2 rounded-md px-2 font-medium";

export const tableNumber = "w-16 shrink-0 text-right tabular-nums md:w-24";

export const tableDate =
  "text-muted-foreground w-24 shrink-0 text-right tabular-nums max-md:hidden";

export const TableEmpty = ({
  action,
  description,
  filter,
  onClearFilter,
  title,
}: {
  action?: ReactNode;
  description: string;
  filter: string;
  onClearFilter: () => void;
  title: string;
}) => {
  if (filter !== "") {
    return (
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 px-2 py-3">
        <span className="min-w-0 break-words">No results for “{filter}”</span>
        <Button onClick={onClearFilter} size="sm" variant="ghost">
          Clear filter
        </Button>
      </div>
    );
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action === undefined ? null : <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
};

export const SettingsFilter = ({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) => (
  <InputGroup>
    <InputGroupAddon>
      <SearchIcon aria-hidden />
    </InputGroupAddon>
    <InputGroupInput
      aria-label={label}
      autoComplete="off"
      onChange={(event) => {
        onChange(event.target.value);
      }}
      placeholder={`${label}…`}
      type="search"
      value={value}
    />
  </InputGroup>
);
