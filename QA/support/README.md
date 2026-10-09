# Routine test safety

Use the checked-in `npm run test:*` commands, not a Node command loading
`.env.local`. `npm test` is the fast offline runner-safety and ops check.

| Command | Owned services |
| --- | --- |
| `npm run test:canary` | Disposable Redis; provider transports injected by the suite |
| `npm run test:state-machine` | Disposable PostgreSQL, direct-process assertions |
| `npm run test:agency-reports` | Disposable PostgreSQL with canonical security migrations |
| `npm run test:auth` | Disposable PostgreSQL/Redis and real route-handler HTTP adapter |
| `npm run test:approval-links` | Same owned HTTP fixture |
| `npm run test:admin-notifications` | Same owned HTTP fixture, synthetic accounts |
| `npm run test:budget-stop` | Disposable PostgreSQL/Redis, sequential test processes |
| `npm run test:deploy-contract` | Sterile shell environment; synthetic deployment inputs |
| `npm run test:ops` | Dependency-injected offline tests |

The app's Run workflow starts only the app. Test workflows are explicit actions;
they do not connect to the app preview or launch GitHub pushes.

## Adding tests

- Offline: `bash QA/support/run-offline.sh -- tests/path.test.ts`.
- Database: `bash QA/support/with-isolated-database.sh -- tests/path.test.ts`.
- Add `--with-redis` for queues or `--http` for HTTP suites.
- Add `--direct` for existing single-process suites where Node 20 test IPC is
  unreliable. Assertions and exit codes still determine success.
- Pass explicit files, never runtime flags, environment files, or arbitrary commands.
- Inject provider/email/publishing transports. Blocked outbound calls are errors,
  not a reason to add public hosts to the allowlist.
- HTTP fixtures execute actual route handlers, not canned auth/admin responses.
  Do not add bypasses for MFA, tenant authorization, or credit checks.

The runners discard the caller's environment and use temporary HOME directories,
synthetic credentials, and preloaded socket/fetch restrictions inherited by Node
children. The PostgreSQL harness composes schema and security controls only in
its new cluster. Production migration commands are not changed.

PostgreSQL uses 55481, harness Redis 16389, HTTP 15481, and the canary's owned Redis
16379. Run database suites sequentially: an occupied fixture port fails rather
than reusing or stopping its owner. Missing HTTP configuration fails explicitly;
`localhost:5000` is never an HTTP test fallback. Cleanup stops only owned
processes and removes their temporary directories, including after test failures.

These are accidental-access safeguards for trusted tests, not an OS sandbox for
untrusted code. Do not add shell commands that contact providers or load credential
files; the Node preload cannot police arbitrary native executables.