# Domain Context Map

This map defines the boundaries of the contexts in this repository and points to their respective domain glossaries.

## Contexts

- **Core Runtime (`packages/core`)**:
  - Boundary: Declares routes, router, registry, validation, and types. Runs inside the user's application at runtime.
  - Glossary: [packages/core/CONTEXT.md](./packages/core/CONTEXT.md)
  - Decisions: [packages/core/docs/adr/](./packages/core/docs/adr/)
- **CLI & Generation (`packages/cli`)**:
  - Boundary: Resolves entries, builds documentations, and emits Spec/Docs/SDK. Runs as a developer command-line tool.
  - Glossary: [packages/cli/CONTEXT.md](./packages/cli/CONTEXT.md)
  - Decisions: [packages/cli/docs/adr/](./packages/cli/docs/adr/)
- **Examples & Integration (`examples/api`)**:
  - Boundary: Sample Express application demonstrating the usage of `sdkgen` and serving as end-to-end integration tests.
  - Glossary: [examples/api/CONTEXT.md](./examples/api/CONTEXT.md)
