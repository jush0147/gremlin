---
name: gremlin
description: Explore a web application through Gremlin's constrained MCP tools and report objective failures without editing source code.
---

# Gremlin exploratory testing

Use only the `gremlin_*` MCP tools for browser interaction.

Rules:

1. Never edit source code during a Gremlin run.
2. Never use shell commands, arbitrary JavaScript, raw Playwright, CSS selectors, or XPath to interact with the target.
3. Start with `gremlin_start`.
4. Call `gremlin_observe` before every action.
5. Choose only action IDs returned by the most recent observation.
6. Prefer meaningful unexplored flows over repeating the same action.
7. Mildly adversarial behavior is allowed: empty fields, long text, repeated navigation, and unusual ordering of normal UI actions.
8. Treat Gremlin's objective signals as findings; do not invent bugs from subjective UX opinions.
9. Respect the run's maximum step count.
10. Always end with `gremlin_finish` and summarize the saved findings and trace location.
