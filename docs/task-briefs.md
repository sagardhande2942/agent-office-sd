# Task briefs

The optional **Build task brief** tool appears beside the prompt when hiring a worker or asking
one to handle a task, in both the 3D office and the 2D dashboard.

1. Enter your rough request, then click **Build task brief**.
2. Refine the goal. Add examples and constraints where they matter, and at least one observable
   acceptance criterion. Put uncertain details under **Assumptions** or **Open questions**.
3. Click **Preview brief**. Review and edit the resulting text; the original request is included.
4. Click **Use brief** to put the draft into the prompt. Review the worker, model and worktree
   choices, then use the existing hire/send button to start the task.

This is a guided editor, not AI generation. It makes no model calls, starts no worker, and does not
inspect project files. Blank optional sections say **Not specified** instead of guessing. Editing
the fields requires a new preview. Changing the original prompt requires discarding and rebuilding
the draft, so it cannot silently overwrite your newer request. Briefs must fit the worker's 20,000
character prompt limit, including any issue or PR context attached by the dialog.

**Discard brief** preserves your original prompt. Closing the surrounding dialog with ✕ or Esc
discards the draft and returns to the office controls. Simple tasks can skip the builder entirely.
Drafts live only in the current dialog; they are sent through the existing worker flow only after
you explicitly hire or send. Existing issue/PR context and worker choices remain in that flow.
