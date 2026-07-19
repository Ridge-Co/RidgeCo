# Brett Handwriting Key
**Version:** v1.1 | **Last Updated:** July 19, 2026
**Purpose:** Reference that helps Claude read Brett's handwritten notes when he photographs paper and dumps it into the Capture Inbox. This grows every session. When Claude can't read something and Brett tells it what it says, the resolution gets logged here so OCR + context get better over time. Expect a few "what the hell does this say, Brett?" rounds early on — each one permanently improves accuracy.

**Approach (confirmed July 19):** Live-capture learning. No calibration sheet. Claude OCRs each handwritten dump, flags uncertain words with ❓ + a best-guess, Brett confirms, and confirmations get logged below. The KNOWN VOCABULARY section is seeded from context so read #1 isn't blind — but those are *expected terms*, not yet confirmed against Brett's actual handwriting. A term only moves to RESOLVED READINGS once Claude has actually read it correctly off a photo.

---

## RESOLVED READINGS
*(Confirmed reads off real photos: the image reference or ambiguous text, and the confirmed meaning. This is the ground-truth log — only add a row after Brett confirms.)*

| Date | What it looked like / where | Confirmed reading |
|---|---|---|
| — | — | — |

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

### Sites & addresses
| Written form | Means |
|---|---|
| 2930 St Paul (Apt 2 / Apt 3) | Rental property, unit-level work |
| 151 W Lanvale St | Property (WO-1053 lives here) |
| 4709 Harford Rd Ste 43 | Business address, Baltimore MD 21214 |
| PO Box 39692 | Baltimore mailing box |

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

### Systems
| Written form | Means |
|---|---|
| Hub / Maintenance Hub | index.html admin portal |
| Vendor Portal | vendor.html |
| Worker | Cloudflare Worker (worker.js) |
| Twilio | SMS notifications |

---

## TRICKY GLYPHS
*(Character-level notes — how Brett writes a specific letter/number that OCR misreads. Fill in from real captures; empty until confirmed off a photo.)*

| Glyph | Note |
|---|---|
| — | *(watch for: VIN strings, apartment numbers, and $ amounts — confirm forms on first capture)* |

---

## HOW TO USE
- Before OCR'ing a handwriting photo, skim this file for context.
- Read the photo; anything uncertain, flag inline with ❓ and a best-guess, cross-checked against KNOWN VOCABULARY.
- After Brett confirms an unclear reading, add a row to RESOLVED READINGS.
- Promote anything that recurs into KNOWN VOCABULARY or TRICKY GLYPHS.
- Handwriting photos of business notes stay OUT of this public repo — log the *reading*, not the raw image.
