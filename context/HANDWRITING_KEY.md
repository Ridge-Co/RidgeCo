# Brett Handwriting Key
**Version:** v1.7 | **Last Updated:** July 19, 2026
**Purpose:** Reference that helps Claude read Brett's handwritten notes when he photographs paper and dumps it into the Capture Inbox. This grows every session. When Claude can't read something and Brett tells it what it says, the resolution gets logged here so OCR + context get better over time. Expect a few "what the hell does this say, Brett?" rounds early on — each one permanently improves accuracy.

**Approach (confirmed July 19):** Live-capture learning. No calibration sheet. Claude OCRs each handwritten dump, flags uncertain words with ❓ + a best-guess, Brett confirms, and confirmations get logged below. The KNOWN VOCABULARY section is seeded from context so read #1 isn't blind — but those are *expected terms*, not yet confirmed against Brett's actual handwriting. A term only moves to RESOLVED READINGS once Claude has actually read it correctly off a photo.

---

## RESOLVED READINGS
*(Confirmed reads off real photos: the image reference or ambiguous text, and the confirmed meaning. This is the ground-truth log — only add a row after Brett confirms.)*

| Date | What it looked like / where | Confirmed reading |
|---|---|---|
| 2026-07-19 | Scan_2019, top block, capital that looked like "AA" | **Marvin** (Brett's cursive capital M reads like "AA") |
| 2026-07-19 | Scan_2019, "Calderon" | **Calderon** — surname (lead) |
| 2026-07-19 | Scan_2019, after Plumbing | **Ashburton** — a STREET name, not a neighborhood |
| 2026-07-19 | Scan_2019, "Al Strat_" | **Al Stratti** (double-t) — plumber lead |
| 2026-07-19 | Scan_2019, "R_b Whitley" | **Rob Whitley** (Rob, not Roy/Ray) — plumber lead |
| 2026-07-19 | Scan_2019, "Oscar Cul__r" | **Oscar Culver** = shorthand for "follow up with Oscar on the job at **56 S Culver St**." Culver = street. |
| 2026-07-19 | Scan_2019, "$300 ... to _esar for floor" | **Cesar** (Cesar Gomez, V-003). "$300 extra to Cesar for floor" — legit; floor repairs were needed before install. |
| 2026-07-19 | Scan_2020, list item 5 | **"Build email list + continue to add value"** (continue, not "nurture") |
| 2026-07-19 | Scan_2032_1, journey note | "...small things like **making** things, fixing things..." (making, not "nailing"); "Side quests = **A.S.Q. → Answer a Specific Question (sometimes)**" |
| 2026-07-19 | Scan_2032_1, bottom ledger | Unit #s (1214, 151, 153, 928) each with **170** to the right; "**Oscar 450 3014**". Payment shorthand — handwriting only, NOT a to-do. |
| 2026-07-19 | Scan_2032, Cesar money slip | "**pay Cesar**", "**pay Potomac Edison**" (electric utility, not "Antonio Nelson"), "**toilet**", "**floor**". Cesar's $300 floor = **807 N Calvert St bakery** install, NOT Culver. Handwriting only — not a to-do. |
| 2026-07-19 | Scan_2030, M&T stmt (sideways blue ink) | Facebook-group posting list for BarrelCo barrel products: "online yard sale 16 / Balt city and co yard sale 17 / Balt the yard sale 18 / Balt easy online yard sale 19" (trailing numbers' meaning unknown). Handwriting only. |
| 2026-07-19 | Job assignment (via Brett) | The **56 S Culver St** job went to **Cesar** (V-003); the written "Oscar Culver" note referenced a follow-up, but Cesar got the job. |
| 2026-07-19 | Scan_2104 (TOPS legal-pad to-do list) | "**U-Haul**" read like "HALL"; "**detector**" read like "deduct"; "**1864 Kerns School Rd**" (not Kean); tenants "**William** 3014 #3 / **Julie** 115 #2 / 2930 **1R** / 115 #1"; "**Sergio** bills — entered/needs paid". Unit "151 #2" was actually **153 #2**. |
| 2026-07-19 | Scan_2104, billing note | Brett's service-charge model: **$75 covers the 1st hour, $75 each additional hour** (QB billing question — how to bill the 1st hour without it looking like padding). |
| 2026-07-19 | Scan_2105_1 ("Fix What Bugs Me") | Clean read — capture-system vision note. Confirmed "**tags**" (not "flags"); "FU's" = follow-ups. |
| 2026-07-19 | Scan_2105_2 (lock-code note) | Clean read. "**parcel locker**" = a lock-code category (distinct from lockboxes/door codes; shareable with tenants). "capture vs do" = Brett's design principle (log job-site data vs. act on it). |
| 2026-07-19 | Scan_2105 (mixed legal-pad list) | Corrections: "**Knock**" not Knott (Kelly Knock); "**Fait**" Ave/St not "Job Fair"; "**Vanity**" not "Vanty"; "**Ray's tolls**" not "Kings cargo van bills"; "**box co Re Spoon**" not "box code the spoon"; "**Federal**" = Federal St job. "Task list > projects" = link tasks to projects. |

---

## KNOWN VOCABULARY (seeded from context — expected, not yet handwriting-confirmed)
*(When Claude hits an ambiguous scrawl, check here first — the intended word is very likely one of these. Confirm against the photo, and if it recurs or a glyph is tricky, promote it to RESOLVED READINGS / TRICKY GLYPHS.)*

### Shorthand & abbreviations
| Shorthand | Means |
|---|---|
| WO | Work order (IDs like WO-1053) |
| PO | Purchase order / job name |
| WBM | Capture/task item — **confirm exact meaning with Brett** |
| IR | Invoice Review |
| VB | Vendor Bill |
| GL | General liability (insurance) |
| VMA | Vehicle Management Agreement (Kingbee) |
| MVA | Maryland Motor Vehicle Administration |
| EFT | Electronic funds transfer (auto-pay) |
| STR | Short-term rental (the Cabin) |
| FI | Financial independence (Brett's content pillar) |
| ST rental | Short-term rental |
| A.S.Q. | "Answer a Specific Question" — Brett's how-to content format ("side quests") |
| FU | Follow up (also "FU's" = follow-ups) |
| V- / T- / U- / P- | ID prefixes: Vendor / Tenant / Unit / Property |
| VIN | Vehicle ID number (Ram ProMaster vans start `3C6LRVDG…`) |

### Vendors (Ridge Co)
| Name | ID | Note |
|---|---|---|
| Alex Mix | V-001 | $35/hr |
| Oscar Padilla | V-002 | $50/hr |
| Cesar Gomez | V-003 | rate TBD |
| Eddie Smith | V-004 | rate TBD |
| Alan George ("Mook") | V-005 | rate TBD — may write "Mook" |
| Sergio | — | Vendor — bills entered, needs paid (confirm full name/ID) |

### Utilities & payees
| Written form | Means |
|---|---|
| Potomac Edison | Electric utility (bill payee) |
| EZ-Pass | Toll account (source for Ray's weekly toll invoicing) |

### Apps / tools
| Written form | Means |
|---|---|
| Vendoo | Reselling crosslisting app (BarrelCo) — to cancel |
| Klarna | Buy-now-pay-later (used for a personal-truck mechanic purchase) |

### Sites & addresses
| Written form | Means |
|---|---|
| 2930 St Paul (Apt 2 / Apt 3) | Rental property, unit-level work |
| 151 W Lanvale St | Property (WO-1053 lives here) |
| 4709 Harford Rd Ste 43 | Business address, Baltimore MD 21214 |
| PO Box 39692 | Baltimore mailing box |
| Ashburton | Baltimore STREET name (job/site reference) |
| 56 S Culver St | Job site — Cesar got this job (CAP-012); written note read "Oscar Culver" |
| 807 N Calvert St (bakery) | Install job site — Cesar floor prep ($300 extra) |
| Gibbons | Job(s) — Cesar follow-up (confirm exact spelling/location) |
| 1864 Kerns School Rd | Address on LLC renewal/report line (confirm entity) |
| Barre St | Job/property (Kelly Knock; job canceled) |
| Fait Ave / Fait St | Job/property — owner payment + leak check; 3rd-floor pop-up assemblies |
| Federal St | Job — NOT in the Hub; invoices created manually |
| Unit numbers | 3014, 1214, 151, 153, 2930, 928, 115 — property/unit refs. Suffixes like "1R" = a unit designation (e.g. rear); "#2"/"#3" = apartment. |

### Ventures & entities
| Written form | Means |
|---|---|
| Ridge Co / RidgeCo | Property maintenance venture |
| BrettOS | Cross-venture intelligence layer |
| BarrelCo | Barrel & planter resale |
| Cabin | WV Cabin STR (Springfield, WV) |
| Winchester Hauling | CHEP/PECO pallet recycling |
| BMore Management | Parent brand / umbrella |
| Saint Thomas Ventures LLC | Handyman/Ridge Co operating entity (holds GL insurance) |
| Global North Inc | Owner of the cargo vans |

### Vehicles, managers & vendors (fleet + Turo)
| Written form | Means |
|---|---|
| Kingbee | Cargo-van manager (Hive Network platform) — current |
| GiddyUp | Turo manager (Colorado) — current |
| Fluid / FluidTruck | Prior van manager — defunct/historical |
| Arslan / TuroDone4You | First Turo manager — defunct/historical |
| Turo | Short-term car-rental platform |
| Ram ProMaster | Cargo van model (VINs `3C6LRVDG…`) |
| Chevy Tahoe / Toyota Tacoma | The two Turo cars |
| Luray Insurance / Stephanie | New GL insurance provider/contact |
| Paulo | Lease-to-own contact (cohadoconnect@gmail.com) |

### People & contacts
| Written form | Means |
|---|---|
| Brett Lambert | Owner ("Chief More Manager") |
| 410-777-8651 | Brett's number |
| Gina | Cabin contact — provides the shopping list |
| William | Tenant — 3014 #3 |
| Julie | Tenant — 115 #2 |
| Jenn / Jen | Contact/tenant — source of WO time + repair lists |
| Mark / Amanda | Contacts — WO time in message threads |
| Kelly Knock | Barre St contact (job canceled) |
| Spoon | Friend — referred a box-recycling / cheap moving-box company |
| Ray (NJ) | Former friend in NJ holding one of Brett's cargo vans; $5k behind on tolls/bill |

### Systems
| Written form | Means |
|---|---|
| Hub / Maintenance Hub | index.html admin portal |
| Parcel locker | A lock-code category (vs. lockbox / door code); codes shareable with tenants |
| Vendor Portal | vendor.html |
| Worker | Cloudflare Worker (worker.js) |
| Twilio | SMS notifications |

---

## TRICKY GLYPHS
*(Character-level notes — how Brett writes a specific letter/number that OCR misreads. Fill in from real captures; empty until confirmed off a photo.)*

| Glyph / pattern | Note |
|---|---|
| Capital **M** | Reads like "AA" (e.g. "Marvin" looked like "AAarvin"). If a word opens with "AA…", suspect a capital M. |
| Strike-through | A line through a name/item = crossed off / dead lead, NOT deletion of meaning. Preserve it as "rejected." |
| **Name + Street** | Brett writes "FirstName StreetName" (e.g. "Oscar Culver") as shorthand for "follow up with that person about the job at that street." The second word is often a STREET, not a surname. |
| "U Haul" | Reads like "HALL" (capital U tucks into "Haul"). If a line looks like "Do HALL," suspect **U-Haul**. |
| "detector" | Can read like "deduct." In a maintenance/invoice context it's usually **detector** (smoke/CO). |
| *(watch)* | VIN strings, apartment numbers, and $ amounts — confirm forms on first capture. |

---

## HOW TO USE
- Before OCR'ing a handwriting photo, skim this file for context.
- Read the photo; anything uncertain, flag inline with ❓ and a best-guess, cross-checked against KNOWN VOCABULARY.
- After Brett confirms an unclear reading, add a row to RESOLVED READINGS.
- Promote anything that recurs into KNOWN VOCABULARY or TRICKY GLYPHS.
- Handwriting photos of business notes stay OUT of this public repo — log the *reading*, not the raw image.
