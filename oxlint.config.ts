import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import tanstack from "ultracite/oxlint/tanstack";
import tanstackJsPlugins from "ultracite/oxlint/tanstack/js-plugins";

const jsPlugins = selectJsPlugins(["github", "sonarjs", "react-doctor"]);

export default defineConfig({
  extends: [
    core,
    react,
    tanstack,
    tanstackJsPlugins,
    antiSlop,
    jsPlugins,
    shadcn,
  ],
  ignorePatterns: core.ignorePatterns,
  jsPlugins: [...jsPlugins.jsPlugins, ...(shadcn.jsPlugins ?? [])],
  options: { reportUnusedDisableDirectives: "error", typeAware: true },
  overrides: [
    {
      // shadcn components are upstream registry code updated through the
      // shadcn CLI, so they keep the registry's idioms. These are the rules
      // that code breaks; every other rule still applies.
      files: ["src/components/ui/**"],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
        "func-style": "off",
        "github/a11y-aria-label-is-well-formatted": "off",
        "github/a11y-no-title-attribute": "off",
        "import/consistent-type-specifier-style": "off",
        "jsx-a11y/click-events-have-key-events": "off",
        "jsx-a11y/label-has-associated-control": "off",
        "jsx-a11y/no-noninteractive-element-interactions": "off",
        "jsx-a11y/prefer-tag-over-role": "off",
        "no-eq-null": "off",
        "no-negated-condition": "off",
        "no-param-reassign": "off",
        "no-shadow": "off",
        "no-unused-expressions": "off",
        "no-use-before-define": "off",
        eqeqeq: "off",
        complexity: "off",
        "react-doctor/js-combine-iterations": "off",
        "react-doctor/no-array-index-as-key": "off",
        "react-doctor/only-export-components": "off",
        "react-doctor/prefer-dynamic-import": "off",
        "react-doctor/rerender-memo-before-early-return": "off",
        "react-hooks/exhaustive-deps": "off",
        "react/button-has-type": "off",
        "react/function-component-definition": "off",
        "react/hook-use-state": "off",
        "react/jsx-no-constructed-context-values": "off",
        "react/no-danger": "off",
        "react/no-object-type-as-default-prop": "off",
        "react/no-unstable-nested-components": "off",
        "react/todo": "off",
        "shadcn/no-inline-styles": "off",
        "sonarjs/expression-complexity": "off",
        "sonarjs/function-name": "off",
        "sonarjs/max-union-size": "off",
        "sonarjs/no-wildcard-import": "off",
        "sonarjs/pseudo-random": "off",
        "typescript/consistent-return": "off",
        "typescript/no-confusing-void-expression": "off",
        "typescript/no-deprecated": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "typescript/prefer-nullish-coalescing": "off",
        "typescript/promise-function-async": "off",
        "typescript/restrict-template-expressions": "off",
        "typescript/strict-boolean-expressions": "off",
        "unicorn/no-document-cookie": "off",
      },
    },
    {
      // react-doctor checks scripts/ and cli/ only when the checkout path
      // contains a src/ segment, as CI checkouts often do. Migrations,
      // the demo and CLI uploads await in order on purpose.
      files: ["cli/**", "scripts/**"],
      rules: {
        "react-doctor/async-await-in-loop": "off",
        "react-doctor/server-sequential-independent-await": "off",
      },
    },
  ],
  settings: jsPluginSettings,
});
