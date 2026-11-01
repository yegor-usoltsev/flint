// Package cli implements the flint-go commands on top of the generated API client.
package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/oapi-codegen/nullable"
	"github.com/spf13/cobra"

	"github.com/yegor-usoltsev/flint/cli-go/internal/api"
)

type failure struct {
	body     any
	exitCode int
	message  string
}

func (f *failure) Error() string { return f.message }

func errorBody(code, message string) map[string]any {
	return map[string]any{"error": map[string]string{"code": code, "message": message}}
}

func usageError(message string) *failure {
	return &failure{body: errorBody("usage", message), exitCode: 2, message: message}
}

type config struct {
	Token string `json:"token"`
	URL   string `json:"url"`
}

func configPath() string {
	if path := os.Getenv("FLINT_CONFIG"); path != "" {
		return path
	}
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "flint", "config.json")
}

func readConfig() (config, error) {
	var saved config
	if data, err := os.ReadFile(configPath()); err == nil {
		if err := json.Unmarshal(data, &saved); err != nil {
			return config{}, &failure{body: errorBody("cli_error", err.Error()), exitCode: 1, message: err.Error()}
		}
	}
	if token := os.Getenv("FLINT_TOKEN"); token != "" {
		saved.Token = token
	}
	if url := os.Getenv("FLINT_URL"); url != "" {
		saved.URL = url
	}
	if saved.Token == "" || saved.URL == "" {
		message := "Run flint login --url <url> --token <token>"
		return config{}, &failure{body: errorBody("not_logged_in", message), exitCode: 1, message: "Not logged in: " + message}
	}
	return saved, nil
}

func newClient(httpClient api.HttpRequestDoer) (*api.ClientWithResponses, error) {
	cfg, err := readConfig()
	if err != nil {
		return nil, err
	}
	bearer := func(_ context.Context, req *http.Request) error {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
		return nil
	}
	return api.NewClientWithResponses(
		strings.TrimRight(cfg.URL, "/")+"/api/v1",
		api.WithHTTPClient(httpClient),
		api.WithRequestEditorFn(bearer),
	)
}

// answer turns a response into the CLI result: the body as the server sent it,
// so output matches the TypeScript CLI byte for byte and keeps unknown fields.
func answer(status int, body []byte) (json.RawMessage, error) {
	if status >= 200 && status < 300 {
		return json.RawMessage(bytes.TrimSpace(body)), nil
	}
	var envelope api.ApiError
	if json.Unmarshal(body, &envelope) == nil && envelope.Error.Message != "" {
		return nil, &failure{body: json.RawMessage(bytes.TrimSpace(body)), exitCode: 1, message: envelope.Error.Message}
	}
	message := fmt.Sprintf("HTTP %d", status)
	return nil, &failure{body: errorBody("http_error", message), exitCode: 1, message: message}
}

var priorityNames = []string{"none", "urgent", "high", "medium", "low"}

func parsePriority(value string) (api.Priority, error) {
	if index := slices.Index(priorityNames, strings.ToLower(value)); index >= 0 {
		return index, nil
	}
	if number, err := strconv.Atoi(value); err == nil && number >= 0 && number <= 4 {
		return number, nil
	}
	return 0, usageError(fmt.Sprintf("Unknown priority %s: use %s or 0-4", value, strings.Join(priorityNames, ", ")))
}

func parseAssignee(value string) (nullable.Nullable[api.Uuid], error) {
	if value == "none" {
		return nullable.NewNullNullable[api.Uuid](), nil
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return nil, usageError("The prototype takes -a none or a user id; usernames need GET /workspaces/{slug}/members")
	}
	return nullable.NewNullableWithValue(id), nil
}

type updateFlags struct {
	assignee  string
	ifVersion int
	priority  string
	title     string
}

func (f updateFlags) changes(cmd *cobra.Command) (api.UpdateIssue, error) {
	var changes api.UpdateIssue
	flags := cmd.Flags()
	if !slices.ContainsFunc([]string{"title", "priority", "assignee"}, flags.Changed) {
		return changes, usageError("Pass something to change, such as -t, --priority or -a")
	}
	if flags.Changed("title") {
		if strings.TrimSpace(f.title) == "" {
			return changes, usageError("The title must not be empty")
		}
		changes.Title = &f.title
	}
	if flags.Changed("priority") {
		priority, err := parsePriority(f.priority)
		if err != nil {
			return changes, err
		}
		changes.Priority = &priority
	}
	if flags.Changed("assignee") {
		assignee, err := parseAssignee(f.assignee)
		if err != nil {
			return changes, err
		}
		changes.AssigneeId = assignee
	}
	if flags.Changed("if-version") {
		version := int32(f.ifVersion)
		changes.Version = &version
	}
	return changes, nil
}

type listFlags struct {
	assignee []string
	closed   bool
	label    []string
	limit    int
	offset   int
	priority []string
	project  string
	query    string
	status   []string
}

func (f listFlags) params(cmd *cobra.Command) *api.ListProjectIssuesParams {
	flags := cmd.Flags()
	params := &api.ListProjectIssuesParams{}
	optional := func(name string, values []string) *[]string {
		if !flags.Changed(name) {
			return nil
		}
		return &values
	}
	params.Assignee = optional("assignee", f.assignee)
	params.Label = optional("label", f.label)
	params.Priority = optional("priority", f.priority)
	params.Status = optional("status", f.status)
	if f.closed {
		params.Closed = &f.closed
	}
	if flags.Changed("limit") {
		limit := int32(f.limit)
		params.Limit = &limit
	}
	if flags.Changed("offset") {
		offset := int32(f.offset)
		params.Offset = &offset
	}
	if f.query != "" {
		params.Q = &f.query
	}
	return params
}

func usageArgs(check cobra.PositionalArgs) cobra.PositionalArgs {
	return func(cmd *cobra.Command, args []string) error {
		if err := check(cmd, args); err != nil {
			return usageError(err.Error())
		}
		return nil
	}
}

func newProgram(httpClient api.HttpRequestDoer, result *json.RawMessage) *cobra.Command {
	program := &cobra.Command{
		Use:           "flint-go",
		Short:         "Prototype Flint CLI generated from api/openapi.yaml",
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	program.SetFlagErrorFunc(func(_ *cobra.Command, err error) error { return usageError(err.Error()) })
	program.PersistentFlags().Bool("json", false, "print JSON (the default when stdout is not a terminal)")
	program.PersistentFlags().Bool("human", false, "print for people even when stdout is not a terminal")

	issue := &cobra.Command{Use: "issue", Short: "Work with issues"}
	program.AddCommand(issue)

	issue.AddCommand(&cobra.Command{
		Use:   "view <key>",
		Short: "Show an issue",
		Args:  usageArgs(cobra.ExactArgs(1)),
		RunE: func(cmd *cobra.Command, args []string) error {
			client, err := newClient(httpClient)
			if err != nil {
				return err
			}
			response, err := client.GetIssueWithResponse(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			*result, err = answer(response.StatusCode(), response.Body)
			return err
		},
	})

	var update updateFlags
	updateCommand := &cobra.Command{
		Use:     "update <key>",
		Aliases: []string{"edit"},
		Short:   "Change an issue",
		Args:    usageArgs(cobra.ExactArgs(1)),
		RunE: func(cmd *cobra.Command, args []string) error {
			changes, err := update.changes(cmd)
			if err != nil {
				return err
			}
			client, err := newClient(httpClient)
			if err != nil {
				return err
			}
			response, err := client.UpdateIssueWithResponse(cmd.Context(), args[0], changes)
			if err != nil {
				return err
			}
			*result, err = answer(response.StatusCode(), response.Body)
			return err
		},
	}
	updateCommand.Flags().StringVarP(&update.title, "title", "t", "", "title")
	updateCommand.Flags().StringVar(&update.priority, "priority", "", "none|urgent|high|medium|low or 0-4")
	updateCommand.Flags().StringVarP(&update.assignee, "assignee", "a", "", "none or a user id")
	updateCommand.Flags().IntVar(&update.ifVersion, "if-version", 0, "fail with conflict unless the issue is still at this version")
	issue.AddCommand(updateCommand)

	var list listFlags
	listCommand := &cobra.Command{
		Use:   "list",
		Short: "List a project's issues",
		Args:  usageArgs(cobra.NoArgs),
		RunE: func(cmd *cobra.Command, _ []string) error {
			if list.project == "" {
				return usageError("Pass -p <KEY>")
			}
			client, err := newClient(httpClient)
			if err != nil {
				return err
			}
			response, err := client.ListProjectIssuesWithResponse(cmd.Context(), list.project, list.params(cmd))
			if err != nil {
				return err
			}
			*result, err = answer(response.StatusCode(), response.Body)
			return err
		},
	}
	listCommand.Flags().StringVarP(&list.project, "project", "p", "", "project key")
	listCommand.Flags().StringArrayVarP(&list.status, "status", "s", nil, "status name (repeatable)")
	listCommand.Flags().StringArrayVarP(&list.assignee, "assignee", "a", nil, "none or a username (repeatable)")
	listCommand.Flags().StringArrayVarP(&list.label, "label", "l", nil, "label name (repeatable)")
	listCommand.Flags().StringArrayVar(&list.priority, "priority", nil, "none|urgent|high|medium|low or 0-4 (repeatable)")
	listCommand.Flags().StringVarP(&list.query, "query", "q", "", "title text, an exact key or full-text search")
	listCommand.Flags().BoolVar(&list.closed, "closed", false, "list completed and canceled issues")
	listCommand.Flags().IntVar(&list.limit, "limit", 0, "page size with --closed")
	listCommand.Flags().IntVar(&list.offset, "offset", 0, "page offset with --closed")
	issue.AddCommand(listCommand)

	return program
}

func wantsJSON(args []string, stdout io.Writer) bool {
	if slices.Contains(args, "--json") {
		return true
	}
	if slices.Contains(args, "--human") {
		return false
	}
	file, ok := stdout.(*os.File)
	if !ok {
		return true
	}
	info, err := file.Stat()
	return err != nil || info.Mode()&os.ModeCharDevice == 0
}

// Run executes the CLI and returns the process exit code.
func Run(args []string, stdout, stderr io.Writer) int {
	return run(args, stdout, stderr, http.DefaultClient)
}

func run(args []string, stdout, stderr io.Writer, httpClient api.HttpRequestDoer) int {
	var result json.RawMessage
	program := newProgram(httpClient, &result)
	program.SetArgs(args)
	program.SetOut(stdout)
	program.SetErr(stderr)
	asJSON := wantsJSON(args, stdout)

	err := program.Execute()
	if err == nil {
		if result == nil {
			return 0
		}
		if !asJSON {
			var pretty bytes.Buffer
			if json.Indent(&pretty, result, "", "  ") == nil {
				result = pretty.Bytes()
			}
		}
		fmt.Fprintln(stdout, string(result))
		return 0
	}

	var known *failure
	if !errors.As(err, &known) {
		known = &failure{body: errorBody("cli_error", err.Error()), exitCode: 1, message: err.Error()}
		if strings.HasPrefix(err.Error(), "unknown command") {
			known = usageError(err.Error())
		}
	}
	if asJSON {
		encoded, _ := json.Marshal(known.body)
		fmt.Fprintln(stdout, string(encoded))
	} else if known.exitCode == 2 {
		fmt.Fprintf(stderr, "%s\nRun flint-go --help for usage.\n", known.message)
	} else {
		fmt.Fprintln(stderr, known.message)
	}
	return known.exitCode
}
