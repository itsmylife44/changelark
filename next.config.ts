export default {
  images: { unoptimized: true },
  output: "standalone",
  // supabase/config.toml's site_url is 127.0.0.1:3000; without this, `next dev` blocks its own scripts there.
  allowedDevOrigins: ["127.0.0.1"],
};
