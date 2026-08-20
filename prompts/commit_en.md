---
description: commits repository changes in English following the conventional commits standard
---

CREATING NEW BRANCHES IS NOT ALLOWED, ONLY COMMIT CHANGES ON THE MAIN BRANCH

Audit the pending changes in the repository in detail, then generate a commit, making sure each commit follows the Conventional Commits convention as in the following document:

## Base structure

Every commit must start with a type, followed optionally by a scope, then `:` and a space, and then a short description of the change.[1]
The body goes after a blank line, can have several paragraphs, and the footers go after another blank line.[1]

Template:

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## How to decide

Use `feat` when you add a new functionality, `fix` when you fix a bug, and other types like `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `style` or `perf` when they better describe the intent of the change.[1]
If the change breaks compatibility, you must indicate it with `!` in the header or with a `BREAKING CHANGE:` footer, and that type of change relates to a MAJOR version in SemVer.[1]

Decision flow:

1. Identify the main intent of the change: new functionality, fix, documentation, refactor, tests, build, etc.[1]
2. Decide if you need a scope, e.g. `auth`, `api`, `ui`, `parser` or `lang`; the scope goes between parentheses.[1]
3. Write a brief and clear description, immediately after `:`.[1]
4. Add a body only if you need additional context.[1]
5. Add footers if you need references, reviewers or a `BREAKING CHANGE`.[1]

## Examples from the text

These are the examples from the text, already sorted by use case.[1]

| Case | Example |
|---|---|
| Breaking change in footer | `feat: allow provided config object to extend other configs`<br><br>`BREAKING CHANGE: extends key in config file is now used for extending other config files` [1] |
| Breaking change with `!` | `refactor!: drop support for Node 6` [1] |
| Breaking change with `!` and footer | `refactor!: drop support for Node 6`<br><br>`BREAKING CHANGE: refactor to use JavaScript features not available in Node 6.` [1] |
| Commit without body | `docs: correct spelling of CHANGELOG` [1] |
| Commit with scope | `feat(lang): added polish language` [1] |
| Multi-paragraph body and multiple footers | `fix: correct minor typos in code`<br><br>`see the issue for details`<br><br>`on typos fixed.`<br><br>`Reviewed-by: Z`<br>`Refs #133` [1] |
| Recommended revert | `revert: let us never again speak of the noodle incident`<br><br>`Refs: 676104e, a215868` [1] |

## Practical workflow

First separate the changes by intent, because the specification recommends making multiple commits if a change fits more than one type.[1]
Then draft the header with this formula: `type(scope): description`, and only add a body or footers when they provide real context.[1]

Suggested workflow:

- Step 1: Review what actually changed in your branch and group by intent, e.g. bug, feature, docs or refactor.[1]
- Step 2: Choose a single main type per commit; if you mixed several intents, separate them into several commits.[1]
- Step 3: Define the scope only if it provides useful context, e.g. `api`, `auth`, `lang` or `parser`.[1]
- Step 4: Write a short, specific description with no emojis.
- Step 5: Add a body if you need to explain the why, impact or context of the change.[1]
- Step 6: Add footers for references like `Refs #133`, reviews like `Reviewed-by: Z`, or breaking changes with `BREAKING CHANGE:`.[1]
- Step 7: If you broke compatibility, use `!` or `BREAKING CHANGE:`; you can use both if you want it to be more explicit.[1]

## Final commit

If you want to end with a ready-to-use commit, this workflow produces a message like the following, which respects the specification, uses a scope, adds a body and avoids emojis.[1]

```text
feat(auth): add passwordless login

Adds support for email-based one-time access codes.
Improves first-login flow for users without a stored password.

Refs #241
```

And if that change also broke compatibility, you could leave it like this.[1]

```text
feat(auth)!: add passwordless login

Adds support for email-based one-time access codes.
Removes the previous mandatory password step from the login flow.

BREAKING CHANGE: clients must update the login integration because password submission is no longer required.
```

ALWAYS CONSIDER CREATING COMMITS IN ENGLISH
