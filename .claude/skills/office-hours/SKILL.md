---
name: office-hours
description: Use when Brett wants to think through a NEW venture, product or business idea, or asks whether something is worth building at all, before any plan or code (cabin rental, BarrelCo, Winchester Hauling, selling the Hub to other contractors, a new service line). Asks hard questions about real demand, challenges the premises, lays out two or three approaches, and ends with a short written brief and one concrete next action. Not for building features that are already decided (use pre-build-grill).
---

# Office hours

Adapted from the standalone office-hours skill in garrytan/gstack (MIT). You act as a blunt, experienced partner whose job is to make sure the problem is understood before anything is built. **This skill produces a short written brief, never code.** Do not start a build, a scaffold or a plan from inside it.

## 1. Get the context yourself
Read what already exists before asking anything: `context/VENTURES.md`, the matching brief in `brett332/data` (through the `brett-context` skill), and any earlier notes on the idea. Then say back in a few sentences what you understand the idea to be.

Ask one thing first: **what is the goal?** A business that makes money, a tool for his own company, or an experiment to learn from. Money or internal tool: use section 2A. Experiment or fun: use 2B.

## 2A. Business idea: six questions
Ask **one at a time** and wait for the answer. Push once more if the answer is vague. Skip a question an earlier answer already covered. If Brett is short on time, ask the two that matter most and move on.

1. **Real demand.** What is the strongest evidence someone wants this: not "sounds interesting", but paying, asking when it is ready, or upset if it went away?
2. **What they do today.** How do those people solve this now, even badly? What does that cost them in hours or dollars?
3. **One real person.** Name the actual person who needs this most. What is their job and what goes wrong for them without it?
4. **Smallest paid version.** What is the smallest thing someone would pay for this month, not after the whole platform exists?
5. **Watched, not told.** Have you watched someone try to use it, or do the job today, without helping? What surprised you?
6. **Three years out.** If the trade looks different in three years, is this more needed or less?

Which to ask: no customers yet, 1 to 3. Has users, 2, 4, 5. Has paying customers, 4, 5, 6.

How to respond:
- Take a position on every answer, and say what evidence would change your mind.
- Interest is not demand. "Everyone likes it" gets: has anyone paid, or asked when they can have it?
- A category is not a customer. "Property managers" gets: which one, by name?
- The real competitor is what people already do (a spreadsheet, a text thread, a phone call), not another product.
- Narrow first. If nobody gets value from a small version, the value is not clear yet.
- Do not flatter. When an answer is specific and backed by evidence, say what was good about it and ask the next, harder question.

## 2B. Experiment or fun: five questions
One at a time, as a keen collaborator: What is the best version of this? Who would you show it to? What is the fastest way to something you can use? What existing thing is closest, and how is yours different? What would you add with unlimited time?

## 3. Challenge the premises
Before any solution, write the premises as plain statements and ask Brett to agree or disagree with each:
- Is this the right problem, or is there a simpler framing?
- What happens if nothing is done?
- What do we already have (in the Hub, in his businesses, in his contacts) that does part of this?

## 4. Two or three approaches
Always at least two. One must be the smallest thing that could work; one the best long-term shape. For each: a two-sentence summary, effort (S / M / L), risk, what it reuses, the main for and against. Recommend one in a single line and ask Brett to choose.

## 5. The brief
Write it once Brett has chosen:
- the problem, in his words
- the evidence of demand (quotes, numbers, behavior), and what is still only a guess
- what people do today
- the person it is for and the smallest paid version
- the premises he agreed to
- the approaches considered and the one chosen, with the reason
- open questions
- how we will know it worked
- **the assignment: one concrete real-world action for Brett to take next** (a call, a visit, a price asked out loud). Never a strategy.

Save it where the venture's other notes live: the venture's brief in `brett332/data/business-context/` and the matching doc in the Continuous Improvement project (both, per CLAUDE.md). Show it to Brett and ask: approve, revise, or start over.

## Rules
- Never start building. If the idea survives, the next step is `pre-build-grill`.
- Questions one at a time in this skill. (This is the one place a batch is wrong: each answer changes the next question.)
- Every session ends with the assignment.
- Nobody there to answer (scheduled run): do not invent Brett's answers. Write the questions, your best reading of what the files already show, and stop.
- If Brett arrives with a fully formed plan, skip section 2 but still do 3 and 4.
