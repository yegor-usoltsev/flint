package cli

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const issueJSON = `{"key":"ENG-1","title":"Login","assigneeId":null,"version":3,"createdAt":"2026-11-01T03:00:00.100Z","future":true}`

type seen struct {
	auth, body, method, path, query string
}

func serve(t *testing.T, status int, body string) (*seen, *httptest.Server) {
	t.Helper()
	got := &seen{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		*got = seen{r.Header.Get("Authorization"), string(data), r.Method, r.URL.Path, r.URL.RawQuery}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(server.Close)
	t.Setenv("FLINT_URL", server.URL)
	t.Setenv("FLINT_TOKEN", "secret")
	t.Setenv("FLINT_CONFIG", t.TempDir()+"/none.json")
	return got, server
}

func runCLI(server *httptest.Server, args ...string) (int, string, string) {
	var stdout, stderr bytes.Buffer
	code := run(args, &stdout, &stderr, server.Client())
	return code, stdout.String(), stderr.String()
}

func TestViewPrintsTheServerBody(t *testing.T) {
	got, server := serve(t, 200, issueJSON)
	code, stdout, _ := runCLI(server, "issue", "view", "ENG-1", "--json")
	if code != 0 || stdout != issueJSON+"\n" {
		t.Fatalf("code %d, stdout %q", code, stdout)
	}
	if got.method != "GET" || got.path != "/api/v1/issues/ENG-1" || got.auth != "Bearer secret" {
		t.Fatalf("request %+v", got)
	}
}

func TestUpdateSendsNullOnlyForUnassign(t *testing.T) {
	got, server := serve(t, 200, issueJSON)
	code, _, _ := runCLI(server, "issue", "update", "ENG-1", "-a", "none", "--priority", "high", "--if-version", "3", "--json")
	if code != 0 || got.method != "PATCH" || got.body != `{"assigneeId":null,"priority":2,"version":3}` {
		t.Fatalf("code %d, request %+v", code, got)
	}
	code, _, _ = runCLI(server, "issue", "update", "ENG-1", "-t", "Renamed", "--json")
	if code != 0 || got.body != `{"title":"Renamed"}` {
		t.Fatalf("code %d, request %+v", code, got)
	}
}

func TestConflictKeepsTheErrorBody(t *testing.T) {
	conflict := `{"error":{"code":"conflict","message":"ENG-1 changed since version 2","current":` + issueJSON + `}}`
	_, server := serve(t, 409, conflict)
	code, stdout, _ := runCLI(server, "issue", "update", "ENG-1", "-t", "Late", "--if-version", "2", "--json")
	if code != 1 || stdout != conflict+"\n" {
		t.Fatalf("code %d, stdout %q", code, stdout)
	}
}

func TestListRepeatsQueryParameters(t *testing.T) {
	got, server := serve(t, 200, "[]")
	code, _, _ := runCLI(server, "issue", "list", "-p", "ENG", "-s", "Todo", "-s", "In Progress", "--priority", "high", "--json")
	if code != 0 || got.path != "/api/v1/projects/ENG/issues" || got.query != "priority=high&status=Todo&status=In+Progress" {
		t.Fatalf("code %d, request %+v", code, got)
	}
}

func TestUsageErrors(t *testing.T) {
	_, server := serve(t, 200, issueJSON)
	for _, args := range [][]string{
		{"issue", "update", "ENG-1", "--json"},
		{"issue", "update", "ENG-1", "-t", " ", "--json"},
		{"issue", "update", "ENG-1", "--priority", "huge", "--json"},
		{"issue", "view", "--json"},
		{"issue", "view", "ENG-1", "--nope", "--json"},
	} {
		code, stdout, _ := runCLI(server, args...)
		if code != 2 || !strings.Contains(stdout, `"code":"usage"`) {
			t.Errorf("%v: code %d, stdout %q", args, code, stdout)
		}
	}
}
