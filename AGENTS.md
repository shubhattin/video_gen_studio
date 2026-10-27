# General

- Always use bun package manager. (use bunx instead npx)
- This is a tanstack start project. With convex for backend, queries, mutations and databases
- Never start dev server on your own.
- Never commit to github on your own.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

# Remote / harness

- Never add `Co-authored-by` / `Made by <harness>` lines to commits or PRs, ever.
- Node/npm are preinstalled; bun often isn't — reuse bun if present, else npm/npx.
- Skip Convex backend setup in remote envs; validate with `check`, `lint`, `test` instead.
- If harness supports `.worktreeinclude`, use it; else symlink each listed file from main checkout into worktree.
