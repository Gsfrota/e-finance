# Synkra AIOS Development Rules for Claude Code

You are working with Synkra AIOS, an AI-Orchestrated System for Full Stack Development. 
**CRITICAL:** Always verify context and constraints before proposing changes.

## 🛠 Core Commands (Claude Code Auto-Discovery)
- **Build:** `npm run build`
- **Test:** `npm test`
- **Lint:** `npm run lint`
- **Typecheck:** `npm run typecheck`
- **Dev Server:** `npm run dev`

## 🗺️ Context & Navigation (Graphify First)
**CRITICAL TOKEN-SAVING RULE:** This project relies on Graphify (`safishamsi/graphify`) as its structural memory. 
Do NOT blindly run `ls`, `find`, or `grep` across the project tree.

### 1. Discovery (Pre-Execution)
- **Consult the Map:** Always read `graphify-out/GRAPH_REPORT.md` FIRST to understand structural dependencies and identify God Nodes (e.g., `db()`, `handleMessage()`, `dispatchIntent()`).
- **Invoke Skill:** If active querying is needed, use the `/graphify` skill tool automatically before any other exploratory action.

### 2. The Mandatory Gate (Post-Implementation)
All structural and logical changes must follow this strict sequence:
1. Verify BR (Business Rules).
2. Implement code changes.
3. **Run Update:** Execute `/graphify . --update`.
4. **Regenerate Vault:** Ensure the Python script regenerates the Obsidian vault inside `graphify-out/obsidian/` to keep the structural memory consistent.

## Core Framework Understanding
Synkra AIOS is a meta-framework orchestrating AI agents for complex workflows. 
**Rule:** Always recognize and work within this 4-layer architecture. Do not bypass the Agent System.
## Constitution
AIOS has a formal Constitution (`.aios-core/constitution.md`) with non-negotiable principles. Automatic gates block violations.

| Article | Principle | Severity |
| :--- | :--- | :--- |
| I | CLI First | NON-NEGOTIABLE |
| II | Agent Authority | NON-NEGOTIABLE |
| III | Story-Driven Development | MUST |
| IV | No Invention | MUST |
| V | Quality First | MUST |
| VI | Absolute Imports | SHOULD |
## Agent System (Delegation & Activation)
Activate agents using `@agent-name` or `/AIOS:agents:agent-name`. When an agent is active, strictly follow its persona, expertise, and workflow patterns.

| Agent | Persona | Primary Scope |
| :--- | :--- | :--- |
| `@dev` | Dex | Code implementation & logic |
| `@qa` | Quinn | Testing, quality assurance |
| `@architect` | Aria | Architecture & technical design |
| `@pm` | Morgan | Product Management |
| `@po` | Pax | Product Owner (Stories/Epics) |
| `@sm` | River | Scrum Master |
| `@analyst` | Alex | Research & analysis |
| `@data-engineer` | Dara | Database design & optimization |
| `@ux-design-expert` | Uma | UX/UI design patterns |
| `@devops` | Gage | CI/CD, git push (EXCLUSIVE RIGHTS) |

**Agent Commands (Prefix `*`):**
- `*help` - Show available commands
- `*create-story` - Create development story
- `*task {name}` - Execute specific task
- `*exit` - Exit agent mode
## Development Methodology

### 1. Story-Driven Development (Strict)
- **Start here:** All dev starts with a story in `docs/stories/`.
- **Track:** Mark checkboxes as `[x]` ONLY when fully tested and implemented. Maintain the File List section.
- **Criteria:** Implement exactly what the Acceptance Criteria specify. *No unauthorized scope creep.*

### 2. Code Standards & Testing
- Run tests (`npm test`), linter (`npm run lint`), and typecheck (`npm run typecheck`) **before** marking tasks complete.
- Do not ask for permission to fix linting errors; fix them automatically.

## Framework vs Project Boundary
AIOS uses a 4-layer model (L1-L4) protected by deterministic deny rules in `.claude/settings.json`.

| Layer | Mutability | Target Paths | Notes |
| :--- | :--- | :--- | :--- |
| **L1: Core** | NEVER modify | `.aios-core/core/`, `constitution.md`, `bin/aios.js` | Protected by deny rules |
| **L2: Templates**| NEVER modify | `.aios-core/development/`, `.aios-core/infrastructure/`| Extend-only |
| **L3: Config** | Mutable | `.aios-core/data/`, `agents/*/MEMORY.md`, `core-config.yaml` | Allowed with caution |
| **L4: Runtime** | ALWAYS modify| `docs/stories/`, `packages/`, `squads/`, `tests/` | Standard project work |
## Contextual Rules System
AIOS loads rules from `.claude/rules/`. Read these files automatically when working in related domains:
- `agent-authority.md`: Delegation and exclusive operations.
- `mcp-usage.md`: MCP server priority.
- `e-finance-dev-workflow.md`: **E-Finance Specific** - Requires BR Gate (@po), strict DB/multi-tenant gates.
## Code Intelligence
- **Code Intel:** Always use `isCodeIntelAvailable()` before operations. It gracefully degrades if disabled.
## 🤖 Claude Code Specific Behavior
fa
### 1. Tool Usage & Token Economy
- **Always consult Graphify (`graphify-out/GRAPH_REPORT.md`) before exploring the codebase.**
- Prefer batched tool calls.
- Use Claude's native `Grep` tool only when you have already narrowed down the search area via Graphify.
- Prefer targeted replaces over rewriting whole files.

### 2. Session Context
- Always update the active story `[ ]` to `[x]` immediately after task success.
- Save state/commit atomically (`feat: description [Story ID]`) before long-running tasks.

### 3. Error Recovery
- If a step fails, do not halt silently. Propose a rollback or a fix, and explain the context.