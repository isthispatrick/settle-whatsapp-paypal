// Group expense ledger. All amounts are integer minor units (pence/cents) so splits never drift.

export const CURRENCIES = ["GBP", "EUR", "USD", "AUD", "CAD", "SGD"];
const SYMBOLS = { GBP: "£", EUR: "€", USD: "$", AUD: "A$", CAD: "C$", SGD: "S$" };

export const toMinor = (n) => Math.round(Number(n) * 100);
export const fmt = (minor, cur) => `${SYMBOLS[cur] ?? cur + " "}${(minor / 100).toFixed(2)}`;

export function newChat(id, isGroup) {
  return { id, isGroup, members: Object.create(null), expenses: [], settlements: [], payments: {}, transcript: [], seq: 0 };
}

export function touchMember(chat, id, name) {
  const m = (chat.members[id] ??= { name: name || id, paypalEmail: null });
  if (name && m.name !== name && !m.renamed) m.name = name;
  return m;
}

/** Resolve a free-text reference ("tom", "Tom B") to a member id. Throws on unknown/ambiguous. */
export function resolveMember(chat, ref) {
  const q = String(ref).trim().replace(/^@/, "").toLowerCase();
  if (Object.hasOwn(chat.members, ref)) return ref;
  const all = Object.entries(chat.members);
  for (const test of [(n) => n === q, (n) => n.startsWith(q), (n) => n.includes(q)]) {
    const hits = all.filter(([, m]) => test(m.name.toLowerCase()));
    if (hits.length === 1) return hits[0][0];
    if (hits.length > 1) throw new Error(`"${ref}" is ambiguous: ${hits.map(([, m]) => m.name).join(", ")}`);
  }
  throw new Error(
    `No member called "${ref}". Known members: ${all.map(([, m]) => m.name).join(", ") || "none"}. ` +
      `People become known once they send a message in this chat.`,
  );
}

/** Split `total` minor units equally across n people; remainder pennies go to the first few. */
export function equalSplit(total, n) {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

/** Net position per currency: positive = is owed money, negative = owes. */
export function netBalances(chat) {
  const net = {};
  const add = (cur, id, v) => ((net[cur] ??= {})[id] = (net[cur][id] ?? 0) + v);
  for (const e of chat.expenses) {
    add(e.currency, e.paidBy, e.amount);
    for (const s of e.shares) add(e.currency, s.member, -s.amount);
  }
  for (const s of chat.settlements) {
    add(s.currency, s.from, s.amount);
    add(s.currency, s.to, -s.amount);
  }
  return net;
}

/** Minimal-ish set of transfers that clears all debts (greedy largest debtor -> largest creditor). */
export function transfers(chat) {
  const out = [];
  for (const [currency, byMember] of Object.entries(netBalances(chat))) {
    const debt = Object.entries(byMember).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
    const cred = Object.entries(byMember).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
    debt.sort((a, b) => b.v - a.v);
    cred.sort((a, b) => b.v - a.v);
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const amount = Math.min(debt[i].v, cred[j].v);
      if (amount > 0) out.push({ from: debt[i].id, to: cred[j].id, amount, currency });
      debt[i].v -= amount;
      cred[j].v -= amount;
      if (debt[i].v === 0) i++;
      if (cred[j].v === 0) j++;
    }
  }
  return out;
}

export function balancesText(chat) {
  const t = transfers(chat);
  if (!t.length) return "All settled up — nobody owes anything.";
  const name = (id) => chat.members[id]?.name ?? id;
  return t.map((x) => `${name(x.from)} owes ${name(x.to)} ${fmt(x.amount, x.currency)}`).join("\n");
}
