# Task briefs

The optional **Build task brief** tool appears beside the prompt when hiring a worker or asking
one to handle a task, in both the 3D office and the 2D dashboard.

1. Enter your rough request, then click **Build task brief**.
2. Choose **Manual** to write the details yourself, or **Draft with AI**, select an available
   **AI provider**, and click **Generate AI draft**. AI uses your rough request, existing details,
   and any issue/PR context attached by the dialog. Your written details take precedence.
3. Refine the goal, examples, constraints and acceptance criteria. Put uncertain details under
   **Assumptions** or **Open questions**. AI examples are proposals; review them before using them.
4. Click **Preview brief** after manual edits, or review the preview produced by AI. The original
   request is included and the preview is editable.
5. Click **Use brief** to put the draft into the prompt. Review the worker, model and worktree
   choices, then use the existing hire/send button to start the task.

Manual mode makes no model calls. AI mode uses a one-shot Claude Code or Codex process on the
**office server**, including for remote floors. It does not hire a worker or run inside a project
checkout. The request and attached context are sent to the selected provider and may consume its
subscription/API usage. Claude uses the signed-in account's Claude credentials when an account is
in use; Codex uses the office server's Codex sign-in, just like Codex workers. The draft provider is
independent of the provider chosen for the eventual task worker.

Install and sign in to a current supported CLI on the office server to enable that provider. Claude
runs with tools, MCP and user/project settings disabled. Codex runs in a temporary directory using
read-only, ephemeral execution, ignoring user configuration/rules, with shell, patch, multi-agent
and web-search capabilities disabled for the draft. The office passes the prompt over stdin and
validates structured output. See the [Codex non-interactive documentation](https://developers.openai.com/codex/noninteractive)
and [Claude CLI reference](https://code.claude.com/docs/en/cli-reference).

Claude's reported draft usage is added to the office ledger; Codex drafting spend is not metered,
as with Codex workers. The existing budget-pause setting also blocks starting drafts. The office
allows one active draft per account (one for shared-password sessions), up to two across the office.
Generation times out after 90 seconds. **Cancel AI draft**, switching to Manual, or closing the
dialog aborts the request and stops the process. Failures leave the existing details unchanged so
you can retry or continue manually. Unavailable providers show the installation/sign-in reason.

Blank optional sections say **Not specified** instead of guessing. Editing
the fields requires a new preview. Changing the original prompt requires discarding and rebuilding
the draft, so it cannot silently overwrite your newer request. Briefs must fit the worker's 20,000
character prompt limit, including any issue or PR context attached by the dialog.

**Discard brief** preserves your original prompt. Closing the surrounding dialog with ✕ or Esc
discards the draft and returns to the office controls. Simple tasks can skip the builder entirely.
Drafts live only in the current dialog; applying a brief does not start the task. The reviewed brief
is sent through the existing worker flow only after you explicitly hire or send. Existing issue/PR
context and worker choices remain in that flow.
