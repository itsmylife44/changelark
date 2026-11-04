# Contributing

Thanks for looking. Changelark is maintained by one person, so small, focused changes get merged fastest.

## Where to talk

- **Bugs and feature ideas:** [GitHub Issues](https://github.com/itsmylife44/changelark/issues). Search first, then open one.
- **Security problems:** never in public. See [SECURITY.md](SECURITY.md).
- **Before a big change** (new feature, schema change, new dependency): open an issue first, so we agree on the shape before you write the code.

## Run it locally

Follow [Run it locally](README.md#run-it-locally) in the README. You need Node, Docker (for the local Supabase stack), and Xcode if you touch the Swift package.

## Before you open a pull request

Run the checks from the [Checks](README.md#checks) section of the README against a local build:

```sh
npm run check:backend -- http://127.0.0.1:3000
npm run check:ui -- http://127.0.0.1:3000
npm run check:proofs -- http://127.0.0.1:3000
swift test
```

If you changed the schema, add a new migration in `supabase/migrations/`, then run `npx supabase gen types typescript --local` and `npx supabase db reset`.

Design decisions and the reasons behind them are in [docs/DECISIONS.md](docs/DECISIONS.md). If your change reverses one of them, say so in the pull request.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), like the rest of the project.
