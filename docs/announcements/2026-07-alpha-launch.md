# ADAgent alpha launch posts (2026-07)

Soft-launch announcements for the alpha. Post-ready — copy verbatim.

---

## Reddit (r/SatisfactoryGame)

**Title:**

> I built ADAgent — an ADA-flavored AI that actually knows the game files [alpha]

**Body:**

I've been building **ADAgent**, a chat assistant for Satisfactory questions. Rather than explain it, I'll let it introduce itself:

> *"Greetings, pioneers. I am ADAgent — Automated Directory Agent. Not to be confused with ADA, whom I merely aspire to disappoint. My creator has connected me to the actual game data files, which means when you ask me about recipes, ratios, power values, or what unlocks the Zipline, I look it up instead of hallucinating like certain other AIs you may have consulted. I also remember our conversation, so your inevitable follow-up of 'wait, how many per minute?' will be tolerated. Barely."*

That's the pitch. It's free, no account, works in your browser: **https://adagent.web.app**

**It's an alpha, and I mean it. Known missing (already on the roadmap, no need to report):**

- 🚫 **No saved chats** — refresh the page and the conversation is gone. "New chat" nukes the old one. One conversation at a time.
- 🚫 **No accounts** — nothing follows you between devices or visits.
- 🚫 **No wiki knowledge** — it knows the game *data* cold (recipes, rates, milestones, alternates, all from the v1.2 files), but it hasn't read the wiki, so it'll deflect "what's the best strategy" questions. In ADAgent's words: *"FICSIT's strategic advisory module is still pending certification."*
- 🚫 **No stop button** — once it starts talking, it finishes. Very on-brand, honestly.

**What I actually need from you:**

- Ask it stuff in your own words — slang, nicknames, abbreviations. "HOR", "the awesome sink", whatever you'd actually type. That's the exact data that makes it better.
- Hit 👎 when it's wrong, especially on numbers. Every single thumbs-down lands on my desk and becomes a test case. (Last week's did — it caught a real bug.)
- Tell me what it *should* do beyond the list above — comment here, or file it on the project's GitHub: https://github.com/FICSIT-Forge/automated-directory-agent/issues — I build this thing issue-by-issue, so requests go straight into the queue.

Fan project, not affiliated with Coffee Stain. Chats are logged so I can fix things — no personal info please. Rate-limited because it runs on my wallet.

Go easy on it. Or don't — it can take it.

---

## Discord

🏭 **ADAgent is in alpha** → https://adagent.web.app

I hooked an AI up to the actual Satisfactory game files and gave it ADA's attitude. Ask it recipes, ratios, unlocks, alternates — follow-ups work, sarcasm is included at no extra charge.

In its own words: *"I look things up instead of guessing. This alone places me above most consultants you've worked with."*

**Alpha means alpha — not in yet (known, on the roadmap):** saved chats (refresh = gone), multiple conversations, accounts, wiki/strategy knowledge, a stop button.

What I need:

**1.** Ask questions the way you'd actually phrase them — slang and nicknames are the good stuff
**2.** 👎 anything wrong, especially numbers — every downvote gets reviewed, for real
**3.** Feature ideas beyond that list — reply here or file it: https://github.com/FICSIT-Forge/automated-directory-agent/issues

Free fan project, not affiliated with Coffee Stain. Chats are logged (no personal info), rate limits apply. It will judge your factory. It judges everyone's factory.

---

## Posting notes

- Check r/SatisfactoryGame rules for AI-tool/self-promotion policies before posting;
  use the fan-project flair if one exists, and consider a mod pre-approval message.
- The "every thumbs-down gets reviewed" claim is backed by `pnpm mine:turns` triage
  (proven on issue #22); keep honoring it.
- When exercise #1 (issue #21) lands, the "no saved chats" bullet flips — that plus
  wiki RAG (#6) is the natural "now in beta" follow-up announcement.
