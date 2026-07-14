import { db, auth } from "./firebase";
import { 
  collection, doc, getDoc, setDoc, updateDoc, 
  onSnapshot, query, addDoc, getDocs, deleteDoc 
} from "firebase/firestore";
import { Room, Player, Question, GameEvent } from "../types";

// Leave room
export async function leaveRoom(roomId: string, playerId: string) {
  await deleteDoc(doc(db, `rooms/${roomId}/players`, playerId));
  await addGameEvent(roomId, "leave", `🚪 A player has left the room.`);
}

// Generates a random room code
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9).toUpperCase();
}

// Generate an ID for sub-docs
export function generateDocId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Create a new room
export async function createRoom(categoryInput: string): Promise<string> {
  const roomId = generateId();
  if (!auth.currentUser) throw new Error("Not authenticated");
  
  const room: Room = {
    id: roomId,
    status: "lobby",
    activeTargetPlayerId: null,
    activeAskerPlayerId: null,
    turnOrder: [],
    winnerId: null,
    category: categoryInput || "General Words",
    leaderId: auth.currentUser.uid,
    createdAt: new Date().toISOString()
  };

  await setDoc(doc(db, "rooms", roomId), room);
  await addGameEvent(roomId, "system", `Room ${roomId} created with category: ${room.category}`);
  return roomId;
}

// Join a room
export async function joinRoom(roomId: string, playerName: string): Promise<Player> {
  if (!auth.currentUser) throw new Error("Not authenticated");
  const uid = auth.currentUser.uid;

  const roomRef = doc(db, "rooms", roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) throw new Error("Room not found");
  
  const room = roomSnap.data() as Room;
  if (room.status !== "lobby") throw new Error("Game already in progress");

  // Check if player already in room
  const playersRef = collection(db, `rooms/${roomId}/players`);
  const playersSnap = await getDocs(playersRef);
  let existingPlayer = null;
  playersSnap.forEach(doc => {
    const p = doc.data() as Player;
    if (p.uid === uid) existingPlayer = p;
  });

  if (existingPlayer) return existingPlayer;

  const newPlayer: Player = {
    id: uid,
    uid: uid,
    name: playerName.trim(),
    secretWord: "",
    state: "ACTIVE",
    score: 0,
    hasGuessedThisRound: false,
    hasAskedThisRound: false,
    joinedAt: new Date().toISOString()
  };

  await setDoc(doc(db, `rooms/${roomId}/players`, uid), newPlayer);
  await addGameEvent(roomId, "join", `👋 ${newPlayer.name} joined the room!`);
  
  return newPlayer;
}

// Set secret word
export async function setSecretWord(roomId: string, playerId: string, word: string) {
  await updateDoc(doc(db, `rooms/${roomId}/players`, playerId), {
    secretWord: word.trim()
  });
  
  const pDoc = await getDoc(doc(db, `rooms/${roomId}/players`, playerId));
  const pName = pDoc.data()?.name || "A player";
  await addGameEvent(roomId, "system", `🤫 ${pName} has submitted their secret word!`);
}

// Start game
export async function startGame(roomId: string, players: Player[]) {
  if (players.length < 2) throw new Error("Need at least 2 players");
  
  const activePlayers = players.filter(p => !!p.secretWord);
  if (activePlayers.length < players.length) throw new Error("All players must set their secret words!");

  // The turn order will just be the active players
  const turnOrder = activePlayers.map(p => p.id);
  const firstTargetId = turnOrder[0];
  const firstAskerId = turnOrder[1 % turnOrder.length];

  for (const p of players) {
    await updateDoc(doc(db, `rooms/${roomId}/players`, p.id), {
      hasGuessedThisRound: false,
      hasAskedThisRound: false,
      state: "ACTIVE"
    });
  }

  await updateDoc(doc(db, "rooms", roomId), {
    status: "playing",
    activeTargetPlayerId: firstTargetId,
    activeAskerPlayerId: firstAskerId,
    turnOrder: turnOrder,
    winnerId: null
  });

  const targetPlayer = activePlayers.find(p => p.id === firstTargetId);
  const askerPlayer = activePlayers.find(p => p.id === firstAskerId);

  await addGameEvent(roomId, "system", `🚀 The game has started! Target: ${targetPlayer?.name}'s secret word. ${askerPlayer?.name} goes first.`);
}

// Ask question
export async function askQuestion(roomId: string, asker: Player, target: Player, text: string) {
  if (asker.hasAskedThisRound) throw new Error("You have already asked a question this turn!");

  const qId = generateDocId();
  const q: Question = {
    id: qId,
    askerId: asker.id,
    askerName: asker.name,
    text: text.trim(),
    answer: "PENDING",
    timestamp: new Date().toISOString()
  };

  await setDoc(doc(db, `rooms/${roomId}/questions`, qId), q);
  await updateDoc(doc(db, `rooms/${roomId}/players`, asker.id), { hasAskedThisRound: true });
  await addGameEvent(roomId, "question", `❓ ${asker.name} asked ${target.name}: "${text.trim()}"`);
}

// Answer question
export async function answerQuestion(roomId: string, question: Question, target: Player, answer: 'YES'|'NO'|'MAYBE'|'UNKNOWN', allPlayers: Player[]) {
  await updateDoc(doc(db, `rooms/${roomId}/questions`, question.id), {
    answer
  });

  await addGameEvent(roomId, "answer", `📢 ${target.name} answered ${question.askerName}'s question with: "${answer}"`);

  // Under the new game rules, players only get exactly one question and one guess per target round.
  // We do NOT unlock the guesser state here when a question is answered; guessing status is reset only on target change or when a new player's turn starts.
}

// Advance turn
export async function advanceTurn(roomId: string, room: Room, allPlayers: Player[], targetGuessedOut: boolean = false) {
  const { turnOrder, activeTargetPlayerId, activeAskerPlayerId } = room;
  if (!activeTargetPlayerId || !activeAskerPlayerId) return;

  const currentTargetIdx = turnOrder.indexOf(activeTargetPlayerId);
  const currentAskerIdx = turnOrder.indexOf(activeAskerPlayerId);

  // Target ALWAYS shifts to the next player who is NOT completed
  let nextTargetIdx = (currentTargetIdx + 1) % turnOrder.length;
  let safeCounter = 0;
  while (allPlayers.find(p => p.id === turnOrder[nextTargetIdx])?.state === "COMPLETED") {
    nextTargetIdx = (nextTargetIdx + 1) % turnOrder.length;
    safeCounter++;
    if (safeCounter > turnOrder.length) break; // Game over essentially
  }

  // Asker shifts to the next player after the current asker
  let nextAskerIdx = (currentAskerIdx + 1) % turnOrder.length;
  
  safeCounter = 0;
  // Asker can't be the same as target
  while (nextAskerIdx === nextTargetIdx) {
    nextAskerIdx = (nextAskerIdx + 1) % turnOrder.length;
    safeCounter++;
    if (safeCounter > turnOrder.length) break;
  }

  const newTargetId = turnOrder[nextTargetIdx];
  const newAskerId = turnOrder[nextAskerIdx];

  await updateDoc(doc(db, "rooms", roomId), {
    activeTargetPlayerId: newTargetId,
    activeAskerPlayerId: newAskerId
  });

  const nextTargetPlayer = allPlayers.find(p => p.id === newTargetId);
  const nextAskerPlayer = allPlayers.find(p => p.id === newAskerId);

  // Reset all players' guess and ask states for the new turn/target
  for (const p of allPlayers) {
    await updateDoc(doc(db, `rooms/${roomId}/players`, p.id), { 
      hasGuessedThisRound: false,
      hasAskedThisRound: false
    });
  }
  await addGameEvent(roomId, "system", `🔄 Target shifts to ${nextTargetPlayer?.name}'s secret word! ${nextAskerPlayer?.name} starts the questioning.`);
}

// Submit a guess
export async function submitGuess(roomId: string, guesser: Player, target: Player, guess: string, allPlayers: Player[], room: Room) {
  if (guesser.hasGuessedThisRound) throw new Error("You already made a guess!");

  // Safe and clean relative URL fetch
  const url = "/api/gemini/evaluate-guess";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetName: target.secretWord, guess, category: room.category })
  });
  
  const data = await res.json();

  if (data.isMatch) {
    await updateDoc(doc(db, `rooms/${roomId}/players`, target.id), { state: "COMPLETED" });
    await updateDoc(doc(db, `rooms/${roomId}/players`, guesser.id), { score: guesser.score + 10 });
    
    await addGameEvent(roomId, "guess_correct", `🎉 ${guesser.name} discovered ${target.name}'s word!`, guesser.name);

    const activeTargets = allPlayers.filter(p => p.state === "ACTIVE" && p.id !== target.id);
    if (activeTargets.length === 0) {
      // Game over logic
      let highestScore = -1;
      let winnerId = null;
      for (const p of allPlayers) {
        let finalScore = p.score;
        if (p.id === guesser.id) finalScore += 10;
        if (finalScore > highestScore) {
          highestScore = finalScore;
          winnerId = p.id;
        }
      }

      await updateDoc(doc(db, "rooms", roomId), {
        status: "ended",
        activeTargetPlayerId: null,
        activeAskerPlayerId: null,
        winnerId
      });
      await addGameEvent(roomId, "complete", `🏆 Game Over!`);
    } else {
      // Advance turn with targetGuessedOut = true
      await advanceTurn(roomId, room, allPlayers, true);
    }

    return { correct: true, explanation: data.explanation };
  } else {
    await updateDoc(doc(db, `rooms/${roomId}/players`, guesser.id), { hasGuessedThisRound: true });
    await addGameEvent(roomId, "guess_wrong", `❌ ${guesser.name} guessed "${guess}" for ${target.name}'s word, but it's WRONG.`);
    
    // Asker guessed wrong, turn passes to next person
    await advanceTurn(roomId, room, allPlayers, false);
    
    return { correct: false, explanation: data.explanation };
  }
}

// Pass Turn
export async function passTurn(roomId: string, room: Room, allPlayers: Player[]) {
  const asker = allPlayers.find(p => p.id === room.activeAskerPlayerId);
  await addGameEvent(roomId, "system", `⏭️ ${asker?.name} passed their guess.`);
  await advanceTurn(roomId, room, allPlayers, false);
}

// Reset Game
export async function resetGame(roomId: string, players: Player[]) {
  await updateDoc(doc(db, "rooms", roomId), {
    status: "lobby",
    activeTargetPlayerId: null,
    activeAskerPlayerId: null,
    turnOrder: [],
    winnerId: null
  });

  for (const p of players) {
    await updateDoc(doc(db, `rooms/${roomId}/players`, p.id), {
      state: "ACTIVE",
      score: 0,
      hasGuessedThisRound: false,
      hasAskedThisRound: false,
      secretWord: ""
    });
  }

  // Clear questions
  const qSnap = await getDocs(collection(db, `rooms/${roomId}/questions`));
  for (const q of qSnap.docs) {
    await deleteDoc(q.ref);
  }

  await addGameEvent(roomId, "reset", "🔄 Room has been reset. Back to lobby!");
}

export async function addGameEvent(roomId: string, type: string, message: string, playerName?: string) {
  const evId = generateDocId();
  const ev: GameEvent = {
    id: evId,
    type,
    timestamp: new Date().toISOString(),
    message
  };
  if (playerName) {
    ev.playerName = playerName;
  }
  await setDoc(doc(db, `rooms/${roomId}/history`, evId), ev);
}
