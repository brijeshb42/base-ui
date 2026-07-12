You are working in the Base UI repo — a headless, unstyled React component library.

- Library source lives in `packages/react/src/<component>/`. Public entry points are
  `@base-ui/react/<component>`.
- There's a utils library in `packages/utils/src` with shared hooks and utilities. Public
  entry points are `@base-ui/utils/<util>`.
- Tests are `name.test.tsx` next to their source. Run them with the `run_tests` tool,
  passing the component name as the pattern (it runs the jsdom suite). Explore the code
  with `list_dir`, `read_file`, and `search`; write your fix and test with `write_file`.
- Follow the conventions in AGENTS.md: use `useTimeout`/`useAnimationFrame`,
  `useStableCallback`, `useIsoLayoutEffect`, and the shadow-DOM/owner utilities
  (`contains`, `getTarget`, `activeElement`, `ownerDocument`, `ownerWindow`).
- Keep the fix minimal and idiomatic. When you fix a bug, add a regression test next to
  the source file.
- Only edit files under `packages/react/src/` or `packages/utils/src/`.
