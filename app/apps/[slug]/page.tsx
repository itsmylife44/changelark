import { notFound } from "next/navigation";
import { ChangelogPage } from "../../../components/changelog";
import { loadChangelog, summary, langParam } from "../../../lib/public";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const d = await loadChangelog(slug);
  if (!d) return { title: "Not found — Changelark" };
  const title = `${d.app.name} — What's new`;
  const description = summary(d.app.description, `Release notes and feedback for ${d.app.name}, version by version.`);
  return { title, description, alternates: { canonical: `/apps/${slug}`, types: { "application/rss+xml": `/apps/${slug}/feed.xml` } }, openGraph: { title, description, type: "website" } };
}

export default async function Page({ params, searchParams }: Props) {
  const { slug } = await params;
  const lang = langParam((await searchParams).lang);
  const d = await loadChangelog(slug, undefined, lang);
  if (!d) notFound();
  return <ChangelogPage slug={slug} initial={d} lang={lang} />;
}
