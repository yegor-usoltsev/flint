// Command flint-go is a prototype of the Flint CLI in Go (FLN-6).
package main

import (
	"os"

	"github.com/yegor-usoltsev/flint/cli-go/internal/cli"
)

func main() {
	os.Exit(cli.Run(os.Args[1:], os.Stdout, os.Stderr))
}
