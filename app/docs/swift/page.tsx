import { SiteHeader, SiteFooter, DocsTabs } from "../../../components/site";
import { CopyCode } from "../../../components/widgets";
import { SWIFT_PACKAGE_URL } from "../../../lib/site-url";

export const metadata = { title: "Changelark for Swift — Docs", description: "Show What's new after every update, with votes and anonymous comments, in SwiftUI apps." };

const SETUP = `import SwiftUI
import Changelark

@main
struct MyApp: App {
    init() {
        Changelark.configure(
            appKey: "clk_…",                              // the Install tab in the dashboard
            baseURL: URL(string: "https://your-changelark.example")!
        )
    }

    var body: some Scene {
        WindowGroup {
            ContentView().changelarkWhatsNew()
        }
    }
}`;

const ATTEST = `Changelark.configure(
    appKey: "clk_…",
    baseURL: URL(string: "https://your-changelark.example")!,
    useAppAttest: true
)`;

const MANUAL = `Button("What's new") {
    Task { await Changelark.showWhatsNew() }
}`;

export default function SwiftDocs() {
  return (
    <>
      <SiteHeader current="docs" />
      <DocsTabs current="swift" />
      <main className="docs-body">
        <article className="docs-main">
          <h1>Changelark for Swift</h1>
          <p>A native SwiftUI sheet that shows What&apos;s new once after every update, with votes and anonymous comments. iOS 16 or later, no other dependencies.</p>

          <h2 id="install">Install</h2>
          <p>In Xcode, choose <strong>File → Add Package Dependencies</strong>, enter the repository URL and add the <code>Changelark</code> library to your app target:</p>
          <CopyCode code={SWIFT_PACKAGE_URL} />

          <h2 id="setup">Configure and attach</h2>
          <p>Configure once at launch with the public key from the <strong>Install</strong> tab and your Changelark server&apos;s address, then add <code>.changelarkWhatsNew()</code> to the root view. The version comes from <code>CFBundleShortVersionString</code>.</p>
          <CopyCode code={SETUP} />

          <h2 id="rules">When the sheet appears</h2>
          <ol>
            <li><strong>First install:</strong> the version is recorded quietly. Pass <code>treatFirstLaunchAsUpdate: true</code> to show it anyway.</li>
            <li><strong>New version:</strong> its notes show once, the first time the app opens.</li>
            <li><strong>Seen or older version:</strong> skipped.</li>
            <li><strong>Notes not published yet:</strong> it checks again on the next launch, for up to three days.</li>
            <li><strong>You replied to someone:</strong> on their next launch without new notes, the sheet opens on the feedback chat so they see your answer. Once per reply.</li>
          </ol>
          <p>To open it yourself, for example from a settings row:</p>
          <CopyCode code={MANUAL} />

          <h2 id="community">Votes and comments</h2>
          <p>People vote on the update and on comments without an account, accept short guidelines before their first comment, and can reply, report, block someone or delete their own comment. Your replies from the dashboard carry a Developer badge.</p>

          <h2 id="bugs">Bug reports</h2>
          <p>Under the reactions there&apos;s a <strong>Report a bug</strong> link. It opens a short form and attaches a screenshot of the screen behind the sheet, so you see what the person saw. They can turn the screenshot off. Reports are private: they land in the <strong>Bugs</strong> tab of your inbox and nowhere else. To send one from your own screen, call <code>client.reportBug(text:screenshot:device:)</code>.</p>

          <h2 id="languages">Languages</h2>
          <p>The package sends the phone&apos;s preferred language. If you added a translation for it in the dashboard (or App Store Connect imported one), the sheet shows that; otherwise your original notes.</p>

          <h2 id="app-attest">App Attest</h2>
          <p>To accept votes and comments only from genuine copies of your app, turn on <strong>App proofs</strong> for the app in the dashboard (with your Team ID and bundle ID), add the App Attest capability in Xcode, and configure the package with <code>useAppAttest: true</code>. The package creates and attests its key once, then signs every write. Simulators don&apos;t support App Attest, so test it on a device.</p>
          <CopyCode code={ATTEST} />

        </article>
      </main>
      <SiteFooter />
    </>
  );
}
