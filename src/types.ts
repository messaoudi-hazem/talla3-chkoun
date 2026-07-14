export interface Player {
  id: string; // The subcollection doc ID
  uid: string; // Firebase Auth UID
  name: string;
  secretWord: string;
  state: "ACTIVE" | "COMPLETED";
  score: number;
  hasGuessedThisRound: boolean;
  hasAskedThisRound: boolean;
  joinedAt: string;
}

export interface Question {
  id: string; // Subcollection doc ID
  askerId: string;
  askerName: string;
  text: string;
  answer: "YES" | "NO" | "PENDING";
  timestamp: string;
}

export interface GameEvent {
  id: string; // Subcollection doc ID
  type: string;
  timestamp: string;
  message: string;
  messageKey?: string;
  messageArgs?: Record<string, any>;
  playerName?: string;
  payload?: any;
}

export interface Room {
  id: string; // Document ID (the room code)
  status: "lobby" | "playing" | "ended";
  activeTargetPlayerId: string | null;
  activeAskerPlayerId: string | null;
  turnOrder: string[];
  winnerId: string | null;
  winners?: string[];
  category: string;
  leaderId: string; // UID of the room creator
  createdAt: string;
}
