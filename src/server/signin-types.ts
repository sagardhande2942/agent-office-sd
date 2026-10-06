import type { ForgeKind,SignInKind,SignInState } from '../shared/protocol.js';


/*
 * Everyone's own Claude and forges
 * -------------------------------
 * In an office with accounts, each person's workers run on that person's own Claude plan, and the
 * office acts on their code host as them rather than as the machine. Every account gets a folder,
 * .agent-office/homes/<id>/, holding its own Claude config (CLAUDE_CONFIG_DIR), gh config
 * (GH_CONFIG_DIR), bb config (BB's own home, see bitbucketEnv) and git config (GIT_CONFIG_GLOBAL),
 * and whatever runs for that account gets those in its environment in place of the office's: its
 * workers, and what the office does on the forge when they click (comment, merge, open a PR).
 * Nothing global changes, so any number of people can be signed in to different accounts at once.
 *
 * Signing in happens from the office: it runs `claude auth login` or `gh auth login --web` against
 * the account's folders and hands the browser the page to open (and GitHub's one-time code). A
 * token from `claude setup-token`, a GitHub token or a Bitbucket API token can be pasted instead,
 * and a shell at a desk runs with the same folders, so `claude auth login` typed there works too.
 * Admins may keep using the office machine's own sign-ins.
 *
 * An office without accounts (you alone, on the shared password) never comes here: everything runs
 * on the machine's own `claude`, `gh` and `bb`, exactly as before.
 */

/** Credentials the office's own environment may carry. None of them reach anything run as someone else. */
export const CLAUDE_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR'];

export const GITHUB_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'GIT_CONFIG_GLOBAL'];

/** bb keeps no configuration directory variable: it reads $BB_USERNAME and $BB_API_TOKEN when logging in, and nothing else. */
export const BITBUCKET_VARS = ['BB_USERNAME', 'BB_API_TOKEN', 'BB_WORKSPACE', 'BB_API_BASE_URL', 'GIT_CONFIG_GLOBAL'];

/** GitHub's one-time codes last 15 minutes; a Claude sign-in link gets as long. */
export const FLOW_MS = 15 * 60_000;

/** Someone's sign-ins are looked at again at most this often, unless they ask. */
export const LOOK_GAP_MS = 20_000;

export const LOOK_TIMEOUT_MS = 30_000;

/** From `claude setup-token` (sk-ant-oat01-…), or an Anthropic API key (sk-ant-api03-…). */
export const CLAUDE_TOKEN = /^sk-ant-[a-z]+\d*-[A-Za-z0-9_-]{20,}$/;

export const API_KEY = /^sk-ant-api/;

/** ghp_…, github_pat_…, gho_… and the like. */
export const GITHUB_TOKEN = /^[A-Za-z0-9_]{20,255}$/;

/** Atlassian API tokens: ATBB…, and the older ATATT… app passwords. */
export const BITBUCKET_TOKEN = /^(ATBB|ATATT)[A-Za-z0-9_-]{16,}$/;

export const ACCOUNT_ID = /^[A-Za-z0-9]{6,64}$/;

/** A Bitbucket username, as bb's --username takes it. */
export const BITBUCKET_USER = /^[A-Za-z0-9._-]{1,64}$/;

export const HELP_WHERE = '☰ → 🔐 Your sign-ins';


export interface Saved {
  /** Unset: its own login, in its folder. A token pasted from `claude setup-token` (or an API key). The office machine's own (admins). */
  claude?: { use: 'token'; token: string } | { use: 'office' };
  github?: { use: 'office' };
  /** bb has no browser flow the office can hand out, so a Bitbucket sign-in is a pasted token. */
  bitbucket?: { use: 'token'; token: string; username: string } | { use: 'office' };
  /** Who the last look found each signed in as, so workers can start before the next look. */
  seen?: { claude?: string; github?: string; bitbucket?: string };
}


/** A sign-in the office is running for someone. */
export interface Flow {
  stop(): void;
  /** Types into it: the code from Claude's sign-in page. */
  write?(data: string): void;
}


export interface Live {
  claude: Omit<SignInState, 'how'>;
  github: Omit<SignInState, 'how'>;
  bitbucket: Omit<SignInState, 'how'>;
  flows: Partial<Record<SignInKind, Flow>>;
  looking?: Promise<void>;
  lookedAt: number;
}


/** Whose forge CLI the office runs for someone: their own sign-in's environment. */
export interface ForgeAs {
  /** Who the sign-in belongs to (`key` tells logins apart). */
  key: string;
  /** Which forge it signs in to. */
  kind: ForgeKind;
  /** Who it is, so comments from the office can be shown under that name. */
  name: string;
  env: Record<string, string>;
}
