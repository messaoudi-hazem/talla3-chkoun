import { db, auth } from "./firebase";
import { 
  collection, doc, getDoc, setDoc, updateDoc, 
  onSnapshot, query, addDoc, getDocs, deleteDoc 
} from "firebase/firestore";
import { Room, Player, Question, GameEvent } from "../types";

// Generates a random room code
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9).toUpperCase();
}

// Generate an ID for sub-docs
export function generateDocId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Create a new room
export async function createRoom(categoryId: string): Promise<string> {
  const roomId = generateId();
  if (!auth.currentUser) throw new Error("Not authenticated");
  
  const room: Room = {
    id: roomId,
    status: "lobby",
    activeTargetPlayerId: null,
    winnerId: null,
    category: categoryId || "Tunisian Celebrities",
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
    secretCharacter: "",
    state: "ACTIVE",
    score: 0,
    hasGuessedThisRound: false,
    joinedAt: new Date().toISOString()
  };

  await setDoc(doc(db, `rooms/${roomId}/players`, uid), newPlayer);
  await addGameEvent(roomId, "join", `👋 ${newPlayer.name} joined the room!`);
  
  return newPlayer;
}

// Set secret character
export async function setSecretCharacter(roomId: string, playerId: string, character: string) {
  await updateDoc(doc(db, `rooms/${roomId}/players`, playerId), {
    secretCharacter: character.trim()
  });
  
  const pDoc = await getDoc(doc(db, `rooms/${roomId}/players`, playerId));
  const pName = pDoc.data()?.name || "A player";
  await addGameEvent(roomId, "system", `🤫 ${pName} has submitted their secret character!`);
}

// Start game
export async function startGame(roomId: string, players: Player[]) {
  if (players.length < 2) throw new Error("Need at least 2 players");
  
  const activePlayers = players.filter(p => !!p.secretCharacter);
  if (activePlayers.length < players.length) throw new Error("All players must set their secret characters!");

  const firstTarget = activePlayers[0];

  await updateDoc(doc(db, "rooms", roomId), {
    status: "playing",
    activeTargetPlayerId: firstTarget.id,
    winnerId: null
  });

  await addGameEvent(roomId, "system", `🚀 The game has started! Target: ${firstTarget.name}'s secret character is first.`);
}

// Ask question
export async function askQuestion(roomId: string, asker: Player, target: Player, text: string) {
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
  await addGameEvent(roomId, "question", `❓ ${asker.name} asked ${target.name}: "${text.trim()}"`);
}

// Answer question
export async function answerQuestion(roomId: string, question: Question, target: Player, answer: 'YES'|'NO'|'MAYBE'|'UNKNOWN', allPlayers: Player[]) {
  await updateDoc(doc(db, `rooms/${roomId}/questions`, question.id), {
    answer
  });

  await addGameEvent(roomId, "answer", `📢 ${target.name} answered ${question.askerName}'s question with: "${answer}"`);

  // Unlocking guesses
  for (const p of allPlayers) {
    if (p.hasGuessedThisRound) {
      await updateDoc(doc(db, `rooms/${roomId}/players`, p.id), { hasGuessedThisRound: false });
    }
  }
}

// Submit a guess
export async function submitGuess(roomId: string, guesser: Player, target: Player, guess: string, allPlayers: Player[]) {
  if (guesser.hasGuessedThisRound) throw new Error("You already made a guess!");

  const res = await fetch(`/api/gemini/evaluate-guess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetName: target.secretCharacter, guess, category: "Game Characters" }) // Defaulting to the category from the room would be better, but we don't have room context here directly. Let's pass it from UI if needed.
  });
  
  const data = await res.json();

  if (data.isMatch) {
    await updateDoc(doc(db, `rooms/${roomId}/players`, target.id), { state: "COMPLETED" });
    await updateDoc(doc(db, `rooms/${roomId}/players`, guesser.id), { score: guesser.score + 10 });
    
    await addGameEvent(roomId, "guess_correct", `🎉 ${guesser.name} discovered ${target.name}'s character!`, guesser.name);

    // Unlocks guessing locks
    for (const p of allPlayers) {
      if (p.hasGuessedThisRound) {
        await updateDoc(doc(db, `rooms/${roomId}/players`, p.id), { hasGuessedThisRound: false });
      }
    }

    const activeTargets = allPlayers.filter(p => p.state === "ACTIVE" && p.id !== target.id);
    if (activeTargets.length === 0) {
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
        winnerId
      });
      await addGameEvent(roomId, "complete", `🏆 Game Over!`);
    } else {
      await updateDoc(doc(db, "rooms", roomId), {
        activeTargetPlayerId: activeTargets[0].id
      });
      await addGameEvent(roomId, "system", `🔄 Target shifts to ${activeTargets[0].name}'s character!`);
    }

    return { correct: true, explanation: data.explanation };
  } else {
    await updateDoc(doc(db, `rooms/${roomId}/players`, guesser.id), { hasGuessedThisRound: true });
    await addGameEvent(roomId, "guess_wrong", `❌ ${guesser.name} guessed "${guess}" for ${target.name}'s character, but it's WRONG.`);
    return { correct: false, explanation: data.explanation };
  }
}

// Reset Game
export async function resetGame(roomId: string, players: Player[]) {
  await updateDoc(doc(db, "rooms", roomId), {
    status: "lobby",
    activeTargetPlayerId: null,
    winnerId: null
  });

  for (const p of players) {
    await updateDoc(doc(db, `rooms/${roomId}/players`, p.id), {
      state: "ACTIVE",
      score: 0,
      hasGuessedThisRound: false,
      secretCharacter: ""
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
