// Who is signed in: accounts and invites, people's own sign-ins, and the SSH team.

export type AccountRole = 'admin' | 'member';

/** Who this browser is signed in as. */
export interface Me {
  /** Your own account; missing when you came in with the shared office password. */
  account?: { name: string; role: AccountRole };
  /** May invite, list and revoke accounts. */
  admin: boolean;
}

/** What someone signs in to for their own workers: Claude Code, and a forge's CLI. */
export type SignInKind = 'claude' | 'github' | 'bitbucket';

/** One of your sign-ins, as the office sees it (see server/signins.ts). */
export interface SignInState {
  /** ok: signed in. none: not yet. busy: signing in, or being looked at. */
  status: 'ok' | 'none' | 'busy';
  /** Its own login in your folder on the office's machine, a pasted token, or the machine's own (admins). */
  how: 'login' | 'token' | 'office';
  /** Who it signs in as: an email and plan for Claude, @login for GitHub, a username for Bitbucket. */
  who?: string;
  /** A sign-in under way: the page to open, GitHub's one-time code to type there, and whether Claude's code was sent back. */
  pending?: { url?: string; code?: string; sent?: boolean };
  error?: string;
}

/**
 * Your own Claude and forge sign-ins, which your workers run with and the office acts on the forge
 * with for you. Only accounts have them: on the shared password, the office's own are used.
 */
export interface SignInsState {
  claude: SignInState;
  github: SignInState;
  bitbucket: SignInState;
  /** You may use the office machine's own sign-ins instead of yours (admins). */
  office: boolean;
}

export interface AccountInfo {
  id: string;
  name: string;
  role: AccountRole;
  createdAt: number;
  createdBy: string;
  lastSeenAt?: number;
  /** In the office right now. */
  online: boolean;
}

/** A single-use link that makes a named account: /join#<token>. */
export interface AccountInvite {
  id: string;
  token: string;
  /** The name the account gets; when missing, whoever opens the link picks one. */
  name?: string;
  role: AccountRole;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
}

/** Per-person accounts, for admins (see server/accounts.ts). */
export interface AccountsState {
  accounts: AccountInfo[];
  invites: AccountInvite[];
  /** Whether the shared office password still lets people in. */
  sharedPassword: boolean;
}

/** A one-time code, exchanged for a machine's token. Shown once and expires (see hosts.ts). */
export interface PairingCode {
  code: string;
  expiresAt: number;
  createdAt: number;
  /** Who made it, for the office's own record. */
  createdBy: string;
}

/**
 * A machine that may host floors in this office, as ⚙️ Settings shows it. Carries no token: only a
 * hash of one is ever kept, so this state can go to a browser.
 */
export interface HostState {
  id: string;
  /** Shown wherever a refusal needs to name the machine. */
  name: string;
  owner?: string;
  createdAt: number;
  createdBy: string;
  lastSeenAt?: number;
  /** How many workers this machine will seat across its floors. */
  seats: number;
  /** Whether an automation hire may seat here. A person may always hire. */
  accepting: boolean;
  /** Whether the owner has agreed to what hosting a machine means (no isolation is built). */
  consentedAt?: number;
  revokedAt?: number;
  /** How many floors this machine is serving right now, over its one connection. */
  floors: number;
  online: boolean;
}

export interface TeamMember {
  /** GitHub username (or the name deploy/aws.sh or deploy/azure.sh invited a key file under). */
  name: string;
  keys: number;
}

/** Who may SSH-tunnel into the office. Only offices deployed with deploy/aws.sh or deploy/azure.sh manage this. */
export interface TeamState {
  /** Why invites can't be managed from the office, when they can't. */
  unavailable?: string;
  error?: string;
  /** Where teammates tunnel to: office@203.0.113.7, or ssh://office@host:port off port 22 */
  ssh?: string;
  /** The office's port on the box (tunnel destination). */
  port: number;
  /** How to run the script that deployed the office (deploy/azure.sh, --name and all), for the commands the panel suggests. deploy/aws.sh when unknown. */
  deploy?: string;
  /** SHA256 fingerprint of the box's ED25519 host key, to check on first connect. */
  fingerprint?: string;
  members: TeamMember[];
  /** The office's name on its Tailscale network (e.g. agent-office.tail1234.ts.net): everyone there opens https://<it>. */
  tailnet?: string;
}

export type TeamClientMsg =
  | { t: 'team.get' }
  | { t: 'team.invite'; github: string }
  | { t: 'team.remove'; name: string };

export type AccountsClientMsg =
  /** The rest of the accounts messages are for admins only. */
  | { t: 'accounts.get' }
  | { t: 'accounts.invite'; name?: string; role: AccountRole }
  | { t: 'accounts.cancel'; inviteId: string }
  | { t: 'accounts.revoke'; accountId: string }
  | { t: 'accounts.role'; accountId: string; role: AccountRole }
  /** Let the shared office password sign people in, or stop it. */
  | { t: 'accounts.shared'; on: boolean };

export type SignInsClientMsg =
  /** Your own sign-ins (accounts only): look at them again. */
  | { t: 'signins.get' }
  /** Sign in from the office: it runs the login and hands back the page to open. */
  | { t: 'signins.start'; which: SignInKind }
  /** The code Claude's sign-in page gave you. */
  | { t: 'signins.code'; code: string }
  | { t: 'signins.cancel'; which: SignInKind }
  /** A token instead: from `claude setup-token` (or an Anthropic API key), or a GitHub token. */
  | { t: 'signins.token'; which: SignInKind; token: string }
  /** Use the office machine's own sign-in (admins only). */
  | { t: 'signins.office'; which: SignInKind }
  | { t: 'signins.signout'; which: SignInKind };

export type AccountsServerMsg =
  | { t: 'team'; state: TeamState }
  /** Sent to whoever asked for the invite. */
  | { t: 'team.invited'; github: string; name?: string; keys?: number; error?: string }
  /** Sent to admins, when asked and whenever accounts change. */
  | { t: 'accounts'; state: AccountsState }
  /** ⚙️ Settings → the machines allowed to host floors here, and whether each is connected. */
  | { t: 'hosts'; state: HostState[] }
  /** Sent to whoever made the invite. */
  | { t: 'accounts.invited'; invite?: AccountInvite; error?: string }
  /** Your role changed. */
  | { t: 'me'; me: Me }
  /** Your own sign-ins, whenever they change (accounts only). */
  | { t: 'signins'; state: SignInsState }
  /** What you tried needs a sign-in of your own first. */
  | { t: 'signins.needed'; which: SignInKind; why: string };
