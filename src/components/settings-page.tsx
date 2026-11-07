import { cn } from "cn";
import { SearchIcon } from "lucide-react";
import { createContext, useContext, useReducer, useRef } from "react";
import type { ReactElement, ReactNode } from "react";

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
import { ApiError } from "~/lib/api";
import { idleSave, savedForMs, saveStatus, trackSave } from "~/lib/save-status";
import type { SaveEvent, SaveTrack } from "~/lib/save-status";
import { rejection, useAutosaveText } from "~/lib/use-autosave-text";

const settingsCard = "bg-card shadow-raised rounded-lg border";

export interface SettingsParent {
  label: string;
  link: ReactElement;
}

type SaveRun = () => Promise<void>;

type Save = (key: string, run: SaveRun, retry?: () => void) => Promise<void>;

const SaveContext = createContext<Save | null>(null);

const ignore = () => null;

const useSaveScope = () => {
  const [state, dispatch] = useReducer(trackSave, idleSave);
  const settled = useRef(0);

  const settle = (event: SaveEvent) => {
    settled.current += 1;
    const { current } = settled;
    dispatch(event);
    setTimeout(() => {
      if (settled.current === current) {
        dispatch({ type: "expire" });
      }
    }, savedForMs);
  };

  const save: Save = async (key, run, retry) => {
    dispatch({ key, type: "start" });

    try {
      await run();
      settle({ key, type: "succeed" });
    } catch (error) {
      settle(
        error instanceof ApiError && rejection(error) !== null
          ? { key, type: "reject" }
          : {
              key,
              retry:
                retry ??
                (() => {
                  save(key, run).catch(ignore);
                }),
              type: "fail",
            }
      );
      throw error;
    }
  };

  return { save, state };
};

export const useSettingsSave = () => {
  const scope = useContext(SaveContext);

  const save: Save =
    scope ??
    (async (_key, run) => {
      await run();
    });

  return {
    save,
    saveInBackground: (key: string, run: SaveRun) => {
      save(key, run).catch(ignore);
    },
  };
};

const SaveStatus = ({ state }: { state: SaveTrack }) => {
  const status = saveStatus(state);

  return (
    <output className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
      {status === "saving" ? "Saving…" : null}
      {status === "saved" ? "Saved" : null}
      {status === "failed" ? (
        <button
          className="text-destructive hit-area relative underline-offset-2 hover:underline"
          onClick={() => {
            for (const retry of Object.values(state.failed)) {
              retry?.();
            }
          }}
          type="button"
        >
          Couldn’t save · Retry
        </button>
      ) : null}
    </output>
  );
};

const SaveScope = ({
  children,
}: {
  children: (status: ReactNode) => ReactNode;
}) => {
  const { save, state } = useSaveScope();

  return (
    <SaveContext value={save}>
      {children(<SaveStatus state={state} />)}
    </SaveContext>
  );
};

export const SettingsHeader = ({
  label,
  parent,
}: {
  label?: string;
  parent?: SettingsParent;
}) => (
  <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
    <SidebarTrigger className="-ml-1" />
    <Separator
      className="mr-1 data-vertical:h-4 data-vertical:self-center"
      orientation="vertical"
    />
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap max-md:flex-col max-md:items-start">
        {parent === undefined ? (
          <BreadcrumbItem className="md:hidden">
            {label === undefined ? (
              <span className="text-foreground text-heading font-medium">
                Settings
              </span>
            ) : (
              <span className="text-xs">Settings</span>
            )}
          </BreadcrumbItem>
        ) : (
          <BreadcrumbItem className="min-w-6 shrink-[100] max-md:max-w-full">
            <BreadcrumbLink
              className="hit-area relative min-w-0"
              render={parent.link}
            >
              <span className="block truncate max-md:text-xs">
                {parent.label}
              </span>
            </BreadcrumbLink>
          </BreadcrumbItem>
        )}
        {label === undefined ? null : (
          <>
            {parent === undefined ? null : (
              <BreadcrumbSeparator className="max-md:hidden" />
            )}
            <BreadcrumbItem className="min-w-12 max-md:-mt-1 max-md:max-w-full">
              <span className="text-foreground max-md:text-heading truncate font-medium">
                {label}
              </span>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  </header>
);

export const SettingsPage = ({
  actions,
  children,
  description,
  leading,
  parent,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  parent?: SettingsParent;
  title: string;
}) => (
  <>
    <SettingsHeader label={title} parent={parent} />
    <div className="settings-controls min-h-0 flex-1 overflow-y-auto">
      <SaveScope>
        {(status) => (
          <div className="mx-auto flex w-full max-w-192 flex-col gap-8 px-4 pt-8 pb-16 md:pt-12">
            <div className="flex flex-col gap-1 px-0.5">
              <div className="flex items-start gap-4">
                {leading}
                <div className="flex min-h-8 min-w-0 flex-1 items-baseline gap-3">
                  <h1 className="min-w-0 truncate text-2xl font-semibold">
                    {title}
                  </h1>
                  {status}
                </div>
                {actions === undefined ? null : (
                  <div className="flex h-8 shrink-0 items-center gap-2">
                    {actions}
                  </div>
                )}
              </div>
              {description === undefined ? null : (
                <p className="text-muted-foreground text-pretty">
                  {description}
                </p>
              )}
            </div>
            {children}
          </div>
        )}
      </SaveScope>
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
}) => {
  const card = (
    <div className={cn(settingsCard, "divide-y px-4")}>{children}</div>
  );

  if (title === undefined) {
    return <section className="flex flex-col gap-3">{card}</section>;
  }

  return (
    <SaveScope>
      {(status) => (
        <section className="flex flex-col gap-3">
          <div className="flex items-end gap-4 px-0.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline gap-3">
                <h2 className="text-prose font-medium">{title}</h2>
                {status}
              </div>
              {description === undefined ? null : (
                <p className="text-muted-foreground text-pretty">
                  {description}
                </p>
              )}
            </div>
            {action}
          </div>
          {card}
        </section>
      )}
    </SaveScope>
  );
};

export const SettingsTable = ({ children }: { children: ReactNode }) => (
  <div className={cn(settingsCard, "p-1")}>{children}</div>
);

export const SettingsRow = ({
  children,
  description,
  htmlFor,
  label,
  stacked = false,
}: {
  children?: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  label: ReactNode;
  stacked?: boolean;
}) => (
  <div
    className={cn(
      "flex min-h-15 flex-wrap items-center gap-x-4 gap-y-2 py-3",
      stacked && "max-sm:flex-col max-sm:items-stretch"
    )}
  >
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

export const SettingsChoice = <Value extends string>({
  items,
  label,
  onChange,
  value,
}: {
  items: readonly { short: string; value: Value }[];
  label: string;
  onChange: (value: Value) => void;
  value: Value;
}) => (
  <fieldset
    aria-label={label}
    className="bg-surface-3 flex rounded-lg p-0.5 max-sm:w-full"
  >
    {items.map((item) => (
      <Button
        aria-pressed={value === item.value}
        className="max-sm:flex-1"
        key={item.value}
        onClick={() => {
          onChange(item.value);
        }}
        size="sm"
        variant={value === item.value ? "default" : "ghost"}
      >
        {item.short}
      </Button>
    ))}
  </fieldset>
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
  const { save } = useSettingsSave();

  const field = useAutosaveText(
    value,
    async (text, retry) => {
      await save(
        id,
        async () => {
          await onSave(text);
        },
        retry
      );
    },
    validate
  );

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
      {invalid ? (
        <p
          className="text-destructive text-xs"
          id={`${id}-problem`}
          role="alert"
        >
          {field.problem}
        </p>
      ) : null}
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
