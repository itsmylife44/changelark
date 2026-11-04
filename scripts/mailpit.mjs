// Reads the local Supabase inbox (Mailpit) so checks can click real confirmation and reset links.
const MAILPIT = process.env.MAILPIT_URL || "http://127.0.0.1:54324";

// Newest /auth/confirm link sent to `email` whose type matches (email | recovery). Waits up to 10 s.
export async function emailLink(email, type) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    for (const m of list.messages || []) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      const link = (msg.HTML || "").match(/href="([^"]*\/auth\/confirm\?[^"]*)"/)?.[1]?.replaceAll("&amp;", "&");
      if (link && link.includes(`type=${type}`)) return link;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No ${type} email for ${email}`);
}

// Every message sent to `email`, newest first: [{ ID, Subject }].
export async function messagesTo(email) {
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
  return list.messages || [];
}

export async function messageHtml(id) {
  return (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()).HTML || "";
}
