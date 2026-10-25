import { writeFile } from "node:fs/promises";

import { Argument, Command, CommanderError, Option } from "commander";

import {
  action,
  call,
  CliError,
  collect,
  integer,
  linkFile,
  parseJson,
  readConfig,
  readText,
  removeConfig,
  request,
  table,
  usageError,
  wantsJson,
  workspaceOf,
  writeConfig,
} from "./client.ts";
import type { Json, Scope } from "./client.ts";
import guide from "./guide.md" with { type: "text" };
import { registerIssues } from "./issues.ts";
import manifest from "./package.json" with { type: "json" };
import { registerTrash } from "./trash.ts";
import { registerWiki } from "./wiki.ts";
import { registerWorkspaceCommands } from "./workspaces.ts";

const footer = `
Context: -p/-w flags, then .flint.json from flint link (searched upward),
then FLINT_WORKSPACE/FLINT_PROJECT, then your only workspace.
Output is JSON when stdout is not a terminal or with --json.
Exit codes: 0 ok, 1 API or runtime error (JSON on stdout when piped, text on stderr otherwise), 2 usage error.
Destructive commands need --yes outside a terminal.
Environment: FLINT_URL, FLINT_TOKEN, FLINT_WORKSPACE, FLINT_PROJECT, FLINT_CONFIG.
Run flint skill for the agent guide.`;

const typed = (value: string): Json =>
  ["true", "false", "null"].includes(value) || /^-?\d+(?:\.\d+)?$/u.test(value)
    ? parseJson(value)
    : value;

const fieldsOf = (fields: [string, boolean][]) => {
  const body: Record<string, Json> = {};

  for (const [field, isTyped] of fields) {
    const separator = field.indexOf("=");

    if (separator < 1) {
      throw usageError(`Field ${field} needs key=value`);
    }

    const value = field.slice(separator + 1);

    body[field.slice(0, separator)] = isTyped ? typed(value) : value;
  }

  return body;
};

const registerAccount = (program: Command) => {
  program
    .command("login")
    .description("Store the Flint URL and an API token (Settings → API keys)")
    .requiredOption(
      "--url <url>",
      "Flint URL, such as https://flint.example.com"
    )
    .requiredOption("--token <token>", "API token")
    .action(
      action(async (options: { token: string; url: string }) => {
        const config = {
          token: options.token,
          url: new URL(options.url).origin,
        };

        const me = await call(config, "GET /me");

        await writeConfig(config);

        return { result: me, text: () => `Logged in as @${me.username}` };
      })
    );

  program
    .command("logout")
    .description("Forget the stored URL and token")
    .action(
      action(async () => {
        await removeConfig();

        return { result: { loggedOut: true }, text: () => "Logged out" };
      })
    );

  program
    .command("whoami")
    .description("Show your user and workspaces")
    .action(
      action(async () => {
        const me = await call(await readConfig(), "GET /me");

        return {
          result: me,
          text: () =>
            [
              `@${me.username} (${me.displayName})`,
              ...me.workspaces.map(({ role, slug }) => `  ${slug} (${role})`),
            ].join("\n"),
        };
      })
    );

  program
    .command("link")
    .description(
      `Write ${linkFile} so commands here default to a workspace and project`
    )
    .requiredOption("-w, --workspace <slug>", "workspace")
    .option("-p, --project <key>", "default project")
    .action(
      action(async (options: Required<Pick<Scope, "workspace">> & Scope) => {
        const config = await readConfig();

        await call(config, "GET /workspaces/:slug", {
          params: { slug: options.workspace },
        });

        if (options.project !== undefined) {
          await workspaceOf(config, options);
        }

        const linked = {
          project: options.project?.toUpperCase(),
          workspace: options.workspace,
        };

        await writeFile(linkFile, `${JSON.stringify(linked, null, 2)}\n`);

        return { result: linked, text: () => `Wrote ${linkFile}` };
      })
    );
};

const registerTools = (program: Command) => {
  program
    .command("search")
    .description("Search issues and wiki pages (full text plus semantic)")
    .argument("<text...>", "what to find")
    .option("-w, --workspace <slug>", "workspace (default: flint link)")
    .option("-p, --project <key>", "use the workspace of this project")
    .addOption(
      new Option("--type <type>", "what to search").choices([
        "all",
        "issues",
        "wiki",
      ])
    )
    .addOption(
      new Option("--mode <mode>", "hybrid adds semantic matches").choices([
        "hybrid",
        "fts",
      ])
    )
    .option("--limit <n>", "results per kind")
    .action(
      action(
        async (
          words: string[],
          options: Scope & {
            limit?: string;
            mode?: "fts" | "hybrid";
            type?: "all" | "issues" | "wiki";
          }
        ) => {
          const config = await readConfig();

          const results = await call(config, "GET /workspaces/:slug/search", {
            params: { slug: await workspaceOf(config, options) },
            query: {
              limit:
                options.limit === undefined
                  ? undefined
                  : integer(options.limit, "--limit"),
              mode: options.mode,
              q: words.join(" "),
              type: options.type,
            },
          });

          return {
            result: results,
            text: () =>
              table(
                [
                  ...results.issues.map((issue) => ({
                    row: [issue.key, issue.title],
                    score: issue.score,
                  })),
                  ...results.pages.map((page) => ({
                    row: [page.path, page.title],
                    score: page.score,
                  })),
                ]
                  .toSorted((a, b) => b.score - a.score)
                  .map(({ row }) => row)
              ),
          };
        }
      )
    );

  program
    .command("api")
    .description("Call any /api/v1 endpoint with your token")
    .argument("<method>", "GET, POST, PUT, PATCH or DELETE")
    .argument("<path>", "path under /api/v1, such as /issues/ENG-12/activity")
    .option(
      "-f, --field <key=value>",
      "string body field (repeatable)",
      collect
    )
    .option(
      "-F, --typed-field <key=value>",
      "number, boolean or null body field (repeatable)",
      collect
    )
    .option("--input <file>", "JSON body from a file, - for stdin")
    .action(
      action(
        async (
          method: string,
          path: string,
          options: { field?: string[]; input?: string; typedField?: string[] }
        ) => {
          const fields: [string, boolean][] = [
            ...(options.field ?? []).map((field): [string, boolean] => [
              field,
              false,
            ]),
            ...(options.typedField ?? []).map((field): [string, boolean] => [
              field,
              true,
            ]),
          ];

          if (fields.length > 0 && options.input !== undefined) {
            throw usageError("Pass fields or --input, not both");
          }

          const body =
            options.input === undefined
              ? undefined
              : parseJson(await readText(options.input));

          return {
            result: await request(
              await readConfig(),
              method,
              path,
              body ?? (fields.length === 0 ? undefined : fieldsOf(fields))
            ),
          };
        }
      )
    );

  program
    .command("skill")
    .description("Print the agent guide")
    .action(
      action(async () => await Promise.resolve({ raw: guide, result: guide }))
    );
};

const completionScripts = {
  bash: `_flint() {
  local IFS=$'\\n'
  COMPREPLY=($(compgen -W "$(flint __complete -- "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null | cut -f1)" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -o default -F _flint flint
`,
  fish: `function __flint_complete
    set -l items (flint __complete -- (commandline -opc)[2..-1] (commandline -ct) 2>/dev/null)
    if test (count $items) -eq 0
        __fish_complete_path (commandline -ct)
    else
        printf '%s\\n' $items
    end
end
complete -c flint -e
complete -c flint -f -a '(__flint_complete)'
`,
  zsh: `#compdef flint
_flint() {
  local -a items
  items=("\${(@f)$(flint __complete -- "\${(@)words[2,CURRENT]}" 2>/dev/null | sed 's/:/\\\\:/g; s/\\t/:/')}")
  if (( \${#items} )) && [[ -n $items[1] ]]; then
    _describe flint items
  else
    _files
  fi
}
compdef _flint flint
`,
};

const findOption = (command: Command, word: string) => {
  for (
    let current: Command | null = command;
    current;
    current = current.parent
  ) {
    const option = current.options.find(
      (candidate) => candidate.long === word || candidate.short === word
    );

    if (option !== undefined) {
      return option;
    }
  }

  return null;
};

export const complete = (program: Command, words: string[]) => {
  const current = words.at(-1) ?? "";
  const before = words.slice(0, -1);
  const help = program.createHelp();
  let command = program;
  let expectsValue: Option | null = null;

  for (const word of before) {
    if (expectsValue !== null) {
      expectsValue = null;
    } else if (word.startsWith("-")) {
      const option = findOption(command, word.split("=")[0] ?? word);

      expectsValue =
        option?.required === true && !word.includes("=") ? option : null;
    } else {
      command =
        command.commands.find(
          (sub) => sub.name() === word || sub.aliases().includes(word)
        ) ?? command;
    }
  }

  if (expectsValue !== null) {
    return expectsValue.argChoices ?? [];
  }

  if (current.startsWith("-")) {
    return [
      ...help.visibleOptions(command),
      ...help.visibleGlobalOptions(command),
    ].flatMap((option) =>
      option.long === undefined ? [] : [`${option.long}\t${option.description}`]
    );
  }

  return help
    .visibleCommands(command)
    .map((sub) => `${sub.name()}\t${sub.summary() || sub.description()}`);
};

const registerCompletion = (program: Command) => {
  program
    .command("completion")
    .description("Print a shell completion script")
    .addArgument(
      new Argument("<shell>", "bash, zsh or fish").choices([
        "bash",
        "zsh",
        "fish",
      ])
    )
    .addHelpText(
      "after",
      `
Load it in your shell profile:
  bash  eval "$(flint completion bash)"
  zsh   source <(flint completion zsh)    (after compinit)
  fish  flint completion fish | source`
    )
    .action(
      action(async (shell: keyof typeof completionScripts) => {
        const script = completionScripts[shell];

        return await Promise.resolve({ raw: script, result: script });
      })
    );

  program
    .command("__complete", { hidden: true })
    .argument("[words...]")
    .action((words: string[]) => {
      for (const item of complete(program, words)) {
        console.log(item);
      }
    });
};

export const createProgram = () => {
  const program = new Command("flint")
    .description("Flint issue tracker and wiki from the command line")
    .version(`${manifest.version} (${process.env.FLINT_COMMIT ?? "dev"})`)
    .option("--json", "print JSON (the default when stdout is not a terminal)")
    .option("--human", "print text even when stdout is not a terminal")
    .exitOverride()
    // oxlint-disable-next-line eslint/no-empty-function -- main prints commander errors itself, as JSON when asked.
    .configureOutput({ outputError: () => {} })
    .addHelpText("after", footer);

  registerAccount(program);
  registerIssues(program);
  registerWiki(program);
  registerTrash(program);
  registerWorkspaceCommands(program);
  registerTools(program);
  registerCompletion(program);

  return program;
};

const synonyms = new Map([
  ["close", ["status Done <keys...>"]],
  ["get", ["view", "get"]],
  ["ls", ["list"]],
  ["new", ["create"]],
  ["open", ["view", "get"]],
  ["remove", ["delete"]],
  ["rm", ["delete"]],
  ["show", ["view", "get"]],
]);

const commandFor = (program: Command, argv: string[], word: string) => {
  let group = program;

  for (const token of argv) {
    if (token === word) {
      return group;
    }

    group =
      group.commands.find(
        (command) =>
          command.name() === token || command.aliases().includes(token)
      ) ?? group;
  }

  return group;
};

const withSynonym = (program: Command, argv: string[], message: string) => {
  const word = /^unknown command '(?<word>[^']+)'$/u.exec(message)?.groups?.[
    "word"
  ];

  if (word === undefined) {
    return message;
  }

  const group = commandFor(program, argv, word);

  const names = new Set(
    group.commands.flatMap((command) => [command.name(), ...command.aliases()])
  );

  const hint = synonyms
    .get(word)
    ?.find((candidate) => names.has(candidate.split(" ")[0] ?? ""));

  return hint === undefined
    ? message
    : `${message}\n(Did you mean ${[group.name(), hint].filter((part) => part !== "flint").join(" ")}?)`;
};

export const main = async (argv: string[]) => {
  const program = createProgram();

  try {
    await program.parseAsync(argv, { from: "user" });

    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      return 0;
    }

    let failure = new CliError(
      error instanceof Error ? error.message : String(error),
      1
    );

    if (error instanceof CliError) {
      failure = error;
    } else if (error instanceof CommanderError) {
      failure = usageError(
        error.code === "commander.help"
          ? "Missing command"
          : withSynonym(program, argv, error.message.replace(/^error: /u, ""))
      );
    }

    if (wantsJson(argv)) {
      console.log(JSON.stringify(failure.body));
    } else {
      console.error(
        failure.exitCode === 2
          ? `${failure.message}\nRun flint --help for usage.`
          : failure.message
      );
    }

    return failure.exitCode;
  }
};
