# 2026-11-17 receipt-recon-panels-card-hint (follow-up to receipt-recon-accuracy)

## CURRENT
Brett (3:49pm): the Cards and Always-rules panels took too much space, and "remember as a customer card" showed on every row even for a card already saved as mine (a chance for mistakes). Changes (receipt-reconciler.html only): the add-a-card and add-a-rule forms sit in collapsed "＋ Add" sections that close after a save; panel summaries show counts; list rows are tighter. The remember checkbox is gone. A card on neither list now shows one hint with two buttons ("This is my card" saves it as mine only; "Customer's card" marks the receipt and saves it as a customer card). A card already on either list shows no prompt. If the card lists cannot be loaded the hint is hidden and the page error banner explains why.

## Pre-build gate
Shapes: `ui`. Small change to the parent build; parent defaults apply (no new questions). Silent-failure check: no catch added; lists-not-loaded is reported by the existing banner.

## Late requests
(none)

## FEATURE_LOG
Rule: a card prompt only appears for a last-4 that is on neither the mine nor the customer list; it always offers both owners.
