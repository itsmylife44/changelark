// The public address of this Changelark instance, for sitemaps, canonical links and social previews.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

// Where Xcode fetches the Swift package: this project's public git repository.
export const SWIFT_PACKAGE_URL = process.env.NEXT_PUBLIC_SWIFT_PACKAGE_URL || "https://github.com/itsmylife44/changelark";

// The project's public repository (the Swift package is fetched from it too).
export const REPO_URL = SWIFT_PACKAGE_URL;
