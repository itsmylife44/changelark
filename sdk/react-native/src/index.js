// Changelark for React Native: shows "What's new" once per update, with reactions, a feedback chat and private bug reports.
const React = require("react");
const { Modal, View, Text, Pressable, ScrollView, TextInput, Alert, StyleSheet, ActivityIndicator, Platform, Image, useColorScheme, Animated, Easing, Keyboard, LayoutAnimation, Dimensions } = require("react-native");
const AsyncStorage = require("@react-native-async-storage/async-storage").default;
const { createClient } = require("./client");
const decider = require("./decider");

const h = React.createElement;
const { useState, useEffect, useContext, useMemo, useCallback, useRef, createContext } = React;
const STATE_KEY = "changelark:state";
const ANON_KEY = "changelark:anon";
const HIDDEN_NOTICE = "This comment has been hidden because it violated the community guidelines.";
const Ctx = createContext(null);

function randomId() {
  let s = "";
  for (let i = 0; i < 24; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
  return s;
}

async function loadJSON(key, fallback) {
  try { const v = await AsyncStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

// The version in the app's own native build ("Version" in Xcode, versionName on Android), so nobody keeps it in sync by hand.
// Uses whichever common library the app already has; Metro treats requires inside try/catch as optional.
function installedVersion() {
  try { const v = require("expo-application").nativeApplicationVersion; if (v) return v; } catch {}
  try { const m = require("react-native-device-info"); const v = (m.default || m).getVersion(); if (v) return v; } catch {}
  return null;
}

// The phone's language, so notes come back translated when the developer added that language.
const deviceLocale = () => { try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return undefined; } };

// captureScreenshot (optional): async () => base64 PNG/JPEG of your app, e.g. captureRef from react-native-view-shot.
function ChangelarkProvider({ appKey, appVersion: versionProp, baseUrl = "https://changelark.example", treatFirstLaunchAsUpdate = false, getAppProof, captureScreenshot, children }) {
  const appVersion = useMemo(() => {
    const v = versionProp || installedVersion();
    // Loud for the developer, but never a crash in someone's production app.
    if (!v) console.error("Changelark: can't read the app version. Install expo-application (Expo) or react-native-device-info, or pass appVersion.");
    return v;
  }, [versionProp]);
  const [client, setClient] = useState(null);
  const [release, setRelease] = useState(null);
  const [visible, setVisible] = useState(false);
  // Set when the sheet opens on the chat because the developer replied; holds the server time to save once it's on screen.
  const [replies, setReplies] = useState(null);

  useEffect(() => {
    if (!appVersion) return;
    let cancelled = false;
    (async () => {
      let anonId = await AsyncStorage.getItem(ANON_KEY);
      if (!anonId) { anonId = randomId(); await AsyncStorage.setItem(ANON_KEY, anonId); }
      const c = createClient({ baseUrl, appKey, anonId, appVersion, getAppProof, locale: deviceLocale() });
      if (cancelled) return;
      setClient(c);
      const state = await loadJSON(STATE_KEY, decider.emptyState());
      const first = decider.prepare(appVersion, state, { treatFirstLaunchAsUpdate });
      await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
      const show = (r, repliesAt = null) => { if (!cancelled) { setReplies(repliesAt); setRelease(r); setVisible(true); } };
      try {
        if (first.decision === "fetch") {
          const res = await c.whatsNew(appVersion);
          const next = decider.resolve(appVersion, res.state, state);
          await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
          if (next.decision === "show") return show(res.release);
        }
        // No What's new this launch: reopen the chat if the developer answered this person.
        const r = await c.newReplies(state.repliesCheckedAt);
        const answered = r.count > 0 && r.version ? await c.whatsNew(r.version) : null;
        if (answered?.release) return show(answered.release, r.checkedAt);
        state.repliesCheckedAt = r.checkedAt;
        await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
      } catch {
        // Offline or server error: try again on the next launch.
      }
    })();
    return () => { cancelled = true; };
  }, [appKey, appVersion, baseUrl, treatFirstLaunchAsUpdate]);

  // Remember what was shown only once the sheet was actually on screen.
  const onShow = useCallback(async () => {
    const state = await loadJSON(STATE_KEY, decider.emptyState());
    if (replies) state.repliesCheckedAt = replies;
    else decider.markPresented(appVersion, state);
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  }, [appVersion, replies]);

  const value = useMemo(() => ({
    client, appVersion, release, captureScreenshot,
    open: (r) => { if (r) setRelease(r); setReplies(null); setVisible(true); },
    close: () => setVisible(false),
  }), [client, appVersion, release, captureScreenshot]);

  return h(Ctx.Provider, { value },
    children,
    release && h(WhatsNewSheet, { key: `${release.id}:${!!replies}`, visible, release, startInChat: !!replies, onShow, onClose: () => setVisible(false) }),
  );
}

function useChangelark() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChangelark must be used inside <ChangelarkProvider>");
  return v;
}

// "Intro\n\n- a\n- b" → paragraphs and a bullet list (same rule as the web).
function splitNotes(notes) {
  const lines = String(notes || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const isBullet = (l) => /^[-•*]\s+/.test(l);
  return { text: lines.filter((l) => !isBullet(l)), bullets: lines.filter(isBullet).map((l) => l.replace(/^[-•*]\s+/, "")) };
}

// Optimistic vote: update at once, roll back if the server says no.
function useVote(client, targetType, id, initial) {
  const [v, setV] = useState(initial);
  const press = async (dir) => {
    const before = v;
    const next = decider.toggleVote(v, dir);
    setV(next);
    try {
      const r = await client.vote(targetType, id, next.mine);
      setV({ up: r.upCount, down: r.downCount, mine: r.myVote });
    } catch { setV(before); }
  };
  return [v, press];
}

const shortDate = (d) => new Date(d + (String(d).length === 10 ? "T12:00:00Z" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Half-height sheet: the notes, two big reactions, and a way into the feedback chat.
function WhatsNewSheet({ visible, release, startInChat = false, onShow, onClose }) {
  const s = useStyles();
  const { client, appVersion } = useChangelark();
  const [view, setView] = useState(startInChat ? "chat" : "notes"); // "notes" | "chat" | "bug"
  const chat = view !== "notes";
  const [v, vote] = useVote(client, "release", release.id, { up: release.upCount, down: release.downCount, mine: release.myVote });
  const badge = decider.badge(release.version, appVersion, release.version);
  const { text, bullets } = splitNotes(release.notes);
  // One animated value drives both: the backdrop fades while the sheet slides, in and out.
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    shown.setValue(0);
    // No bounce, like the system sheet: a bounce would lift the sheet off the bottom edge.
    Animated.spring(shown, { toValue: 1, damping: 26, stiffness: 240, overshootClamping: true, useNativeDriver: true }).start();
  }, [visible, shown]);
  const dismiss = () => Animated.timing(shown, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onClose());
  const translateY = shown.interpolate({ inputRange: [0, 1], outputRange: [Dimensions.get("window").height, 0] });
  // iOS doesn't make room for the keyboard (Android's adjustResize does). KeyboardAvoidingView can't help here:
  // it measures itself against its parent, not the screen, so inside the sheet it never sees the keyboard.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const move = (e, height) => { LayoutAnimation.configureNext({ duration: e.duration || 250, update: { type: LayoutAnimation.Types.keyboard } }); setKeyboard(height); };
    const show = Keyboard.addListener("keyboardWillShow", (e) => move(e, e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", (e) => move(e, 0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return h(Modal, { visible, transparent: true, animationType: "none", statusBarTranslucent: true, onShow, onRequestClose: dismiss },
    h(View, { style: { flex: 1 } },
      h(Animated.View, { style: [StyleSheet.absoluteFill, s.backdrop, { opacity: shown }] }),
      h(Pressable, { style: { flex: 1 }, onPress: dismiss, accessibilityLabel: "Close", accessibilityRole: "button" }),
      h(Animated.View, { style: [s.sheet, chat && s.sheetFull, { transform: [{ translateY }] }] },
        // The keyboard covers the sheet's own 32pt bottom padding; the room above it keeps the sheet's colour.
        h(View, { style: [s.sheetBody, chat && { flex: 1 }, keyboard > 0 && { paddingBottom: keyboard - 24 }] },
        h(View, { style: s.grabber }),
        view === "chat" ? h(FeedbackChat, { version: release.version, onBack: () => setView("notes"), onClose: dismiss })
          : view === "bug" ? h(BugReport, { onBack: () => setView("notes") })
          : h(ScrollView, { contentContainerStyle: { gap: 14, paddingBottom: 8 } },
              h(View, { style: s.titleRow },
                h(Text, { style: s.title, accessibilityRole: "header" }, "New in " + release.version),
                h(View, { style: s.row },
                  badge && h(Text, { style: s.badge }, badge.toUpperCase()),
                  h(Text, { style: s.date }, shortDate(release.date)))),
              text.map((t, i) => h(Text, { key: "t" + i, style: s.intro }, t)),
              bullets.length > 0 && h(View, { style: { gap: 8 } }, bullets.map((b, i) =>
                h(View, { key: "b" + i, style: s.bulletRow }, h(View, { style: s.bulletDot }), h(Text, { style: s.bulletText }, b)))),
              h(View, { style: s.reactRow },
                h(Pressable, { style: [s.react, v.mine === 1 && s.reactOn], onPress: () => vote(1), accessibilityRole: "button", accessibilityState: { selected: v.mine === 1 }, accessibilityLabel: `Love it, ${v.up}` },
                  h(Text, { style: s.reactText }, "👍 Love it  "), h(Text, { style: s.count }, String(v.up))),
                h(Pressable, { style: [s.react, v.mine === -1 && s.reactOn], onPress: () => vote(-1), accessibilityRole: "button", accessibilityState: { selected: v.mine === -1 }, accessibilityLabel: `Not for me, ${v.down}` },
                  h(Text, { style: s.reactText }, "👎 Not for me  "), h(Text, { style: s.count }, String(v.down)))),
              h(Pressable, { style: s.feedback, onPress: () => setView("chat"), accessibilityRole: "button" },
                h(Text, { style: [s.reactText, { flex: 1 }] }, "Leave feedback"),
                h(Text, { style: s.count }, String(release.commentCount)),
                h(Text, { style: s.chevron }, "  ›")),
              h(Pressable, { style: s.primary, onPress: dismiss, accessibilityRole: "button" }, h(Text, { style: s.primaryText }, "Got it")),
              h(Pressable, { onPress: () => setView("bug"), accessibilityRole: "button", style: { alignSelf: "center", padding: 6 } },
                h(Text, { style: s.muted }, "🐞 Report a bug")))))));
}

// A private note to the developer, with an optional screenshot of the app.
function BugReport({ onBack }) {
  const s = useStyles();
  const { client, captureScreenshot } = useChangelark();
  const [text, setText] = useState("");
  const [shot, setShot] = useState(null);
  const [attach, setAttach] = useState(true);
  const [state, setState] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState("");
  useEffect(() => { if (captureScreenshot) captureScreenshot().then((b64) => setShot(b64 || null)).catch(() => {}); }, [captureScreenshot]);
  const send = async () => {
    setState("sending"); setError("");
    try {
      await client.reportBug({ text: text.trim(), screenshot: attach ? shot : null, device: `${Platform.OS} ${Platform.Version}` });
      setState("sent");
    } catch (e) { setError(e.message); setState("idle"); }
  };
  return h(View, { style: { flex: 1, gap: 12 } },
    h(View, { style: s.titleRow },
      h(Pressable, { onPress: onBack, accessibilityRole: "button" }, h(Text, { style: s.link }, "‹ Back")),
      h(Text, { style: s.chatTitle, accessibilityRole: "header" }, "Report a bug"),
      h(View, { style: { width: 40 } })),
    state === "sent"
      ? h(Text, { style: [s.intro, { textAlign: "center", paddingVertical: 24 }] }, "Thanks! The developer got your report.")
      : h(ScrollView, { contentContainerStyle: { gap: 12 } },
          h(Text, { style: s.muted }, "Only the developer sees this. It isn't posted publicly."),
          h(TextInput, { value: text, onChangeText: setText, multiline: true, placeholder: "What went wrong? What did you expect?", placeholderTextColor: s.empty.color, style: [s.input, s.bugInput], maxLength: 2000, accessibilityLabel: "Describe the bug" }),
          shot && attach && h(View, { style: { gap: 6 } },
            h(Text, { style: s.muted }, "Screenshot of the screen you were on"),
            h(View, null,
              h(Image, { source: { uri: shot.startsWith("data:") ? shot : `data:image/png;base64,${shot}` }, style: s.shot, resizeMode: "contain", accessibilityLabel: "Screenshot preview" }),
              h(Pressable, { style: s.shotRemove, onPress: () => setAttach(false), hitSlop: 8, accessibilityLabel: "Remove screenshot", accessibilityRole: "button" },
                h(Text, { style: s.shotRemoveText }, "✕"))),
            h(Text, { style: s.note }, "Check it doesn't show anything private before you send it.")),
          shot && !attach && h(Pressable, { onPress: () => setAttach(true), accessibilityRole: "button" }, h(Text, { style: s.link }, "+ Attach the screenshot")),
          error ? h(Text, { style: s.error }, error) : null,
          h(Pressable, { style: [s.primary, (!text.trim() || state === "sending") && { opacity: 0.4 }], disabled: !text.trim() || state === "sending", onPress: send, accessibilityRole: "button" },
            h(Text, { style: s.primaryText }, state === "sending" ? "Sending…" : "Send report"))));
}

// A comment with its replies indented under it, behind a thread line.
function Thread({ c, onReply, onChanged }) {
  const s = useStyles();
  return h(View, { style: { gap: 10 } },
    h(CommentRow, { c, onReply, onChanged }),
    c.replies?.length > 0 && h(View, { style: s.replies }, c.replies.map((r) => h(CommentRow, { key: r.id, c: r, onReply, onChanged }))));
}

function CommentRow({ c, onReply, onChanged }) {
  const s = useStyles();
  const { client } = useChangelark();
  const [v, vote] = useVote(client, "comment", c.id, { up: c.upCount, down: c.downCount, mine: c.myVote });
  const removed = c.removed || c.status === "hidden" || c.status === "deleted";
  const dev = c.author.kind === "developer";
  const more = () => {
    const actions = c.author.isMe
      ? [{ text: "Delete comment", style: "destructive", onPress: () => client.deleteComment(c.id).then(onChanged) }]
      : [
          { text: "Report", style: "destructive", onPress: () => client.report(c.id).then(onChanged) },
          ...(dev ? [] : [{ text: "Block this person", onPress: () => client.block(c.id).then(onChanged) }]),
        ];
    Alert.alert("Comment", undefined, [...actions, { text: "Cancel", style: "cancel" }]);
  };
  return h(View, { style: [s.comment, dev && s.commentDev] },
    h(View, { style: s.row },
      h(Text, { style: s.who }, c.author.isMe ? "You" : c.author.name || "Anonymous"),
      dev && h(Text, { style: s.badge }, "DEVELOPER")),
    h(Text, { style: removed ? s.removed : s.body }, c.deletedByAuthor ? "Deleted by its author." : removed ? HIDDEN_NOTICE : c.body),
    !removed && h(View, { style: s.commentActions },
      h(Pressable, { onPress: () => vote(1), hitSlop: 8, accessibilityRole: "button", accessibilityLabel: `Like, ${v.up}`, accessibilityState: { selected: v.mine === 1 } }, h(Text, { style: [s.action, v.mine === 1 && s.actionOn] }, (v.mine === 1 ? "♥ " : "♡ ") + v.up)),
      !c.parentId && h(Pressable, { onPress: () => onReply(c), hitSlop: 8, accessibilityRole: "button", accessibilityLabel: "Reply" }, h(Text, { style: s.action }, "↩︎")),
      h(Pressable, { onPress: more, accessibilityLabel: "More", accessibilityRole: "button" }, h(Text, { style: s.action }, "···"))));
}

function FeedbackChat({ version, onBack, onClose }) {
  const s = useStyles();
  const { client } = useChangelark();
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [error, setError] = useState("");
  // Like any chat, the newest message sits at the bottom: jump there after loading or sending, not after loading older ones.
  const list = useRef(null);
  const stickToEnd = useRef(true);
  const load = useCallback(() => { stickToEnd.current = true; return client.comments(version).then((p) => { setItems(p.items); setCursor(p.nextCursor); }).catch((e) => setError(e.message)); }, [client, version]);
  const more = () => { stickToEnd.current = false; client.comments(version, cursor).then((p) => { setItems((prev) => [...p.items, ...(prev || [])]); setCursor(p.nextCursor); }).catch((e) => setError(e.message)); };
  useEffect(() => { load(); client.config().then((c) => setAccepted(!!c.me?.guidelinesAccepted)).catch(() => {}); }, [load, client]);

  const send = async () => {
    if (!text.trim()) return;
    try { await client.addComment(version, text.trim(), replyTo?.id); setText(""); setReplyTo(null); load(); }
    catch (e) { setError(e.message); }
  };

  const total = items ? items.reduce((n, c) => n + 1 + (c.replies?.length || 0), 0) : null;
  return h(View, { style: { flex: 1, gap: 12 } },
    h(View, { style: s.titleRow },
      h(Pressable, { onPress: onBack, accessibilityRole: "button", style: s.headerSide }, h(Text, { style: s.link }, "‹ " + version)),
      h(Text, { style: s.chatTitle, accessibilityRole: "header" }, total == null ? "Feedback" : `${total} ${total === 1 ? "comment" : "comments"}`),
      onClose
        ? h(Pressable, { onPress: onClose, accessibilityRole: "button", style: [s.headerSide, { alignItems: "flex-end" }] }, h(Text, { style: s.link }, "Close"))
        : h(View, { style: s.headerSide })),
    error ? h(Text, { style: s.error }, error) : null,
    h(ScrollView, {
      ref: list, style: { flex: 1 }, contentContainerStyle: { gap: 18 }, keyboardShouldPersistTaps: "handled", keyboardDismissMode: "interactive",
      onContentSizeChange: () => { if (stickToEnd.current) list.current?.scrollToEnd({ animated: false }); },
    },
      cursor ? h(Pressable, { onPress: more, accessibilityRole: "button" }, h(Text, { style: [s.link, { textAlign: "center" }] }, "Load earlier comments")) : null,
      items == null ? h(ActivityIndicator, null)
        : items.length === 0 ? h(Text, { style: s.empty }, "No feedback yet. Say what you think.")
        // Oldest first, so the newest sits just above the input.
        : [...items].reverse().map((c) => h(Thread, { key: c.id, c, onReply: setReplyTo, onChanged: load }))),
    !accepted
      ? h(View, { style: s.guidelines },
          h(Text, { style: s.chatTitle }, "Before you write"),
          h(Text, { style: s.intro }, "Be kind and stay on topic. No spam, no personal attacks. You stay anonymous."),
          h(Pressable, { style: s.primary, accessibilityRole: "button", onPress: () => client.acceptGuidelines().then(() => setAccepted(true)).catch((e) => setError(e.message)) },
            h(Text, { style: s.primaryText }, "Accept and continue")))
      : h(View, { style: { gap: 6 } },
          replyTo && h(View, { style: s.replyBar },
            h(Text, { style: [s.muted, { flex: 1 }], numberOfLines: 1 }, "Replying to " + (replyTo.author.isMe ? "yourself" : replyTo.author.name || "a comment")),
            h(Pressable, { onPress: () => setReplyTo(null), hitSlop: 10, accessibilityLabel: "Cancel reply", accessibilityRole: "button" }, h(Text, { style: s.muted }, "✕"))),
          h(View, { style: s.compose },
            h(TextInput, { value: text, onChangeText: setText, placeholder: "Message…", placeholderTextColor: s.empty.color, style: s.input, maxLength: 1000, accessibilityLabel: "Add a comment" }),
            h(Pressable, { onPress: send, disabled: !text.trim(), style: [s.send, !text.trim() && { opacity: 0.4 }], accessibilityRole: "button" },
              h(Text, { style: s.primaryText }, "Send")))));
}

// Light and dark, matching the site's tokens. Text on lime is always dark.
const LIGHT = { bg: "#FFFFFF", fill: "#EFF1F4", line: "#C8CCD2", text: "#1A1E25", muted: "#5E646B", accent: "#9BE15D", accentSoft: "#E6F8DA", accentText: "#3F7400", onAccent: "#1A1E25", danger: "#A53A37" };
const DARK = { bg: "#151617", fill: "#252729", line: "#42454A", text: "#EAF1FA", muted: "#B8BEC7", accent: "#99D962", accentSoft: "#192311", accentText: "#A0CE7C", onAccent: "#0F0F10", danger: "#FF978F" };
const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
const makeStyles = (C) => StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, maxHeight: "75%" },
  sheetBody: { gap: 12, flexShrink: 1 },
  sheetFull: { height: "88%", maxHeight: "88%" },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: 22, fontWeight: "700", color: C.text, letterSpacing: -0.4 },
  chatTitle: { fontSize: 17, fontWeight: "700", color: C.text },
  badge: { color: C.onAccent, backgroundColor: C.accent, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, fontSize: 10, fontWeight: "700", fontFamily: mono, overflow: "hidden" },
  date: { fontFamily: mono, fontSize: 12, color: C.muted },
  intro: { fontSize: 15, lineHeight: 21, color: C.muted },
  bulletRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bulletDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: C.accent, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 15, lineHeight: 21, color: C.text },
  reactRow: { flexDirection: "row", gap: 8 },
  react: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: C.line, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  reactOn: { backgroundColor: C.accentSoft, borderColor: C.accentText, borderWidth: 2 },
  reactText: { fontSize: 15, fontWeight: "600", color: C.text },
  count: { fontFamily: mono, fontSize: 13, color: C.muted },
  feedback: { minHeight: 48, borderRadius: 14, backgroundColor: C.fill, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  chevron: { fontSize: 18, color: C.muted },
  link: { color: C.accentText, fontSize: 15, fontWeight: "500" },
  headerSide: { width: 64 },
  comment: { gap: 4 },
  commentDev: { borderWidth: 2, borderColor: C.accent, borderRadius: 14, padding: 10 },
  replies: { marginLeft: 4, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: C.line, gap: 12 },
  who: { fontSize: 13, fontWeight: "600", color: C.text },
  body: { fontSize: 15, lineHeight: 21, color: C.text },
  removed: { fontSize: 15, color: C.muted, fontStyle: "italic" },
  commentActions: { flexDirection: "row", gap: 16, marginTop: 2 },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.fill, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  note: { fontSize: 13, color: C.muted },
  shotRemove: { position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  shotRemoveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  action: { fontFamily: mono, fontSize: 12, color: C.muted },
  actionOn: { color: C.accentText, fontWeight: "700" },
  empty: { color: C.muted, textAlign: "center", paddingVertical: 20 },
  error: { color: C.danger, textAlign: "center" },
  guidelines: { backgroundColor: C.fill, borderRadius: 14, padding: 14, gap: 8 },
  primary: { backgroundColor: C.accent, borderRadius: 12, padding: 12, alignItems: "center" },
  primaryText: { color: C.onAccent, fontSize: 15, fontWeight: "700" },
  compose: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.fill, borderRadius: 999, paddingLeft: 14, padding: 4 },
  input: { flex: 1, fontSize: 15, paddingVertical: 6, color: C.text },
  send: { backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  muted: { fontSize: 14, color: C.muted },
  bugInput: { minHeight: 110, textAlignVertical: "top", backgroundColor: C.fill, borderRadius: 14, padding: 12 },
  shot: { width: "100%", height: 200, borderRadius: 12, backgroundColor: C.fill },
});

const STYLES = { light: makeStyles(LIGHT), dark: makeStyles(DARK) };
// Follows the phone's appearance setting.
function useStyles() {
  return STYLES[useColorScheme() === "dark" ? "dark" : "light"];
}

module.exports = { ChangelarkProvider, useChangelark, WhatsNewSheet, FeedbackChat, BugReport, createClient, decider };
