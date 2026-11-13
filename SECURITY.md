# Security policy

## Supported versions

Security fixes go into the newest release. Please update before reporting, and
check whether the problem is still there.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Use GitHub's private
reporting instead: on the repository's **Security** tab, choose **Report a
vulnerability**. Include what you found, the steps to reproduce it, the version and
platform, and what an attacker could do with it.

You can expect an acknowledgement within a week. We will keep you informed while it
is fixed and credit you in the release notes, unless you would rather not be named.

## What counts

FormCel runs on your own machine, so the things that matter most are the ways
something outside it could get in:

- **The engine** binds to loopback (127.0.0.1, port 8199) and refuses cross-site
  requests. Anything that makes it reachable from another machine, or lets a web page
  drive it, without the person turning that on.
- **The share listener** for other computers (off by default, port 8200): reaching a
  workbook without its share link, doing more with a link than it allows, or reaching
  anything it should not expose.
- **Scripts in a workbook** (Python cells, scripts and macros) run with no access to
  your files or network. Anything that gets past that.
- **Agents**: running a command through `/mcp` or `./formcel cli` before the person has
  allowed outside agents, running the window-only terminal and Claude Code commands
  from any agent, or reusing the token the engine gives its own Claude Code tabs.
- **Keys and tokens** kept by the engine (AI provider and market data keys, the API
  token): anything that leaks them.
- **Files**: opening or importing a workbook, CSV or PDF in a way that runs code or
  writes outside where it should.

Bugs that need someone to already control your machine, or to run a modified build
of FormCel, are ordinary bugs: please open an issue for those.
