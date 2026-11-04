# Codex project setup

The owner asked future ERPNext work to retain the approved Product Catalog and Product
Detail direction. The canonical files below live in this Git repository so they can be
versioned with the app. This setup does not change global Codex preferences or permissions.

## Files and purpose

- `AGENTS.md`: persistent project direction, business invariants, implementation references,
  and proportionate verification expectations.
- `.agents/skills/erpnext-simple-desk/SKILL.md`: reusable workflow for internal Desk UI
  simplification, interviews, implementation, and review within the requested scope.
- `.agents/skills/erpnext-simple-desk/references/design-standard.md`: visual and interaction preferences.
- `.agents/skills/erpnext-simple-desk/references/product-rules.md`: settled product/business decisions.
- `.codex/agents/erpnext-ui-reviewer.toml`: focused UI review role.
- `.codex/agents/erpnext-data-reviewer.toml`: focused metric and permission review role.

The reviewers are instructed to work without edits. That is a role instruction, not a
separate permission sandbox: custom agents inherit their parent session's permissions.
Use them only when delegation is allowed and the task benefits from their review.

## Use

Start a new Codex session in this app repository, or in the parent bench after its local
discovery links are present. Restart an existing session if its instruction/skill list is stale.
`AGENTS.md` supplies persistent context; the skill is eligible for automatic selection
on matching ERPNext UI work. It can also be invoked explicitly:

```text
Use $erpnext-simple-desk to improve Supplier Hub using our approved ERPNext style.
```

For an advisory task, say review or interview. For implementation, ask for the change.
The skill preserves that distinction and does not re-ask the settled product questions.

When a delegated review is useful and permitted:

```text
Have erpnext_ui_reviewer review the screen and erpnext_data_reviewer check the changed
financial summaries. Report findings before making further changes.
```

## Bench discovery links

The parent bench is not this Git repository. Its local `AGENTS.md` routes ERPNext work
here. The following local links make the same skill/agents discoverable from that entrypoint:

```text
<bench>/.agents/skills/erpnext-simple-desk -> ../../apps/erpnext/.agents/skills/erpnext-simple-desk
<bench>/.codex/agents -> ../apps/erpnext/.codex/agents
```

Targets are relative to the containing directory. These bench links and its routing
`AGENTS.md` are local setup, not files tracked by the app repository. On another machine,
starting Codex directly in the app repository avoids needing those bench-level links.

## Maintenance and validation

Update the relevant reference when the owner explicitly changes a preference. Keep
durable decisions separate from temporary screenshots, test products, service names,
or runtime credentials. Avoid maintaining duplicate rule sets in CODEX.md or CLAUDE.md.

After changing skill metadata, use the installed skill-creator's `scripts/quick_validate.py`
on the skill directory. Parse custom agent TOML and check Markdown links and bench symlink
targets. Syntax/discovery checks do not prove that a future task will be executed correctly.

Official format references:

- [Project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Skills and repository discovery](https://learn.chatgpt.com/docs/build-skills)
- [Custom reviewer agents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
