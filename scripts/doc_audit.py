#!/usr/bin/env python3
"""
Documentation audit (Sep 15, 2026) — flags commits that landed with no apparent
FEATURE_LOG.md entry, so a gap like the Sep 14 one (9 commits, ~2.5 hours of real
work, zero documentation) gets caught by a schedule instead of by Brett asking.

This is a HEURISTIC, not a certainty check — it can't tell whether a commit was
genuinely undocumented or just uses different wording than its FEATURE_LOG entry.
It flags "possible gap, needs a human/Claude to actually look," the same way this
script's own output should be read: as a worklist, not a verdict. A Claude session
picking up a flagged commit should read the commit's own diff/message and decide
for itself whether it needs a real entry — never auto-write one from this script's
output alone.

IMPORTANT — why this checks per-ENTRY clustering, not whole-file keyword presence:
an earlier version of this script checked whether a commit's keywords appeared
ANYWHERE in FEATURE_LOG.md at all, and it was useless — a file with 150+ entries
about the same codebase reuses words like "receipt", "work", "order", "property"
constantly across unrelated entries, so nearly any commit's keywords "matched"
something somewhere even when nothing documented that specific commit. Verified
against a real known gap (the Sep 14 Receipt Reconciler commits) before shipping:
the whole-file version scored 9/9 keyword "hits" on a commit that FEATURE_LOG.md
never actually described. Fixed by checking whether keywords cluster together
inside a SINGLE entry, not scattered across the whole document.

Usage: python3 doc_audit.py [--since-date YYYY-MM-DD] [--out FILE]
"""
import subprocess
import sys
import re
import argparse
from datetime import datetime, timezone

STOPWORDS = {
    'the','a','an','and','or','to','for','of','in','on','wired','with','is','are','was',
    'were','be','been','not','no','now','so','it','its','this','that','these',
    'fix','fixed','fixes','add','added','adds','new','update','updated','build',
    'built','real','bug','issue','via','from','into','onto','if','when','then',
}

def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, check=False).stdout.strip()

def parse_current_md_date():
    try:
        with open('context/CURRENT.md', encoding='utf-8') as f:
            first_line = f.readline()
        m = re.search(r'([A-Z][a-z]+ \d{1,2}, 20\d{2})', first_line)
        if m:
            return datetime.strptime(m.group(1), '%B %d, %Y').strftime('%Y-%m-%d')
    except Exception:
        pass
    return None

def keywords(subject):
    words = re.findall(r"[a-zA-Z][a-zA-Z'_-]{2,}", subject.lower())
    return [w for w in words if w not in STOPWORDS]

def load_entries(path):
    """Split a FEATURE_LOG-style file into per-entry chunks on the '**NNN.' or
    '**[FL-...]' boundary, so a keyword match can be scored PER ENTRY instead of
    against the whole document (see module docstring for why that matters)."""
    try:
        with open(path, encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        return []
    chunks = re.split(r'\n(?=\*\*(?:\d+\.|\[FL-))', content)
    return [c.lower() for c in chunks]

def best_entry_match(kws, entries):
    """Returns the highest fraction of kws found together inside any single entry."""
    if not kws or not entries:
        return 0.0
    best = 0.0
    for entry in entries:
        hits = sum(1 for w in kws if w in entry)
        frac = hits / len(kws)
        if frac > best:
            best = frac
    return best

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since-date')
    ap.add_argument('--out', default='context/DOC_AUDIT_LOG.md')
    args = ap.parse_args()

    since = args.since_date or parse_current_md_date()
    if not since:
        print("Could not determine a since-date (CURRENT.md header didn't parse) — pass --since-date explicitly.")
        sys.exit(1)

    log = sh(f'git log --since="{since} 00:00" --format="%h|%ad|%s" --date=format:"%Y-%m-%d %H:%M" --no-merges')
    commits = [l.split('|', 2) for l in log.splitlines() if l.strip()]
    entries = load_entries('context/FEATURE_LOG.md')

    flagged = []
    for sha, date, subject in commits:
        if subject.startswith('Documentation audit') or subject.startswith('Merge pull request'):
            continue
        kws = keywords(subject)
        if len(kws) < 3:
            continue  # too few distinctive words to score meaningfully either way
        frac = best_entry_match(kws, entries)
        # Flag when NO single entry contains even half this commit's distinctive
        # keywords together — a real matching entry for a real commit typically
        # scores much higher than this (the Unit-picker test case, once actually
        # documented, self-matches near 1.0 against its own entry).
        if frac < 0.5:
            flagged.append((sha, date, subject, frac))

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    lines = [f"\n## Run: {now}", f"Checked commits since {since}: {len(commits)} (excluding merges/doc-audit itself)"]
    if flagged:
        lines.append(f"**{len(flagged)} possible gap(s) — needs a human/Claude look, not auto-filed:**")
        for sha, date, subject, frac in flagged:
            lines.append(f"- `{sha}` ({date}) {subject} — best single-entry match: {frac:.0%}")
    else:
        lines.append("No gaps flagged.")

    with open(args.out, 'a', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print('\n'.join(lines))
    sys.exit(1 if flagged else 0)

if __name__ == '__main__':
    main()
