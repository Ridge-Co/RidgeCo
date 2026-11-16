---
name: public-site-taste
description: Use ONLY for public marketing pages (the cabin booking site, the BarrelCo site, Ridge Co landing pages, shop/index.html) when building or restyling a page whose job is to win a visitor. It must NOT be used on the Hub or the vendor, tenant or owner portals or any tool page, which follow DESIGN.md and ridgeco-ui-review instead.
---

# Public site taste

This skill must NOT be used on the Hub (`index.html`), the vendor / tenant / owner portals, or any tool page. Those are work tools: they follow `DESIGN.md`, where sameness and restraint are the point. This skill is for pages a stranger lands on and decides from.

An original short skill written for RidgeCo. The ideas are distilled from Leonxlnx/taste-skill (MIT, read at the commit pinned in `context/THIRD_PARTY_SKILLS.md`). None of its scripts, hooks, kit files or photographs are installed here.

## Before you design
Write four lines first: what is sold; who buys it; the one main action (Book the cabin, Order a barrel, Request a quote); and the real material you have (photographs, prices, address, hours, logo). If there are no real photographs, say so and list what Brett needs to supply. Do not start with colors.

## Rules
1. **Say plainly what is sold, on the first screen,** with one hard fact (a price, a place, a number of guests) and the main action button. A visitor should know what this is in three seconds.
2. **Write the words first.** Headings name things. Buttons are a verb and an object ("Check dates", not "Submit"). No filler lines, no stock phrases, nothing invented: no made-up reviews, customers, quotes or figures.
3. **Show the real thing on every screen.** A cabin page shows the cabin, the rooms, the view. A product page shows the product, large. Real photographs lead; a place needs many, not three. A different picture in each section, never the same one twice.
4. **Stand-in pictures are labeled as stand-ins** in the PR, never passed off as the client's own, and replaced before launch. Do not download or hotlink pictures from the web without a licence you can name.
5. **One section, one idea,** about one screen tall. The hero sits alone on the first screen.
6. **One system:** one pair of buttons, one card style, one radius, one type scale with two families at most, equal left and right edges.
7. **Quiet motion only:** the hero may enter once, links and buttons answer the pointer, nothing moves because the page scrolled, nothing tilts, no carousels. Respect reduced-motion.
8. **Effects fit the trade.** A cabin, a barrel shop or a hauling company gets photographs, flat color and good type. Shaders, 3D and glowing gradients are for software pages, and we have none.
9. **Phone first, still.** Check 390, 768, 1024 and 1440. One column on a phone, buttons full width, tap targets 44px, no sideways scroll, text contrast 4.5:1.
10. **Fast.** Images sized for their box, lazy below the first screen, no layout jump as they load.
11. **Private details stay private:** no personal phone numbers or home addresses in a public page or the public repo unless Brett has said that exact detail is public.

## Check before the PR
- Run `node scripts/ui-check.mjs <page>` (it covers sideways scroll and the basics) and look at the screenshots.
- Read every line of copy aloud once. Cut what sounds like an advertisement.
- First screen test: cover the logo. Is it still clear what is sold and what to do?
- List in the PR: the main action, every stand-in picture, every assumed fact (hours, prices) Brett must confirm.

## Never
Gradient text, a fade-in on every section, parallax on text, a violet glow, a drawn copy of a real logo, a copy of another site's code, words or signature look.
