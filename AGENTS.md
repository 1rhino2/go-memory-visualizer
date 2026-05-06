# Agents

## Cursor Cloud specific instructions

This is a VS Code extension (Go Memory Layout Visualizer) built with TypeScript. It has zero runtime dependencies and no external services (no databases, Docker, etc.).

### Quick reference

- **Install deps:** `npm install`
- **Compile:** `npm run compile`
- **Lint:** `npm run lint`
- **Watch mode:** `npm run watch`

Full dev setup and architecture details are in `DEVELOPMENT.md`.

### Gotchas

- Node.js 20.x is required. The VM does not ship with Node pre-installed; the nodesource `setup_20.x` APT repo is configured so `apt-get install -y nodejs` works.
- There are no test source files (`src/test/`) in the repo despite `DEVELOPMENT.md` referencing `out/test/*.test.js`. The core modules (`goParser`, `memoryCalculator`, `optimizer`) can be tested directly with Node.js since they do not depend on the `vscode` module.
- `extension.ts` is the only file that imports `vscode`; everything else is pure TypeScript and can be `require()`d from Node.js after compilation.
- ESLint reports 1 pre-existing error (`no-case-declarations` in `memoryCalculator.ts`). This is not a regression.
- The `package.json` has no `test` script. To exercise the core logic, compile first then run the compiled JS modules directly, e.g. `node -e "const { GoParser } = require('./out/goParser'); ..."`.
