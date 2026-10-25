# Flint CLI

Command-line client for [Flint](https://github.com/yegor-usoltsev/flint), a self-hosted issue tracker and wiki. It does everything the web UI does and prints JSON when piped, so coding agents can use it. One file without dependencies; runs on Node 22.12+ and Bun.

```sh
npm install -g @yusoltsev/flint-cli
```

Create an API key in Flint under **Settings → API keys**, then:

```sh
flint login --url https://flint.example.com --token <key>
flint link -w acme -p ENG     # writes .flint.json, so commands here need no -w or -p
flint issue list -a @me
flint issue create -t "Fix login redirect" -s Todo --priority high -a @me
flint issue status "In Review" ENG-12
flint comment add ENG-12 -F notes.md
flint search "rate limit"
flint wiki get guides/setup --raw
```

`flint --help` lists the command groups and `flint <group> <command> --help` each command's flags. Exit code 1 means the request or a local step failed, 2 a usage error; errors go to stderr as text, or to stdout as JSON with `--json` or when piped.

**Agents.** `flint skill` prints the agent guide for the installed version; `npx skills add yegor-usoltsev/flint` installs a skill that points agents at it.

**Completion.** `eval "$(flint completion bash)"`, `source <(flint completion zsh)` or `flint completion fish | source`.
