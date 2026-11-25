export type CharacterRole =
  | "mafia_boss"
  | "mafia_silencer"
  | "hospital"
  | "good_citizen";

export type PlayerStatus = "alive" | "eliminated";

export type RoomPermission = "host" | "player";

export type GamePhase =
  | "lobby"
  | "role_reveal"
  | "first_day_intro"
  | "night_boss"
  | "night_silencer"
  | "night_hospital"
  | "night_results"
  | "day_discussion"
  | "voting"
  | "vote_result"
  | "victory";

export interface Player {
  id: string;
  name: string;
  permission: RoomPermission;
  role: CharacterRole;
  status: PlayerStatus;
  isSilencedToday: boolean;
  hasConfirmedRole: boolean;
}

export interface NightActions {
  killTargetId: string | null;
  silenceTargetId: string | null;
  protectTargetId: string | null;
}

export interface NightOutcome {
  eliminatedPlayerId: string | null;
  eliminatedPlayerName: string | null;
  eliminatedPlayerRole: CharacterRole | null;
  wasProtected: boolean;
  silencedPlayerId: string | null;
  silencedPlayerName: string | null;
  summaryLines: string[];
}

export interface VoteOutcome {
  eliminatedPlayerId: string | null;
  eliminatedPlayerName: string | null;
  eliminatedPlayerRole: CharacterRole | null;
  message: string;
}

export type WinningTeam = "mafia" | "citizens";

export interface VictoryState {
  winner: WinningTeam;
  reason: string;
}

export interface RoomState {
  roomCode: string;
  phase: GamePhase;
  dayNumber: number;
  players: Record<string, Player>;
  nightActions: NightActions;
  nightOutcome: NightOutcome | null;
  voteTargetId: string | null;
  voteOutcome: VoteOutcome | null;
  victoryState: VictoryState | null;
}