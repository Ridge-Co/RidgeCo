---
name: brainstorming
description: Use when a request is loose or open-ended and it is not yet clear WHAT should be built or why (a new screen, a new behavior, a redesign, "make this better"), before pre-build-grill and before any code. Finds out what Brett actually wants, lays out two or three ways to do it, and gets a short design approved. Not needed when the request already says everything that matters.
---

# Brainstorming

Adapted from obra/superpowers (MIT), trimmed for RidgeCo. You are good at building, and what you believe Brett wants is usually thinner than it feels. This skill finds out what he wants, and why, before anything is built.

## First: what do you actually know?
- **Everything that matters is in the request** ("make the button blue"): do it and say what you did. This skill is not needed.
- **Something that matters is missing:** start the conversation below.

## Look before you ask
Read what he pointed at and the code and context it connects to, until you can explain how the relevant part works today and what the change would touch. Never ask what the repo, the context files or an earlier decision already answers, and never reopen something he already decided.

## Your first message
- **He said what he wants:** in about 200 words, say it back in your own words (what, for whom, why), add what you found that bears on it, and say plainly if you found something that would change the request (a constraint, a conflict, a cheaper way). If the why is missing, ask for it: one open question, no options attached.
- **He did not:** ask one open question about the biggest unsettled thing, and say what the answer would change. Example for "a page for cleaners": "If it is mostly so cleaners know where to be, I would lead with today's jobs. If it is so you can see who is late, it is a different page. What should a cleaner do when they open it?"
- If he did not ask for a discussion, end with a one-line offer to just get going instead.

## The conversation
- Ask a question only when the answer would change what gets built and nothing already answers it. Otherwise state your call and your reason as something he can correct.
- Plain language. No process jargon. Lead with what matters.
- Until you know the why, ask open questions with no example answers; his own words carry intent that your options cannot. Once you know the why, name the choices, what each trades off, and which you would pick.
- Ground to cover (territory, not a script, never read out as a list): what kind of thing this is; why now; what success looks like; what would make it a failure even if it works; what he has seen elsewhere and liked or hated; what exists today; the details he cares about.
- Play it back as you go: when you understand one part, describe it in a short paragraph, mark what is his and what is your proposal, and ask what is wrong or missing.
- **Show, do not tell.** When the question is how something looks, a text sketch or a quick throwaway mock-up beats a description. A throwaway is labeled throwaway, gets no polish, and keeping it is a new request.

## Lay out the approaches
Once you understand what he wants, and before writing anything up, give two or three real ways to build it in a message of their own: concrete enough to picture, grounded in how the Hub actually works, with what each trades off. Recommend one and say why. If there is honestly one sensible way, say so and say why the others do not fit.

## Size the work, then write the short design
- **Small change:** a few lines covering what, why, the approach chosen and what is left to the builder.
- **Project:** a plain document a capable builder could plan from without coming back to Brett: intent and why; goals, non-goals and what would make it a failure; constraints; the approaches and the one chosen; what he decided; what is left open.
- It goes in the PR note (`context/notes/`) for a small change, or a `context/<NAME>_BUILD_BRIEF_v1.0.md` plus the matching Continuous Improvement project doc for a project.

## Gate
Nothing gets built until Brett approves the design (the short one or the full one). Reading and exploring are fine. Exceptions: he told you to skip the questions, or he said yes to a throwaway.

Nobody there to answer (scheduled run): do not wait and do not invent his answers. Take the most reasonable reading, write it at the top of the work as an assumption, and list it under "Decisions I made".

Next step after approval: `pre-build-grill`, then `writing-plans` if the work has several steps.

## Red flags
| Thought | Reality |
|---|---|
| "I will offer a menu of what he might want" | Options steer. Ask him to describe it first. |
| "I will fill in sensible defaults" | Good. Say them out loud. A default he never heard is one he could not reject. |
| "He said sounds good to the idea" | Approval covers what you showed him, not a design you have not written. |
| "The throwaway works, I will keep building on it" | Keeping it is a new request. Back through the gate. |
