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
an earlier version checked whether a commit's keywords appeared ANYWHERE in
FEATURE_LOG.md at all, and it was useless — a file with 150+ entries about the same
codebase reuses words like "receipt", "work", "order", "property" constantly across
unrelated entries, so nearly any commit's keywords "matched" something somewhere
even when nothing documented that specific commit. Verified against a real known
gap (the Sep 14 Receipt Reconciler commits) before shipping: the whole-file version
scored 9/9 keyword "hits" on a commit FEATURE_LOG.md never actually described.
Fixed by checking whether keywords cluster together inside a SINGLE entry.

IMPORTANT #2 — why "since" comes from THIS SCRIPT'S OWN run history, not
CURRENT.md's header: the first live run (Sep 15 2026, via .github/workflows/
doc-audit.yml) crashed before writing anything, because CURRENT.md's header used
an abbreviated month ("Sep 15, 2026") and the parser only accepted the full name
("%B" in strptime) — an untested code path, since every local test up to that point
passed --since-date explicitly and never exercised the auto-detect fallback at all.
Beyond just fixing the format, tying "since" to CURRENT.md's header was the wrong
design to begin with: that header records the last "where things stand" write, not
the last time THIS audit ran, and the two can drift for reasons that have nothing
to do with documentation gaps. The audit's own run log is the right source of truth
for "since I last checked" — self-contained, doesn't depend on another file's
formatting staying stable, and degrades gracefully (falls back to a fixed window on
a genuinely first run, never just crashes).

Exit codes (the workflow depends on this distinction — do not silently swallow
either with `||` in CI): 0 = ran fine, no gaps. 1 = ran fine, found possible gaps
(expected/informational, not a failure). 2 = the audit itself broke (couldn't
determine a since-date from ANY source, or another real error) — this must show up
as a real CI failure, since a broken audit is worse than no audit: it looks like
"all clear" from the outside while checking nothing.

Usage: python3 doc_audit.py [--since-date YYYY-MM-DD] [--out FILE]
"""
import subprocess
import sys
import re
import argparse
from datetime import datetime, timedelta, timezone

STOPWORDS = {
    'the','a','an','and','or','to','for','of','in','on','wired','with','is','are','was',
    'were','be','been','not','no','now','so','it','its','this','that','these',
    'fix','fixed','fixes','add','added','adds','new','update','updated','build',
    'built','real','bug','issue','via','from','into','onto','if','when','then',
}
DEFAULT_LOOKBACK_DAYS = 2  # last-resort fallback if no other "since" source works at all

def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, check=False).stdout.strip()

def since_from_audit_log(path):
    """Most recent '## Run: YYYY-MM-DD HH:MM UTC' line in this script's own output
    file — the primary source of 'since I last checked'. Self-contained: doesn't
    depend on any other file's date format staying stable."""
    try:
        with open(path, encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        return None
    dates = re.findall(r'^## Run: (\d{4}-\d{2}-\d{2})', content, re.MULTILINE)
    return dates[-1] if dates else None

def since_from_current_md():
    """Fallback for a genuinely first run (no audit history yet). Accepts both
    full ('September') and abbreviated ('Sep') month names — the Sep 15 2026 live
    run crashed specifically because only the full-name format was accepted."""
    try:
        with open('context/CURRENT.md', encoding='utf-8') as f:
            first_line = f.readline()
    except FileNotFoundError:
        return None
    m = re.search(r'([A-Z][a-z]+) (\d{1,2}), (20\d{2})', first_line)
    if not m:
        return None
    month_str, day, year = m.groups()
    for fmt in ('%B', '%b'):
        try:
            month = datetime.strptime(month_str, fmt).month
            return f"{year}-{month:02d}-{int(day):02d}"
        except ValueError:
            continue
    return None

def determine_since(explicit):
    if explicit:
        return explicit, 'explicit --since-date'
    s = since_from_audit_log('context/DOC_AUDIT_LOG.md')
    if s:
        return s, "this script's own last recorded run"
    s = since_from_current_md()
    if s:
        return s, "CURRENT.md header (first run — no audit history yet)"
    # Last resort: never just fail with nothing to check. A fixed lookback window
    # still does useful work even when every smarter source is unavailable.
    fallback = (datetime.now(timezone.utc) - timedelta(days=DEFAULT_LOOKBACK_DAYS)).strftime('%Y-%m-%d')
    return fallback, f'fallback — no other source available, using last {DEFAULT_LOOKBACK_DAYS} days'

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

    try:
        since, since_source = determine_since(args.since_date)
    except Exception as e:
        print(f"Audit itself failed determining a since-date: {e}")
        sys.exit(2)

    log = sh(f'git log --since="{since} 00:00" --format="%h|%ad|%s" --date=format:"%Y-%m-%d %H:%M" --no-merges')
    commits = [l.split('|', 2) for l in log.splitlines() if l.strip() and l.count('|') >= 2]
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
    lines = [
        f"\n## Run: {now}",
        f"Since: {since} (source: {since_source})",
        f"Checked commits: {len(commits)} (excluding merges/doc-audit itself)",
    ]
    if flagged:
        lines.append(f"**{len(flagged)} possible gap(s) — needs a human/Claude look, not auto-filed:**")
        for sha, date, subject, frac in flagged:
            lines.append(f"- `{sha}` ({date}) {subject} — best single-entry match: {frac:.0%}")
    else:
        lines.append("No gaps flagged.")

    try:
        with open(args.out, 'a', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')
    except Exception as e:
        print(f"Ran the audit but failed writing the log: {e}")
        print('\n'.join(lines))
        sys.exit(2)

    print('\n'.join(lines))
    sys.exit(1 if flagged else 0)

if __name__ == '__main__':
    main()
