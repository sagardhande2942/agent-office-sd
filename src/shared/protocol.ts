import type { CodingAgentsClientMsg, CodingAgentsServerMsg } from './protocol/coding-agents.js';
export * from './protocol/coding-agents.js';
import type { WorldsClientMsg, WorldsServerMsg } from './protocol/parallel-worlds.js';
import type { PlacementClientMsg, PlacementServerMsg } from './protocol/object-placement.js';
export * from './protocol/object-placement.js';
export * from './protocol/parallel-worlds.js';
import type { MasterWorkersClientMsg, MasterWorkersServerMsg } from './protocol/master-workers.js';
export * from './protocol/master-workers.js';

import type { AppearanceClientMsg, AppearanceServerMsg } from './protocol/appearances.js';
export * from './protocol/appearances.js';
import type { PlanReviewClientMsg, PlanReviewServerMsg } from './protocol/plan-review.js';
export * from './protocol/plan-review.js';
import type { TvClientMsg } from './protocol/toys.js';
import type { CinemaClientMsg, CinemaServerMsg } from './protocol/cinema.js';
// Wire protocol between browser and server. Every WebSocket frame is one JSON object.
//
// Each part of the office keeps its state types and its messages in ./protocol/<domain>.ts; this
// file puts them back together, so everything is still imported from here, and makes the two
// unions every frame is one of.

import type { AccountsClientMsg, AccountsServerMsg, SignInsClientMsg, TeamClientMsg } from './protocol/accounts.js';
import type { ChangesClientMsg, ChangesServerMsg } from './protocol/changes.js';
import type { FloorClientMsg, FloorServerMsg, PlanClientMsg } from './protocol/floors.js';
import type { GitHubClientMsg, GitHubServerMsg } from './protocol/github.js';
import type { MeetingClientMsg, MeetingServerMsg } from './protocol/meetings.js';
import type { PresenceClientMsg, PresenceServerMsg } from './protocol/presence.js';
import type { QueueClientMsg, QueueServerMsg } from './protocol/queue.js';
import type { RooftopClientMsg, RooftopServerMsg } from './protocol/rooftop.js';
import type { SettingsClientMsg, SettingsServerMsg } from './protocol/settings.js';
import type { BallClientMsg, CabinetClientMsg, CarClientMsg, DecorClientMsg, DogClientMsg, JukeboxClientMsg, ToysServerMsg, WhiteboardClientMsg } from './protocol/toys.js';
import type { UsageClientMsg, UsageServerMsg } from './protocol/usage.js';
import type { WorkerClientMsg, WorkerServerMsg } from './protocol/workers.js';
import type { CommunicationsServerMsg } from './protocol/communications.js';

export * from './protocol/accounts.js';
export * from './protocol/agents.js';
export * from './protocol/changes.js';
export * from './protocol/floors.js';
export * from './protocol/github.js';
export * from './protocol/meetings.js';
export * from './protocol/presence.js';
export * from './protocol/queue.js';
export * from './protocol/rooftop.js';
export * from './protocol/settings.js';
export * from './protocol/toys.js';
export * from './protocol/usage.js';
export * from './protocol/workers.js';
export * from './protocol/communications.js';
export * from './protocol/cinema.js';

export type ClientMsg =
  | CodingAgentsClientMsg
  | PlacementClientMsg
  | WorldsClientMsg
  | MasterWorkersClientMsg

  | AppearanceClientMsg
  | PlanReviewClientMsg
  | TvClientMsg
  | CinemaClientMsg
  | PresenceClientMsg
  | RooftopClientMsg
  | WorkerClientMsg
  | GitHubClientMsg
  | QueueClientMsg
  | MeetingClientMsg
  | FloorClientMsg
  | PlanClientMsg
  | ChangesClientMsg
  | TeamClientMsg
  | AccountsClientMsg
  | SignInsClientMsg
  | SettingsClientMsg
  | UsageClientMsg
  | DecorClientMsg
  | JukeboxClientMsg
  | CabinetClientMsg
  | WhiteboardClientMsg
  | BallClientMsg
  | CarClientMsg
  | DogClientMsg;

export type ServerMsg =
  | CodingAgentsServerMsg
  | PlacementServerMsg
  | WorldsServerMsg
  | MasterWorkersServerMsg

  | AppearanceServerMsg
  | PlanReviewServerMsg
  | CommunicationsServerMsg
  | PresenceServerMsg
  | RooftopServerMsg
  | WorkerServerMsg
  | GitHubServerMsg
  | QueueServerMsg
  | MeetingServerMsg
  | FloorServerMsg
  | ChangesServerMsg
  | AccountsServerMsg
  | SettingsServerMsg
  | UsageServerMsg
  | ToysServerMsg
  | CinemaServerMsg;
