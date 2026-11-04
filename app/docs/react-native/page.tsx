import { SiteHeader, SiteFooter, DocsTabs } from "../../../components/site";
import { CopyCode } from "../../../components/widgets";

export const metadata = { title: "Changelark for React Native", description: "Show What's new with votes and comments in React Native apps." };

const APP = `import { ChangelarkProvider } from "changelark-react-native";

export default function App() {
  return (
    <ChangelarkProvider appKey="clk_…">
      <RootNavigator />
    </ChangelarkProvider>
  );
}`;

const SHOT = `import { captureRef } from "react-native-view-shot";

const root = useRef(null);

<ChangelarkProvider
  appKey="clk_…"
  captureScreenshot={() => captureRef(root, { format: "jpg", quality: 0.6, result: "base64" })}
>
  <View ref={root} collapsable={false} style={{ flex: 1 }}>
    <RootNavigator />
  </View>
</ChangelarkProvider>`;

const PROOF = `<ChangelarkProvider
  appKey="clk_…"
  getAppProof={async (challenge, { attest }) => {
    // From your App Attest / Play Integrity native module (not part of this package).
    if (Platform.OS === "android") {
      return { kind: "play", token: await PlayIntegrity.requestToken({ nonce: challenge }) };
    }
    const clientDataHash = sha256(challenge);
    return attest
      ? { kind: "apple", keyId, attestation: await AppAttest.attestKey(keyId, clientDataHash) }
      : { kind: "apple", keyId, assertion: await AppAttest.generateAssertion(keyId, clientDataHash) };
  }}
>`;

const BUTTON = `import { useChangelark } from "changelark-react-native";

function WhatsNewButton({ release }) {
  const { open } = useChangelark();
  return <Button title="What's new" onPress={() => open(release)} />;
}`;

export default function ReactNativeDocs() {
  return (
    <>
      <SiteHeader current="docs" />
      <DocsTabs current="react-native" />
      <main className="docs-body">
        <article className="docs-main">
          <h1>Changelark for React Native</h1>
          <p>Show What&apos;s new after every update, with votes and anonymous comments, in React Native apps on iOS and Android. It works with Expo and bare React Native.</p>

          <h2 id="install">Install</h2>
          <CopyCode code="npm install changelark-react-native @react-native-async-storage/async-storage expo-application" />
          <p>The app version is read from your native build, so you never type it. <code>expo-application</code> does that in Expo apps; in bare React Native, install <code>react-native-device-info</code> instead. In Expo Go, pass <code>appVersion</code> yourself, since Expo Go reports its own version.</p>
          <p>No npm access? <a href="/sdk/changelark-react-native-0.1.0.tgz" download>Download the package</a> and run <code>npm install ./changelark-react-native-0.1.0.tgz</code>.</p>

          <h2 id="setup">Wrap your app</h2>
          <p>Add the provider once, around your navigation. Use the public app key from the <strong>Install</strong> tab in the dashboard.</p>
          <CopyCode code={APP} />

          <h2 id="rules">When the sheet appears</h2>
          <ol>
            <li><strong>First install:</strong> the version is recorded quietly. Nobody is interrupted.</li>
            <li><strong>New version:</strong> its notes show once, the first time the app opens.</li>
            <li><strong>Seen or older version:</strong> skipped.</li>
            <li><strong>Notes not published yet:</strong> it waits and tries again on the next launch (up to 3 days).</li>
            <li><strong>You replied to someone:</strong> on their next launch without new notes, the sheet opens on the feedback chat so they see your answer. Once per reply.</li>
          </ol>
          <p>Set <code>treatFirstLaunchAsUpdate</code> to show the notes on first install too. The sheet follows the phone&apos;s light or dark appearance; in Expo, set <code>&quot;userInterfaceStyle&quot;: &quot;automatic&quot;</code> in <code>app.json</code>, because the default template locks apps to light.</p>

          <h2 id="community">Votes and comments</h2>
          <p>People vote on the update and on comments without an account. They accept the community guidelines once before commenting, and can reply, report, block someone, or delete their own comment. You reply as the developer from the dashboard.</p>

          <h2 id="bugs">Bug reports</h2>
          <p>Under the reactions there&apos;s a <strong>Report a bug</strong> link with a short private form. Reports land in the <strong>Bugs</strong> tab of your inbox. To attach a screenshot of your app, pass <code>captureScreenshot</code>; with <a href="https://github.com/gre/react-native-view-shot">react-native-view-shot</a> it&apos;s one line:</p>
          <CopyCode code={SHOT} />
          <p>Without it, reports are text only. You can also show the form in your own screen with <code>&lt;BugReport onBack={"{…}"} /&gt;</code>, or send one with <code>client.reportBug({"{ text, screenshot }"})</code>.</p>

          <h2 id="languages">Languages</h2>
          <p>The package sends the phone&apos;s language. If you added a translation for it in the dashboard, the sheet shows that; otherwise your original notes.</p>

          <h2 id="key">Is the app key safe to ship?</h2>
          <p>Yes. It&apos;s a <strong>public</strong> key (it starts with <code>clk_</code>), so think of it as a web address, not a password. Anyone can read it out of your app, and that&apos;s fine: it only picks which app&apos;s notes to load and where anonymous comments and votes go. It can&apos;t log into the dashboard, change releases, see private data or moderate.</p>
          <ul>
            <li>The package refuses any key that doesn&apos;t start with <code>clk_</code>, so a secret key can&apos;t slip in by mistake.</li>
            <li>Spam from a copied key is caught by reports and moderation, and the server allows each installation five comments a minute and each network thirty.</li>
            <li>For the strongest protection, turn on <strong>App proofs</strong> for the app in the dashboard and pass <code>getAppProof</code>. Every vote and comment then needs an Apple App Attest assertion or a Google Play Integrity token, checked by the server, so only genuine copies of your app can post. The public web page becomes read-only for that app.</li>
            <li>If a key is abused, choose <strong>Make a new key</strong> in the Install tab and ship an update.</li>
          </ul>
          <CopyCode code={PROOF} />

          <h3>Open it yourself</h3>
          <CopyCode code={BUTTON} />

        </article>
      </main>
      <SiteFooter />
    </>
  );
}
