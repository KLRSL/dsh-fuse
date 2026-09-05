# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in dsh-fuse, please report it **privately** before public disclosure:

- Open a [private security advisory](https://github.com/KLRSL/dsh-fuse/security/advisories/new) (preferred), or
- Email the maintainer through your GitHub contact

Please include a description of the vulnerability, steps to reproduce, and affected versions. You should receive a response within 7 days.

Please do **not** open public issues for security vulnerabilities.

## Security Notes

dsh-fuse is a **local-first** design and rendering plugin:

- All rendering and inspection happens **client-side in your browser** — the `dsh-fuse` fence is never sent to any external service.
- The plugin ships **zero production dependencies** (no native modules, no network calls at runtime).
- Browser-side rendering uses a **whitelist** of component types; unknown types are rejected outright.
- Fence content is treated as untrusted markup: the renderer never executes embedded script or fetches remote resources.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ |
