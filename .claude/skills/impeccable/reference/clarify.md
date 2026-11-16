# Clarify: interface wording

<!-- From pbakaus/impeccable skill/reference/clarify.md at d41d9860 (Apache-2.0). Trimmed for RidgeCo: the closing hand-off line removed; otherwise close to the original. -->

Rewrite unclear interface text so people understand what happened, what matters and what to do next. Keep the facts, the product's own terms and its voice.

## Audit the language

Read the whole path, not isolated strings. Look for:

- ambiguous nouns, verbs and actions;
- internal jargon or assumed knowledge;
- vague labels, outcomes and states;
- missing consequences, recovery or timing;
- inconsistent terms and capitalization;
- redundant headings, intros, helper text and confirmations;
- text that breaks at real widths or in translation;
- tone that ignores stress, risk, success or urgency.

Ask before changing a factual claim, a legal meaning, or a term that may be specific to the trade.

## Set the message hierarchy

For each state decide:

1. the one fact the person needs now;
2. the action available next;
3. supporting context that changes the decision;
4. the right tone for this moment.

Say each idea once. If the heading already explains the state, the line under it adds something new or goes.

## Rewrite by function

**Actions and navigation.** A specific verb and object when the outcome is not obvious. A label describes what will happen, not the gesture. The same noun and verb for the same thing everywhere. For destructive actions, name the object and the consequence. Prefer undo over a confirmation when recovery is safe. When a confirmation is needed, name the action on the message and on the button; never `Yes`, `No`, `OK` or `Submit`.

**Forms.** Labels stay visible; placeholders are examples, not labels. Format and eligibility rules come before submission. Say why something is asked only when it is not obvious. Validation says what needs attention and how to correct it, without blaming the person, next to the field.

**Errors and permissions.** An actionable error answers: what failed; why, when known and useful; how to recover or what else can be done. No internal codes as the main message. Do not promise a cause or a fix the system cannot know. Treat privacy, payment, deletion, lost access and blocked work seriously; warmth is welcome, jokes are not.

**Loading, empty and success.** Loading text names the real operation. Never invent progress. An empty state distinguishes first use, no results, filters, permissions and failure, and offers the next useful action. Success confirms the outcome and mentions what happens next only when it changes what the person should do. Routine success is brief.

**Help text.** Answers the unspoken question instead of restating the control. Link text makes sense out of context. Icon-only controls need names.

## Voice, accessibility and translation

Voice stays the same; tone adapts to the moment. Plain language, without flattening terms the audience really uses.

- Whole translatable messages, not glued fragments.
- Variables and numbers structured so a translator can reorder them.
- Allow text to grow instead of abbreviating early.
- Alt text conveys the image's information; empty alt for decoration.
- Screen-reader names match the visible labels.
- Do not let punctuation, color or an icon carry the message alone.

Do not vary words for effect. One thing, one name.

## Verify

Read the flow in context and test:

- understood without hidden product knowledge;
- actionable at errors, empty states and decision points;
- accurate, with consistent terms;
- scannable at the target widths and at 200% zoom;
- long names, translated text, plurals and live values;
- names and announced changes for screen readers;
- tone that fits the consequence.

The final copy is as short as it can be without removing meaning or recovery.
