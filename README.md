# MockMorph

Schema-aware mock data for SQL. Paste your `CREATE TABLE` statements and MockMorph streams back ready-to-run `INSERT` statements for **PostgreSQL** or **MySQL**, with foreign keys that point at rows that actually exist.

Table structure (order, primary keys, foreign keys) is worked out **locally** by a SQL parser and a topological sort. An AI model (Groq) is used for one narrow job only: labelling each plain column with a semantic type (email, name, price, ...) so the fake values look sensible.

## Features

- **Local dependency resolution.** Foreign-key relationships are parsed from your SQL and ordered with Kahn's algorithm, so parent tables are always inserted before their children. Foreign keys pointing at missing tables, and cycles between tables in which every foreign key is `NOT NULL`, are rejected before any row is generated. A cycle that a nullable foreign key can break is accepted: that column is generated as `NULL` (its parent is created later) and the analysis reports a warning.
- **Correct foreign keys.** Every table keeps a pool of the primary keys it generated. A foreign key picks its value from the pool of the table its `REFERENCES` clause names, however many tables sit in between.
- **Self-referencing foreign keys.** A table can reference its own primary key (for example `employees.manager_id REFERENCES employees(id)`), with integer or UUID keys, inline or table-level, and any number of such columns per table. A row may only point at a row generated earlier in the same table, so the data is always a valid hierarchy with no cycles. A nullable column gets `NULL` for the first row (a root) and for about a fifth of the rest; a `NOT NULL` column makes the first row reference itself, which PostgreSQL accepts but has not been verified on MySQL.
- **1:1 tables (a primary key that is also a foreign key).** A table like `user_profiles(user_id INT PRIMARY KEY REFERENCES users(id))` gets its keys sampled from the parent's own generated primary keys, so every row is a real parent row and no two rows share one. Chains of these (`a <- b <- c`) work the same way. If the requested row count would exceed the parent's, the table is capped at the parent's row count instead, with a warning explaining why.
- **UNIQUE columns.** A single-column `UNIQUE` constraint (`code INT UNIQUE`, or table-level `UNIQUE (code)`) is enforced, not just parsed: every generated value is guaranteed distinct across the table's rows, for integer, decimal, float, text, date, timestamp, time and UUID columns — text distinctness holds up even after truncation to a declared `VARCHAR(n)`/`CHAR(n)` length. A `UNIQUE` foreign key that is not the table's primary key (`user_id INT UNIQUE REFERENCES users(id)`) samples the parent's keys without replacement, the same as a 1:1 table. If a column's type has too small a value space for the requested row count (`BOOLEAN UNIQUE`, a narrow `VARCHAR(2) UNIQUE`, ...), the table is capped at that value space instead, with a warning explaining why — the same choice already made for 1:1 tables, applied consistently. A composite (multi-column) `UNIQUE` is not enforced; it is reported as a warning instead. Neither is a `UNIQUE` self-referencing foreign key.
- **Integer and UUID primary keys.** Integer keys are sequential; UUID keys are real random UUIDs.
- **Streaming output.** Results stream to the terminal-style UI as they are generated. Copy them or download as `.sql`.
- **AI semantic labels, with overrides.** Analyze a schema once, adjust any column's type in the UI, and reuse that classification without spending another AI call.
- **Generation history.** Signed-in users get a dashboard of past generations, recorded as `completed`, `failed` or `cancelled`.
- **Identifier safety.** Every table and column name is validated against a strict allowlist before it can appear in generated SQL.

## How it works

1. `lib/sql-schema-parser.ts` parses `CREATE TABLE` statements into tables, columns, primary keys and foreign keys.
2. `lib/dependency-resolver.ts` runs Kahn's algorithm over the foreign-key graph to get the generation order.
3. `lib/schema-analysis.ts` combines both, validates identifiers and primary-key support, and asks Groq for column semantic types (unless a cached classification is supplied).
4. `lib/generation-plan.ts` validates the full plan (every foreign key must target a primary key, generated earlier or, for a self-reference, from rows of the same table generated earlier) and then produces the rows.
5. `app/api/generate/route.ts` streams the `INSERT` statements and saves the run to the database.

Steps 1–2 run on every request. The client cannot supply table order, keys or relationships.

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router, Turbopack), React 19, TypeScript
- Tailwind CSS 4, Framer Motion, Three.js / React Three Fiber
- NextAuth v4 with the Prisma adapter (GitHub and Google sign-in)
- Prisma 6 with PostgreSQL
- [Groq](https://groq.com) chat completions API (default model `openai/gpt-oss-120b`)
- Vitest for tests

## Getting started

### Prerequisites

- Node.js **20.9 or newer**
- A PostgreSQL database (a hosted one such as Supabase or Neon works)
- A [Groq API key](https://console.groq.com)
- A GitHub and/or Google OAuth app (see below)

### 1. Install

```bash
git clone https://github.com/sidhant0707/mockmorph.git
cd mockmorph
npm ci
```

### 2. Configure environment variables

Create a `.env` file in the project root. Do not commit it (`.env*` is already in `.gitignore`).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string used by the app |
| `DIRECT_URL` | yes | Direct (non-pooled) connection string, used by Prisma for schema changes |
| `NEXTAUTH_SECRET` | yes | Secret used to sign auth cookies and tokens |
| `NEXTAUTH_URL` | yes in production | Public URL of the app, e.g. `http://localhost:3000` locally |
| `GITHUB_ID`, `GITHUB_SECRET` | for GitHub sign-in | GitHub OAuth app credentials |
| `GOOGLE_ID`, `GOOGLE_SECRET` | for Google sign-in | Google OAuth credentials |
| `GROQ_API_KEY` | yes | Groq API key for semantic classification |
| `GROQ_MODEL` | no | Override the default Groq model without a code change |

If your database provider does not distinguish pooled and direct connections, set `DIRECT_URL` to the same value as `DATABASE_URL`.

### 3. Set up the database

```bash
npx prisma db push
```

This creates the tables (users, sessions, generations, ...). The project does not use migration files, so use `db push` rather than `prisma migrate dev`.

### 4. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### OAuth callback URLs

Sign-in only works from URLs registered on your OAuth app. The callback path is:

- GitHub: `<your-origin>/api/auth/callback/github`
- Google: `<your-origin>/api/auth/callback/google`

A GitHub OAuth app holds a single callback URL, so use a separate OAuth app for local development (callback `http://localhost:3000/api/auth/callback/github`) and put its credentials in `.env.local`, which overrides `.env` and is also git-ignored.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run lint` | Lint with ESLint |
| `npm test` | Run the unit tests (Vitest) |

## API

Both endpoints require a signed-in session cookie. There are no API keys, so they are meant to be called from the app's own UI, not from scripts.

### `POST /api/analyze`

Parses the schema locally, then asks Groq for column semantic types.

```json
{ "rawSchema": "CREATE TABLE users (...); CREATE TABLE orders (...);" }
```

Returns `{ topology, tables, warnings, remaining }`, where `topology` is the locally computed insert order, `tables` maps each table to its column types, and `remaining` is your remaining AI calls this hour.

### `POST /api/generate`

Streams `INSERT` statements as plain text.

```json
{
  "rawSchema": "CREATE TABLE users (...); ...",
  "config": { "rowCount": 50, "dialect": "postgres" },
  "cachedColumnTypes": { "users": { "email": "email" } }
}
```

- `dialect` is `postgres` (default) or `mysql`.
- `rowCount` is clamped to 1–10,000 (default 50). The UI slider covers 10–500.
- `cachedColumnTypes` is optional. Send the `tables` object from a previous `/api/analyze` call to skip the AI call.

### Limits

- Schemas are limited to 50,000 characters.
- AI calls are limited to **5 per hour per user**, shared by `/api/analyze` and by `/api/generate` when it has to call Groq itself (no `cachedColumnTypes`). Schemas that can never be generated (cycles of `NOT NULL` foreign keys, missing tables, unsupported keys) are rejected before any AI call or quota use.
- Row distribution: every table except the last one in dependency order gets 15 rows; the last table gets the remainder of the requested total (at least 1). With many tables the total can exceed the requested count.

## Supported SQL

Supported:

- `CREATE TABLE [IF NOT EXISTS] name (...)`
- Column-level `PRIMARY KEY`, `REFERENCES table(col)`, `NOT NULL`, `UNIQUE`, `DEFAULT`
- Table-level `PRIMARY KEY (col)` and `FOREIGN KEY (col) REFERENCES table(col)`
- Single-column `UNIQUE`, column-level or table-level (`UNIQUE (col)`) — enforced during generation, see Features above
- Foreign keys that reference the table's own primary key (self-references)
- Integer primary keys (`INT`, `INTEGER`, `SMALLINT`, `BIGINT`, `SERIAL`, `BIGSERIAL`, `SMALLSERIAL`) and `UUID` primary keys
- Quoted identifiers (`"name"`, `` `name` ``)

Not supported yet:

- Composite (multi-column) primary, foreign, or `UNIQUE` keys
- Primary keys of other types (e.g. `TEXT`, `VARCHAR`)
- Foreign keys that reference a column other than the parent's primary key
- A `UNIQUE` self-referencing foreign key (parsed and reported with a warning, not enforced)
- A `UNIQUE` column of an unsupported kind — `json`/`array`/unrecognized types (parsed and reported with a warning, not enforced)
- `ALTER TABLE ... ADD CONSTRAINT`, `CREATE INDEX` and `CHECK` constraints (skipped with a warning)

## Known limitations

These are open issues rather than design choices:

- **Plain integer columns** (such as `quantity` or `stock`) are filled with string placeholders, because the semantic type list has no integer type. Those `INSERT`s will fail on a typed integer column.
- **Generated values are templated.** Emails, names and companies come from fixed patterns, not a realistic data library. Values do not consider `CHECK` constraints or enum types.
- The generate UI shows the HTTP status code, not the server's error message, when a request is rejected.

## Project structure

```
app/
  api/analyze/        POST /api/analyze
  api/generate/       POST /api/generate (streaming)
  api/auth/           NextAuth handler
  dashboard/          generation history
  login/              OAuth sign-in page
components/           landing page, terminal UI, navigation
lib/
  sql-schema-parser.ts     CREATE TABLE -> tables / PKs / FKs
  dependency-resolver.ts   Kahn's algorithm
  schema-analysis.ts       parse + validate + Groq classification
  generation-plan.ts       plan validation and row generation
  identifier-safety.ts     identifier allowlist and quoting
  rate-limit.ts            shared AI-call quota
  groq.ts                  Groq client and response validation
  __tests__/               Vitest unit tests
prisma/schema.prisma       database schema
```

## Testing

```bash
npm test
```

The suite covers the SQL parser, dependency resolver (including cycles and diamond graphs), identifier safety, schema analysis, generation planning (including foreign-key integrity across multi-parent and deep chains and self-referencing keys) and the rate limiter. The Prisma, session and Groq boundaries are mocked, and the Groq API is never called. The end-to-end tests call the real `POST /api/generate` handler and run the SQL it streams in a real PostgreSQL engine (PGlite, in-process), so no external database is needed; generated MySQL output is not executed against a MySQL server.

## Deployment

The app is set up for [Vercel](https://vercel.com).

1. Add all environment variables from the table above in the project settings, and set `NEXTAUTH_URL` to your production URL.
2. Register `<production-url>/api/auth/callback/github` (and `.../google`) on your OAuth apps.
3. Run `npx prisma db push` against your production database before the first deploy, and again whenever `prisma/schema.prisma` changes.

## License

No license has been specified yet.