# Flint CLI

Command-line client for [Flint](https://github.com/yegor-usoltsev/flint), a self-hosted issue tracker and wiki. It does everything the web UI does and prints JSON when piped, for scripts and coding agents. It is a single file with no dependencies, for Node 22.12+ or Bun.

```sh
npm install -g @yusoltsev/flint-cli
flint login --url https://flint.example.com   # asks for a key (Settings → API keys) or reads stdin
flint link -w acme -p ENG                     # this directory now defaults to acme/ENG
flint issue create -t "Fix login redirect" -s Todo -a @me
flint issue status "In Review" ENG-12
flint wiki get guides/setup --raw
flint attachment download <id>                # media keeps its name, other files save as flint-<name>.download
```

`flint --help` lists commands, exit codes and environment variables. `flint skill` prints the guide for coding agents, and `npx skills add yegor-usoltsev/flint` installs a skill that points them to it. For shell completion, run `eval "$(flint completion bash)"`, `source <(flint completion zsh)` or `flint completion fish | source`.
