import { notFound } from "next/navigation";
import { ReleasePage } from "../../../../components/changelog";
import { loadChangelog, summary, langParam } from "../../../../lib/public";

type Props = { params: Promise<{ slug: string; version: string }>; searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug, version } = await params;
  const v = decodeURIComponent(version);
  const d = await loadChangelog(slug, v);
  const r = d?.releases.find((x) => x.version === v);
  if (!d || !r) return { title: "Not found — Changelark" };
  const title = `${d.app.name} ${r.version} — What's new`;
  const description = summary(r.notes, `What changed in ${d.app.name} ${r.version}.`);
  return { title, description, alternates: { canonical: `/apps/${slug}/${r.version}` }, openGraph: { title, description, type: "article" } };
}

export default async function Page({ params, searchParams }: Props) {
  const { slug, version } = await params;
  const lang = langParam((await searchParams).lang);
  const v = decodeURIComponent(version);
  const d = await loadChangelog(slug, v, lang);
  if (!d) notFound();
  return <ReleasePage slug={slug} version={v} initial={d} lang={lang} />;
}
