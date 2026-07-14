import { db, auth } from "./firebase";
import { 
  collection, doc, getDoc, setDoc, updateDoc, 
  onSnapshot, query, addDoc, getDocs, deleteDoc 
} from "firebase/firestore";
import { Room, Player, Question, GameEvent } from "../types";
import { t, TranslationKey } from "../translations";

// Leave room
export async function leaveRoom(roomId: string, playerId: string, lang: 'en' | 'ar') {
  await deleteDoc(doc(db, `rooms/${roomId}/players`, playerId));
  await addGameEvent(roomId, "leave", "playerLeft", lang);
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
export async function createRoom(categoryInput: string, lang: 'en' | 'ar'): Promise<string> {
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
  await addGameEvent(roomId, "system", "roomCreated", lang, { roomId, category: room.category });
  return roomId;
}

// Join a room
export async function joinRoom(roomId: string, playerName: string, lang: 'en' | 'ar'): Promise<Player> {
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
  await addGameEvent(roomId, "join", "playerJoined", lang, { playerName: newPlayer.name });
  
  return newPlayer;
}

// Set secret word
export async function setSecretWord(roomId: string, playerId: string, word: string, lang: 'en' | 'ar') {
  await updateDoc(doc(db, `rooms/${roomId}/players`, playerId), {
    secretWord: word.trim()
  });
  
  const pDoc = await getDoc(doc(db, `rooms/${roomId}/players`, playerId));
  const pName = pDoc.data()?.name || "A player";
  await addGameEvent(roomId, "system", "secretSubmitted", lang, { playerName: pName });
}

// Start game
export async function startGame(roomId: string, players: Player[], lang: 'en' | 'ar') {
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

  await addGameEvent(roomId, "system", "gameStarted", lang, { targetName: targetPlayer?.name || "", askerName: askerPlayer?.name || "" });
}

// Ask question
export async function askQuestion(roomId: string, asker: Player, target: Player, text: string, lang: 'en' | 'ar') {
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
  await addGameEvent(roomId, "question", "questionAsked", lang, { askerName: asker.name, targetName: target.name, questionText: text.trim() });
}

// Answer question
export async function answerQuestion(roomId: string, question: Question, target: Player, answer: 'YES'|'NO'|'MAYBE'|'UNKNOWN', allPlayers: Player[], lang: 'en' | 'ar') {
  await updateDoc(doc(db, `rooms/${roomId}/questions`, question.id), {
    answer
  });

  await addGameEvent(roomId, "answer", "answerGiven", lang, { targetName: target.name, askerName: question.askerName, answer });

  // Under the new game rules, players only get exactly one question and one guess per target round.
  // We do NOT unlock the guesser state here when a question is answered; guessing status is reset only on target change or when a new player's turn starts.
}

// Advance turn
export async function advanceTurn(roomId: string, room: Room, allPlayers: Player[], lang: 'en' | 'ar', targetGuessedOut: boolean = false) {
  const { turnOrder, activeTargetPlayerId, activeAskerPlayerId } = room;
  if (!activeTargetPlayerId || !activeAskerPlayerId) return;

  // Fetch fresh players to ensure we have the latest hasAsked/hasGuessed states
  const playersRef = collection(db, `rooms/${roomId}/players`);
  const playersSnap = await getDocs(playersRef);
  const latestPlayers: Player[] = [];
  playersSnap.forEach(d => latestPlayers.push(d.data() as Player));

  const currentTargetIdx = turnOrder.indexOf(activeTargetPlayerId);
  const currentAskerIdx = turnOrder.indexOf(activeAskerPlayerId);

  // Determine if everyone else has had their turn for this target
  const investigators = latestPlayers.filter(p => p.id !== activeTargetPlayerId);
  const allOtherPlayersFinished = investigators.every(p => p.hasAskedThisRound && p.hasGuessedThisRound);

  let nextTargetId = activeTargetPlayerId;
  let nextAskerId = activeAskerPlayerId;

  if (targetGuessedOut || allOtherPlayersFinished) {
    // Target shifts to the next player who is NOT completed
    let nextTargetIdx = (currentTargetIdx + 1) % turnOrder.length;
    let safeCounter = 0;
    while (latestPlayers.find(p => p.id === turnOrder[nextTargetIdx])?.state === "COMPLETED") {
      nextTargetIdx = (nextTargetIdx + 1) % turnOrder.length;
      safeCounter++;
      if (safeCounter > turnOrder.length) break;
    }
    nextTargetId = turnOrder[nextTargetIdx];

    // Reset all players' guess and ask states for the NEW target
    for (const p of latestPlayers) {
      await updateDoc(doc(db, `rooms/${roomId}/players`, p.id), { 
        hasGuessedThisRound: false,
        hasAskedThisRound: false
      });
    }

    // Set first asker for the new target
    let nextAskerIdx = (nextTargetIdx + 1) % turnOrder.length;
    safeCounter = 0;
    // Asker can be COMPLETED, but cannot be the current target
    while (turnOrder[nextAskerIdx] === nextTargetId) {
      nextAskerIdx = (nextAskerIdx + 1) % turnOrder.length;
      safeCounter++;
      if (safeCounter > turnOrder.length) break;
    }
    nextAskerId = turnOrder[nextAskerIdx];

    const nextTargetPlayer = latestPlayers.find(p => p.id === nextTargetId);
    const nextAskerPlayer = latestPlayers.find(p => p.id === nextAskerId);
    await addGameEvent(roomId, "system", "targetShifted", lang, { targetName: nextTargetPlayer?.name || "", askerName: nextAskerPlayer?.name || "" });
  } else {
    // Just shift the asker, target stays the same
    let nextAskerIdx = (currentAskerIdx + 1) % turnOrder.length;
    let safeCounter = 0;
    // Asker can be COMPLETED, but cannot be the current target
    while (turnOrder[nextAskerIdx] === nextTargetId) {
      nextAskerIdx = (nextAskerIdx + 1) % turnOrder.length;
      safeCounter++;
      if (safeCounter > turnOrder.length) break;
    }
    nextAskerId = turnOrder[nextAskerIdx];
    
    const nextAskerPlayer = latestPlayers.find(p => p.id === nextAskerId);
    await addGameEvent(roomId, "system", "turnPassed", lang, { askerName: nextAskerPlayer?.name || "" });
  }

  await updateDoc(doc(db, "rooms", roomId), {
    activeTargetPlayerId: nextTargetId,
    activeAskerPlayerId: nextAskerId
  });
}

// Submit a guess
export async function submitGuess(roomId: string, guesser: Player, target: Player, guess: string, allPlayers: Player[], room: Room, lang: 'en' | 'ar') {
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
    
    await addGameEvent(roomId, "guess_correct", "guessCorrect", lang, { guesserName: guesser.name, targetName: target.name }, guesser.name);

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
      await addGameEvent(roomId, "complete", "gameOver", lang);
    } else {
      // Advance turn with targetGuessedOut = true
      await advanceTurn(roomId, room, allPlayers, lang, true);
    }

    return { correct: true, explanation: data.explanation };
  } else {
    await updateDoc(doc(db, `rooms/${roomId}/players`, guesser.id), { 
      hasGuessedThisRound: true,
      hasAskedThisRound: true 
    });
    await addGameEvent(roomId, "guess_wrong", "guessWrong", lang, { guesserName: guesser.name, guess, targetName: target.name });
    
    // Asker guessed wrong, turn passes to next person
    await advanceTurn(roomId, room, allPlayers, lang, false);
    
    return { correct: false, explanation: data.explanation };
  }
}

// Pass Turn
export async function passTurn(roomId: string, room: Room, allPlayers: Player[], lang: 'en' | 'ar') {
  const asker = allPlayers.find(p => p.id === room.activeAskerPlayerId);
  if (asker) {
    await updateDoc(doc(db, `rooms/${roomId}/players`, asker.id), { 
      hasGuessedThisRound: true,
      hasAskedThisRound: true 
    });
  }
  await addGameEvent(roomId, "system", "turnPassed", lang, { askerName: asker?.name || "" });
  await advanceTurn(roomId, room, allPlayers, lang, false);
}

// Reset Game
export async function resetGame(roomId: string, players: Player[], lang: 'en' | 'ar') {
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

  await addGameEvent(roomId, "reset", "roomReset", lang);
}

export async function addGameEvent(roomId: string, type: string, messageKey: string, lang: 'en' | 'ar', messageArgs?: Record<string, any>, playerName?: string) {
  const evId = generateDocId();
  const ev: GameEvent = {
    id: evId,
    type,
    timestamp: new Date().toISOString(),
    message: t(messageKey, lang, messageArgs),
    messageKey,
    messageArgs
  };
  if (playerName) {
    ev.playerName = playerName;
  }
  await setDoc(doc(db, `rooms/${roomId}/history`, evId), ev);
}
