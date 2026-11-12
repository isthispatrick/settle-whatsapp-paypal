// Pure helpers for the Slack adapter (kept separate so they can be tested without tokens).

/** Turn Slack's markup into plain text the agent can read: mentions, links, emails, entities. */
export async function plainText(text, lookupName, botId) {
  let out = text || "";
  for (const [, id] of out.matchAll(/<@([A-Z0-9]+)>/g))
    out = out.replaceAll(`<@${id}>`, id === botId ? "@settle" : `@${await lookupName(id)}`);
  return out
    .replace(/<mailto:[^|>]+\|([^>]+)>/g, "$1")
    .replace(/<mailto:([^>]+)>/g, "$1")
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/<(https?:[^|>]+)(?:\|[^>]*)?>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();
}
