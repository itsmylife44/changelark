# Changelark for Swift

Shows **What's new** once after every update, in a native SwiftUI sheet, with votes and anonymous comments. iOS 16+, no dependencies.

```swift
import SwiftUI
import Changelark

@main
struct MyApp: App {
    init() {
        Changelark.configure(appKey: "clk_…", baseURL: URL(string: "https://your-changelark.example")!)
    }
    var body: some Scene {
        WindowGroup { ContentView().changelarkWhatsNew() }
    }
}
```

- Add it in Xcode with **File → Add Package Dependencies** and this repository's URL (the manifest is `Package.swift` at the repository root).
- `useAppAttest: true` signs votes and comments with App Attest, for apps that require app proofs. Simulators don't support it.
- `Changelark.showWhatsNew()` opens the sheet for the installed version yourself.

Same rules as the React Native package: first install stays quiet, each new version shows once, older and already-seen versions are skipped. When you reply to someone's comment, their next launch without new notes opens the sheet on the feedback chat, once per reply.

## Tests

```bash
swift test                                              # rules, decoding, rendering
CHANGELARK_TEST_URL=http://127.0.0.1:3000 swift test       # plus a run against a local Changelark server
```
