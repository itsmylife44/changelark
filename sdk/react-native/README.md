# changelark-react-native

Shows your release notes the first time someone opens a new version of your React Native app, with votes and anonymous comments.

```sh
npm install changelark-react-native @react-native-async-storage/async-storage expo-application
```

The app version is read from your native build: `expo-application` in Expo apps, or `react-native-device-info` in bare React Native (install that one instead). In Expo Go, pass `appVersion` yourself, since Expo Go reports its own version.

```jsx
import { ChangelarkProvider } from "changelark-react-native";

export default function App() {
  return (
    <ChangelarkProvider appKey="clk_…">
      <RootNavigator />
    </ChangelarkProvider>
  );
}
```

- First install records the version and doesn't interrupt anyone.
- Each newer version shows its notes once. Older or already-seen versions are skipped.
- When you reply to someone's comment from the dashboard, their next launch without new notes opens the sheet on the feedback chat, once per reply.
- People must accept the community guidelines before commenting. They can vote, reply, report, block, and delete their own comments.
- `useChangelark().open(release)` reopens the sheet, for example from a "What's new" button in settings.
- `baseUrl` points at your Changelark server (it calls `/api/v1/sdk/...`).

## Is it safe to put the app key in my app?

Yes, because it's a **public** key (it starts with `clk_`). Treat it like a web address, not a password:

- Anyone can read it out of your app, so it gives no special powers. It only picks which app's release notes to load and where anonymous comments and votes go.
- It can't log into the dashboard, read private data, change releases or moderate. Those need your account, which never ships in the app.
- The package refuses keys that don't start with `clk_`, so a secret key can't slip in by accident.
- Someone could copy the key to post spam from a script. Reports and moderation catch that, and the server limits each installation and each network. For stronger protection, turn on App proofs for the app in the dashboard and pass `getAppProof` (Apple App Attest or Google Play Integrity through your own native module): the server then accepts votes and comments only with a valid one-time proof from a genuine copy of your app.
- If a key is abused, make a new one in the **Install** tab and ship an update. The old key stops working.
