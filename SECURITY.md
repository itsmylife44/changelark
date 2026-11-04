# Security policy

## Reporting a vulnerability

Please don't open a public issue, discussion or comment for a security problem.

Report it privately instead: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/itsmylife44/changelark/security/advisories/new)). Only the maintainer can see the report.

Include what you found, how to reproduce it, and which version or commit you tested.

## What happens next

- I'll reply within 3 days to confirm I got the report.
- I'll fix it on a private branch and publish a GitHub security advisory with the release that fixes it.
- If you want, the advisory credits you by name.

Changelark is maintained by one person, so these are honest targets, not an SLA.

## Supported versions

Changelark is experimental (0.x). Only the latest release on `main` gets security fixes.

## Scope

In scope: the Changelark server in this repository, the Swift package in `sdk/swift` and the React Native package in `sdk/react-native`.

Out of scope: Supabase itself, and problems that need access to your own server or your Supabase secret key.
