import Link from "next/link";
import { SiteHeader, SiteFooter, DocsTabs } from "../../components/site";
import { FAQ } from "../../components/faq";

export const metadata = { title: "Docs — Changelark", description: "Set up Changelark: publish release notes, share your changelog and show What's new in your app." };

export default function Docs() {
  return (
    <>
      <SiteHeader current="docs" />
      <DocsTabs current="overview" />
      <main className="docs-body">
        <article className="docs-main">
          <h1>From release notes to replies</h1>
          <p>Changelark keeps your release notes in one place and puts them in two places: a public page per app and a half-height sheet that opens after an update. Users react and write back without signing up, and everything lands in your feedback inbox.</p>

          <h2 id="start">Five steps</h2>
          <ol className="steps">
            <li><strong>Create an account</strong><span>and confirm your email. Or skip this and <Link href="/">open the demo</Link>.</span></li>
            <li><strong>Add an app</strong><span>with a name, and optionally an App Store link and a contact link. Its public page exists right away.</span></li>
            <li><strong>Write a version</strong><span>with its number and notes. Publish now, keep it as a draft, or pick a later date.</span></li>
            <li><strong>Install the package</strong><span>with the key from the <strong>Install</strong> tab: <Link href="/docs/swift">Swift</Link> or <Link href="/docs/react-native">React Native</Link>.</span></li>
            <li><strong>Answer people</strong><span>as reactions, comments and reports arrive live in the inbox.</span></li>
          </ol>

          <h2 id="concepts">How it fits together</h2>
          <dl className="facts">
          <dt id="key">The app key</dt>
          <dd>Each app has a key that starts with <code>clk_</code>. It&apos;s meant to ship inside your app: it loads published notes and posts anonymous feedback, nothing more. It can&apos;t sign in, edit releases or moderate. Replace it anytime in the <strong>Install</strong> tab; the old one stops working at once.</dd>
          <dt id="anonymous">Anonymous installs</dt>
          <dd>The package creates a random ID the first time the app runs and keeps it on the device. Votes, comments and blocks belong to that install. The server stores only a hash of it and shows a generated name like <code>Juniper-4C2F</code>.</dd>
          <dt id="whats-new">When What&apos;s new appears</dt>
          <dd>The first launch records the installed version without showing anything. After an update, the notes for the new version show once. Older versions and versions you&apos;ve already seen are skipped. If the notes aren&apos;t published yet, the package checks again on the next launch.</dd>
          <dt id="bugs">Bug reports</dt>
          <dd>From the sheet, people can send you a private bug report with a screenshot of the screen they were on. Only you see it, in the <strong>Bugs</strong> tab of the inbox. Mark it fixed or delete it.</dd>
          <dt id="languages">Languages</dt>
          <dd>Add translations to any version. The app picks the one matching the phone&apos;s language; the public page shows a language switch. Importing from App Store Connect brings every localization along.</dd>
          <dt id="notifications">Notifications</dt>
          <dd>Paste a Slack, Discord, Telegram or other webhook address in an app&apos;s <strong>Settings</strong>, and every new comment, report and bug report is posted there at once. For Telegram, create a bot with <a href="https://t.me/BotFather">@BotFather</a>, send it a message, find your chat ID at <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code>, then paste <code>https://api.telegram.org/bot&lt;token&gt;/sendMessage?chat_id=&lt;id&gt;</code>. Each app also has an RSS feed of its versions at <code>/apps/&lt;app&gt;/feed.xml</code>.</dd>
          <dt id="moderation">Moderation</dt>
          <dd>People accept short guidelines before their first comment, and can report or block others. In the dashboard you can hide any comment, reply as the developer and dismiss reports.</dd>
          </dl>


          <h2 id="faq">Common questions</h2>
          <div className="faq-list">
            {FAQ.map(([q, ans]) => (
              <details name="faq" key={q}><summary>{q}</summary><p>{ans}</p></details>
            ))}
          </div>

        </article>
      </main>
      <SiteFooter />
    </>
  );
}
