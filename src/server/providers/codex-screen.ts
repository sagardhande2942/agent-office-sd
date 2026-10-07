/** Only visible Codex onboarding prompts justify an input alert without authenticated hooks. */
export function codexBlocked(text: string): string | undefined {
  const lines = text.split(/\r?\n/).slice(-24).join('\n');
  // A ready prompt or completed turn takes precedence over onboarding left in scrollback.
  if (/^\s*[›>]\s*(?:Ask Codex|Explain this codebase|Implement|Find and fix|Write tests|Summarize recent commits)/im.test(lines)) return;
  if (/^\s*Do you trust the contents of this directory\?/im.test(lines)) return 'Open the terminal: review the directory trust prompt';
  if (/^\s*(?:How would you like to authenticate\?|Sign in to Codex|Welcome to Codex)/im.test(lines) && /Sign in with ChatGPT|API key|device code/i.test(lines)) return 'Open the terminal: complete Codex sign-in';
  return;
}
