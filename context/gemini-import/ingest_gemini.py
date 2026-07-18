"""
Gemini Export Ingester — reusable, incremental.

Parses a Gemini "Complete Export" markdown file (conversations delimited by
`## N. Title`, turns marked `**Brett:**` / `**Gemini:**`), splits it into
per-conversation files, categorizes each by theme/venture, flags likely
gem-failure moments, and writes a manifest so future daily files only add
NEW conversations (dedupe by normalized title).

Usage:
    python ingest_gemini.py <raw_export.md> <out_dir> [existing_manifest.json]

Outputs (in <out_dir>):
    conversations/NNN_slug.md   one file per conversation (raw)
    manifest.json               ingested titles + stats (dedupe ledger)
    map.md                      human-readable categorized index

NOTE: conversation content and the manifest may contain sensitive personal/
financial info — keep these OUT of any public repo. Only this script is safe
to commit publicly.
"""
import json
import re
import sys
import os

CONV_RE = re.compile(r'^## (\d+)\. (.+)$')

# Theme rules — first match wins, so order matters.
THEMES = [
    ("Estimating & Pricing", ["estimate", "markup", "proposal", "invoice", "scope",
                               "line-item", "line item", "package", "quote", "pricing",
                               "deposit", "payment terms", "late fee", "customer"]),
    ("DIY Repair", ["washer", "dryer", "hvac", "faucet", "gasket", "vacuum", "mower",
                    "lug", "transmission", "wiring", "outlet", "breaker", "inverter",
                    "fridge", "refrigerator", "mini split", "mini-split", "router",
                    " fan", "refrigerant", "valve", "flooring", "lvp", "toilet",
                    "drawer", "ceiling fan", "jump start", "driveline", "error code",
                    "troubleshoot", "repair", "install", "replacement", "rat",
                    "crawlspace", "condensate", "senville", "ryobi", "dyson", "bmw",
                    "hot tub", "cooling", "heating", "breaker", "panel filler", "gas dryer"]),
    ("Vehicles & Fleet", ["vehicle", "registration", "u-haul", "uhaul", "kingbee",
                          "mileage", "tacoma", "toyota", "permit"]),
    ("Cabin / STR", ["reservation", "uplisting", "booking", "refund", "guest", "river",
                     "cabin", "shed", "backyard", "short-term", "str", "rental discount",
                     "rv "]),
    ("Resale / BarrelCo", ["barrel", "etsy", "facebook marketplace", "consignment",
                           "catalog", "forklift", "marketplace", "oak"]),
    ("Financing & Cash-Flow", ["klarna", "ondeck", "funding circle", "bluevine", "loan",
                               "venmo", "quickbooks", "qbo", "credit", "reconcil",
                               "financing", "bank", " fee"]),
    ("Ridge Co Ops / PM", ["work order", "property maintenance", "tenant", "mhic",
                            "maintenance", "turnover", "turn "]),
    ("AI / Gem Engineering", ["gem", "prompt", "claude", "gemini", "parsing", "guardrail",
                              "roleplay", "assistant", "safety"]),
    ("Personal / How Brett Thinks", ["adhd", "boundary", "jehovah", "compensation",
                                     "equity", "church", "friends and family", "etiquette"]),
    ("Tech / Device Friction", ["s23", "clipboard", "messenger", "voice-to-text", "voice to text",
                                "attachment", "notification", "add icon", "smartphone",
                                "windows", "samsung", "phishing"]),
]

GEM_FAIL_SIGNALS = [
    "not applicable", "that's not", "that is not", "doesn't apply", "does not apply",
    "wrong model", "different model", "actually,", "i apologize", "you are right",
    "you're right", "my mistake", "correction", "that didn't work", "that did not work",
    "not correct", "isn't correct", "that won't work", "incorrect", "that's wrong",
    "you mentioned", "let me correct", "does not match", "doesn't match",
]


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:60]


def categorize(title, body):
    hay = (title + " " + body[:1500]).lower()
    for theme, kws in THEMES:
        if any(k in hay for k in kws):
            return theme
    return "Other"


def main():
    raw_path, out_dir = sys.argv[1], sys.argv[2]
    manifest_path = sys.argv[3] if len(sys.argv) > 3 else None

    seen = set()
    if manifest_path and os.path.exists(manifest_path):
        with open(manifest_path) as f:
            for c in json.load(f).get("conversations", []):
                seen.add(c["title_norm"])

    with open(raw_path, encoding="utf-8") as f:
        lines = f.readlines()

    # Find conversation start line indices
    starts = [(i, CONV_RE.match(l)) for i, l in enumerate(lines) if CONV_RE.match(l)]
    convs = []
    for idx, (line_i, m) in enumerate(starts):
        end_i = starts[idx + 1][0] if idx + 1 < len(starts) else len(lines)
        num, title = m.group(1), m.group(2).strip()
        body = "".join(lines[line_i + 1:end_i])
        convs.append({"num": int(num), "title": title, "body": body})

    os.makedirs(os.path.join(out_dir, "conversations"), exist_ok=True)
    manifest = {"source": os.path.basename(raw_path), "conversations": []}
    by_theme = {}
    new_count = 0

    for c in convs:
        title_norm = c["title"].lower().strip()
        theme = categorize(c["title"], c["body"])
        brett_turns = c["body"].count("**Brett:**")
        gem_turns = c["body"].count("**Gemini:**")
        low = c["body"].lower()
        fail_hits = sorted({s for s in GEM_FAIL_SIGNALS if s in low})
        is_new = title_norm not in seen

        rec = {
            "num": c["num"], "title": c["title"], "title_norm": title_norm,
            "theme": theme, "brett_turns": brett_turns, "gemini_turns": gem_turns,
            "chars": len(c["body"]), "gem_fail_signals": fail_hits, "new": is_new,
        }
        manifest["conversations"].append(rec)
        by_theme.setdefault(theme, []).append(rec)

        if is_new:
            new_count += 1
            fn = f"{c['num']:03d}_{slug(c['title'])}.md"
            with open(os.path.join(out_dir, "conversations", fn), "w", encoding="utf-8") as wf:
                wf.write(f"# {c['num']}. {c['title']}\n\n{c['body']}")

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # Build map.md
    order = [t for t, _ in THEMES] + ["Other"]
    lines_out = ["# Gemini Import — Conversation Map",
                 f"\nSource: `{manifest['source']}` · {len(convs)} conversations · {new_count} new this file\n"]
    lines_out.append("## Counts by theme\n")
    for t in order:
        if t in by_theme:
            lines_out.append(f"- **{t}**: {len(by_theme[t])}")
    flagged = [c for c in manifest["conversations"] if c["gem_fail_signals"]]
    lines_out.append(f"\n**Conversations with possible gem-failure/correction signals:** {len(flagged)}\n")

    for t in order:
        if t not in by_theme:
            continue
        lines_out.append(f"\n## {t}\n")
        for c in sorted(by_theme[t], key=lambda x: x["num"]):
            flag = "  ⚠️gem-check" if c["gem_fail_signals"] else ""
            lines_out.append(f"- **#{c['num']} {c['title']}** "
                             f"({c['brett_turns']}↔{c['gemini_turns']} turns, {c['chars']} ch){flag}")

    with open(os.path.join(out_dir, "map.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines_out) + "\n")

    print(f"Parsed {len(convs)} conversations ({new_count} new).")
    print(f"Themes: " + ", ".join(f"{t}={len(by_theme[t])}" for t in order if t in by_theme))
    print(f"Gem-failure-signal conversations: {len(flagged)}")


if __name__ == "__main__":
    main()
