import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Trophy, Target, User, Users, HelpCircle, Send, 
  CheckCircle2, XCircle, ArrowRight, RotateCcw, 
  Plus, Play, Sparkles, MessageSquare, Crown, 
  Shuffle, LogIn, Info, Gamepad2, UserCheck, QrCode,
  LogOut, WifiOff, Languages, Settings
} from "lucide-react";
import { QRCodeSVG } from 'qrcode.react';
import { Player, Room, GameEvent, Question } from "./types";
import { auth, googleProvider, db } from "./lib/firebase";
import { signInWithPopup, User as FirebaseUser, signOut } from "firebase/auth";
import { collection, doc, onSnapshot, query, orderBy } from "firebase/firestore";
import * as gameLogic from "./lib/gameLogic";
import { translations } from "./translations";


export default function App() {
  const [lang, setLang] = useState<"en" | "ar">("en");
  const t = translations[lang];
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [roomId, setRoomId] = useState<string>("");
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [history, setHistory] = useState<GameEvent[]>([]);
  
  const [playerName, setPlayerName] = useState<string>("");
  const [categoryInput, setCategoryInput] = useState<string>("General Words");
  const [isOptionsOpen, setIsOptionsOpen] = useState<boolean>(false);
  const [isPlayingMusic, setIsPlayingMusic] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clickAudioRef = useRef<HTMLAudioElement>(null);
  const winAudioRef = useRef<HTMLAudioElement>(null);
  const lossAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const unlockAudio = () => {
      // Mobile browsers require audio to be played within a user interaction
      [audioRef, clickAudioRef, winAudioRef, lossAudioRef].forEach(ref => {
        if (ref.current) {
          const p = ref.current.play();
          if (p !== undefined) {
            p.then(() => {
              ref.current?.pause();
              if (ref.current) ref.current.currentTime = 0;
            }).catch(() => {});
          }
        }
      });
    };

    const playMusic = () => {
      unlockAudio();
      if (audioRef.current && !isMuted && isPlayingMusic) {
        audioRef.current.play().catch(e => console.log("Auto-play prevented", e));
        removeInteractionListeners();
      }
    };

    const removeInteractionListeners = () => {
      document.removeEventListener('click', playMusic);
      document.removeEventListener('mousedown', playMusic);
      document.removeEventListener('touchstart', playMusic);
      document.removeEventListener('keydown', playMusic);
    };

    document.addEventListener('click', playMusic);
    document.addEventListener('mousedown', playMusic);
    document.addEventListener('touchstart', playMusic);
    document.addEventListener('keydown', playMusic);

    // Global click sound for all buttons - use mousedown for better response
    const handleGlobalMouseDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') && !isMuted && clickAudioRef.current) {
        clickAudioRef.current.currentTime = 0;
        clickAudioRef.current.play().catch(() => {});
      }
    };
    document.addEventListener('mousedown', handleGlobalMouseDown);
    document.addEventListener('touchstart', handleGlobalMouseDown);

    if (isPlayingMusic && audioRef.current && !isMuted) {
      audioRef.current.play().catch(e => console.log("Auto-play prevented", e));
    }

    return () => {
      removeInteractionListeners();
      document.removeEventListener('mousedown', handleGlobalMouseDown);
      document.removeEventListener('touchstart', handleGlobalMouseDown);
    };
  }, [isMuted, isPlayingMusic]);
  const [secretWordInput, setSecretWordInput] = useState<string>("");
  const [questionInput, setQuestionInput] = useState<string>("");
  const [guessInput, setGuessInput] = useState<string>("");
  const [isGuessing, setIsGuessing] = useState<boolean>(false);
  const [guessFeedback, setGuessFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'board' | 'history' | 'players'>('board');
  const [customRoomCode, setCustomRoomCode] = useState<string>("");
  const [showQR, setShowQR] = useState(false);

  const getRoomJoinUrl = () => {
    let origin = "https://ais-dev-oxicsvn4rhdj74o4qoli4h-302185868240.europe-west2.run.app";
    if (typeof window !== "undefined" && window.location) {
      const currentOrigin = window.location.origin;
      if (currentOrigin && currentOrigin !== "null" && currentOrigin !== "about:") {
        origin = currentOrigin;
      } else {
        const href = window.location.href;
        if (href && href !== "about:srcdoc" && href !== "about:blank") {
          try {
            const urlObj = new URL(href);
            if (urlObj.origin && urlObj.origin !== "null") {
              origin = urlObj.origin;
            }
          } catch (e) {}
        }
      }
    }
    return `${origin}/?room=${room?.id || ""}`;
  };

  const historyContainerRef = useRef<HTMLDivElement>(null);
  const questionsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(u => {
      setUser(u);
      if (u && !playerName) {
        setPlayerName(u.displayName || "");
      }
    });
    return unsub;
  }, []);

  // Check URL parameters for direct join
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setCustomRoomCode(roomParam);
    }
  }, []);

  // Real-time listeners
  useEffect(() => {
    if (!roomId || !user) return;

    const unsubs: any[] = [];
    
    // Room
    unsubs.push(onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (snap.exists()) {
        setRoom(snap.data() as Room);
      } else {
        setRoom(null);
      }
    }));

    // Players
    unsubs.push(onSnapshot(collection(db, `rooms/${roomId}/players`), (snap) => {
      const p: Player[] = [];
      snap.forEach(d => p.push(d.data() as Player));
      setPlayers(p);
    }));

    // Questions
    const qQuery = query(collection(db, `rooms/${roomId}/questions`), orderBy('timestamp', 'asc'));
    unsubs.push(onSnapshot(qQuery, (snap) => {
      const qs: Question[] = [];
      snap.forEach(d => qs.push(d.data() as Question));
      setQuestions(qs);
    }));

    // History
    const hQuery = query(collection(db, `rooms/${roomId}/history`), orderBy('timestamp', 'asc'));
    unsubs.push(onSnapshot(hQuery, (snap) => {
      const evs: GameEvent[] = [];
      snap.forEach(d => evs.push(d.data() as GameEvent));
      setHistory(evs);
    }));

    return () => unsubs.forEach(fn => fn());
  }, [roomId, user]);

  useEffect(() => {
    if (history.length === 0) return;
    const lastEvent = history[history.length - 1];
    
    // Determine timestamp
    let eventTime = 0;
    if (lastEvent.timestamp) {
      if (typeof (lastEvent.timestamp as any).toMillis === 'function') {
        eventTime = (lastEvent.timestamp as any).toMillis();
      } else if ((lastEvent.timestamp as any).seconds) {
        eventTime = (lastEvent.timestamp as any).seconds * 1000;
      } else if (lastEvent.timestamp instanceof Date) {
        eventTime = lastEvent.timestamp.getTime();
      } else if (typeof lastEvent.timestamp === 'string') {
        eventTime = new Date(lastEvent.timestamp).getTime();
      }
    }
    
    const now = Date.now();
    
    // Only play if the event is very recent (within last 3 seconds)
    if (eventTime && (now - eventTime < 3000)) {
      if (lastEvent.type === "guess_correct" && winAudioRef.current && !isMuted) {
        winAudioRef.current.currentTime = 0;
        winAudioRef.current.play().catch(() => {});
      } else if (lastEvent.type === "guess_wrong" && lossAudioRef.current && !isMuted) {
        lossAudioRef.current.currentTime = 0;
        lossAudioRef.current.play().catch(() => {});
      }
    }
  }, [history, isMuted]);

  useEffect(() => {
    if (historyContainerRef.current) {
      historyContainerRef.current.scrollTo({ top: historyContainerRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [history]);

  useEffect(() => {
    if (questionsContainerRef.current) {
      questionsContainerRef.current.scrollTo({ top: questionsContainerRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [questions]);

  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const playClick = () => {
    if (clickAudioRef.current && !isMuted) {
      clickAudioRef.current.currentTime = 0;
      clickAudioRef.current.play().catch(() => {});
    }
  };

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setError(err.message);
      setIsLoggingIn(false);
    }
  };

  const handleCreateRoom = async () => {
    setLoading(true);
    setError(null);
    try {
      const newId = await gameLogic.createRoom(categoryInput, lang);
      setRoomId(newId);
      // Automatically join
      await gameLogic.joinRoom(newId, playerName || user?.displayName || "Player", lang);
      // Update URL without reload
      window.history.pushState({}, '', `?room=${newId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!customRoomCode || customRoomCode.trim() === "") {
      setError("Please enter a room code.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const c = customRoomCode.trim().toUpperCase();
      await gameLogic.joinRoom(c, playerName || user?.displayName || "Player", lang);
      setRoomId(c);
      window.history.pushState({}, '', `?room=${c}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetSecretWord = async () => {
    if (!secretWordInput || secretWordInput.trim() === "") {
      setError("Please enter a character name.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await gameLogic.setSecretWord(roomId, user!.uid, secretWordInput, lang);
      setSecretWordInput("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = async () => {
    setLoading(true);
    setError(null);
    try {
      await gameLogic.startGame(roomId, players, lang);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAskQuestion = async () => {
    if (!questionInput || questionInput.trim() === "" || !room || !currentPlayer || !targetPlayer) return;
    if (room.activeAskerPlayerId !== currentPlayer.id) {
      setError("It's not your turn to ask!");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await gameLogic.askQuestion(roomId, currentPlayer, targetPlayer, questionInput, lang);
      setQuestionInput("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerQuestion = async (question: Question, answer: 'YES' | 'NO' | 'MAYBE' | 'UNKNOWN') => {
    if (!targetPlayer) return;
    setError(null);
    try {
      await gameLogic.answerQuestion(roomId, question, targetPlayer, answer, players, lang);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGuess = async () => {
    if (!guessInput || guessInput.trim() === "" || !room || !currentPlayer || !targetPlayer) return;
    setLoading(true);
    setError(null);
    setGuessFeedback(null);
    try {
      const res = await gameLogic.submitGuess(roomId, currentPlayer, targetPlayer, guessInput, players, room, lang);
      setIsGuessing(false);
      setGuessInput("");
      
      if (res.correct) {
        setGuessFeedback({ success: true, message: `🎉 Correct! ${res.explanation} (+10 Points!)` });
      } else {
        setGuessFeedback({ success: false, message: `❌ Wrong guess! ${res.explanation}` });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePassTurn = async () => {
    if (!room || !currentPlayer) return;
    setLoading(true);
    setError(null);
    try {
      await gameLogic.passTurn(roomId, room, players, lang);
      setIsGuessing(false);
      setGuessInput("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetGame = async () => {
    if (!room) return;
    setLoading(true);
    setError(null);
    setGuessFeedback(null);
    try {
      await gameLogic.resetGame(roomId, players, lang);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!user || !roomId) return;
    setLoading(true);
    try {
      await gameLogic.leaveRoom(roomId, user.uid, lang);
      setRoomId("");
      setRoom(null);
      window.history.pushState({}, '', '/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#4338CA] flex items-center justify-center p-4 selection:bg-pink-500">
        <div className="bg-white border-4 border-black p-8 rounded-[32px] shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-black max-w-md w-full text-center">
          <div className="bg-yellow-400 w-16 h-16 mx-auto rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center mb-6">
            <Gamepad2 className="w-8 h-8 text-black" />
          </div>
          <h1 className="text-4xl font-black tracking-tight italic uppercase mb-2">{t.whosDat}</h1>
          <p className="font-bold text-zinc-600 mb-8">{t.loginInstruction}</p>
          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full bg-emerald-400 text-black font-black text-lg py-4 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-emerald-300 active:translate-y-1 active:translate-x-1 active:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center gap-3 uppercase disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LogIn className="w-6 h-6" />
            {isLoggingIn ? t.connecting : t.continueGoogle}
          </button>
        </div>
      </div>
    );
  }

  const currentPlayer = players.find(p => p.uid === user.uid);
  const targetPlayer = players.find(p => p.id === room?.activeTargetPlayerId);
  const isMeTarget = currentPlayer && room && currentPlayer.id === room.activeTargetPlayerId;

  return (
    <div className="min-h-screen bg-[#4338CA] text-white font-sans antialiased selection:bg-pink-500 selection:text-white flex flex-col p-4 sm:p-8 custom-scrollbar">
      {/* Header */}
      <header className="mb-8" id="app-header">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-yellow-400 p-3 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-black">
              <Gamepad2 className="w-8 h-8 text-black" />
            </div>
            <div>
              <h2 className="text-4xl font-black tracking-tight italic uppercase text-white flex items-center gap-2">
                {t.whosDat}
              </h2>
              <p className="text-xs text-indigo-200 font-semibold uppercase tracking-wider">{room?.category || t.gameDescription}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setIsOptionsOpen(!isOptionsOpen)}
                className="bg-zinc-800 px-3 py-2 rounded-full border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-white text-xs flex items-center gap-2 hover:bg-zinc-700 active:translate-y-1 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all"
              >
                <Settings className="w-4 h-4" />
              </button>
              {isOptionsOpen && (
                <div className="absolute right-0 top-12 bg-white border-2 border-black rounded-xl p-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2 z-50">
                  <button 
                    onClick={() => { setLang(lang === 'en' ? 'ar' : 'en'); setIsOptionsOpen(false); }}
                    className="bg-purple-600 px-3 py-2 rounded-full border-2 border-black font-bold text-white text-xs flex items-center gap-2 hover:bg-purple-500 transition-all whitespace-nowrap"
                  >
                    <Languages className="w-4 h-4" /> {lang === 'en' ? 'AR' : 'EN'}
                  </button>
                  <button
                    onClick={() => {
                      setIsMuted(!isMuted);
                      if (!isMuted && audioRef.current) {
                        audioRef.current.pause();
                      } else if (isMuted && isPlayingMusic && audioRef.current) {
                        audioRef.current.play().catch(() => {});
                      }
                      setIsOptionsOpen(false);
                    }}
                    className={`${isMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-600 hover:bg-slate-500'} px-3 py-2 rounded-full border-2 border-black font-bold text-white text-xs flex items-center gap-2 transition-all whitespace-nowrap`}
                  >
                    {isMuted ? "Unmute All" : "Mute All"}
                  </button>
                  <button
                    onClick={() => {
                      if (audioRef.current) {
                        if (isPlayingMusic) {
                          audioRef.current.pause();
                        } else if (!isMuted) {
                          audioRef.current.play();
                        }
                        setIsPlayingMusic(!isPlayingMusic);
                      }
                      setIsOptionsOpen(false);
                    }}
                    className="bg-emerald-600 px-3 py-2 rounded-full border-2 border-black font-bold text-white text-xs flex items-center gap-2 hover:bg-emerald-500 transition-all whitespace-nowrap"
                  >
                    {isPlayingMusic ? "Stop Music" : "Play Music"}
                  </button>
                  <button 
                    onClick={handleLogout}
                    className="bg-black px-3 py-2 rounded-full border-2 border-black font-bold text-white text-xs flex items-center gap-2 hover:bg-zinc-800 transition-all whitespace-nowrap"
                  >
                    <LogOut className="w-4 h-4" /> {t.logout}
                  </button>
                </div>
              )}
            </div>
            {room && (
              <button 
                onClick={() => setShowQR(true)}
                className="bg-pink-500 px-5 py-2 rounded-full border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-white text-xs flex items-center gap-2 hover:bg-pink-400 active:translate-y-1 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all"
              >
                <QrCode className="w-4 h-4" /> ROOM: <span className="font-mono font-black">{room.id}</span>
              </button>
            )}
            
            {room && (
              <button 
                onClick={handleDisconnect}
                className="bg-rose-500 px-5 py-2 rounded-full border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] font-bold text-white text-xs flex items-center gap-2 hover:bg-rose-400 active:translate-y-1 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] transition-all"
              >
                <WifiOff className="w-4 h-4" /> {t.disconnect}
              </button>
            )}
            
            <div className="bg-emerald-400 px-5 py-2 rounded-full border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] text-black font-bold text-xs flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-black rounded-full animate-ping" />
              <span><strong className="font-black">{user.displayName?.toUpperCase()}</strong></span>
            </div>
            
            {room && room.leaderId === user.uid && (
              <button 
                onClick={handleResetGame}
                disabled={loading}
                className="bg-yellow-400 hover:bg-yellow-300 text-black p-2.5 rounded-full border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition active:scale-90"
                title="Reset Game State"
              >
                <RotateCcw className="w-4 h-4 text-black stroke-[3px]" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto flex flex-col gap-6" id="main-stage">
        
        {/* Error notification */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="bg-rose-500 border-4 border-black text-white p-4 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-sm flex items-start gap-3 font-bold"
            >
              <XCircle className="w-6 h-6 shrink-0 text-white animate-pulse" />
              <div className="flex-1">
                <span className="font-black uppercase tracking-wider block text-xs opacity-80">ERROR ENCOUNTERED</span>
                <span>{error}</span>
              </div>
              <button onClick={() => setError(null)} className="text-white hover:text-black font-black text-xl ml-2">×</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Guess Feedback */}
        <AnimatePresence>
          {guessFeedback && (
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className={`p-5 rounded-2xl border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] ${
                guessFeedback.success ? "bg-emerald-400 text-black" : "bg-pink-500 text-white"
              } flex items-start gap-4`}
            >
              <div className="mt-0.5">
                {guessFeedback.success ? <CheckCircle2 className="w-8 h-8 text-black" /> : <XCircle className="w-8 h-8 text-white" />}
              </div>
              <div className="flex-1">
                <h4 className="font-black text-xl mb-1 uppercase tracking-tight italic">
                  {guessFeedback.success ? "🎉 Glorious Discovery!" : "❌ Incorrect Guess"}
                </h4>
                <p className={`text-sm ${guessFeedback.success ? "text-black/80" : "text-white/90"} font-bold`}>{guessFeedback.message}</p>
              </div>
              <button 
                onClick={() => setGuessFeedback(null)} 
                className="font-black uppercase tracking-wider text-xs border-2 border-black bg-white text-black px-3 py-1.5 rounded-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:scale-95 transition"
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* QR Code Modal */}
        <AnimatePresence>
          {showQR && room && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowQR(false)}
            >
              <motion.div 
                initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                className="bg-white border-4 border-black p-8 rounded-3xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-6 max-w-sm w-full"
                onClick={e => e.stopPropagation()}
              >
                <h3 className="text-3xl font-black text-black uppercase italic text-center">{t.scanToJoin}</h3>
                <div className="bg-white p-4 border-4 border-black rounded-xl">
                  <QRCodeSVG value={getRoomJoinUrl()} size={200} />
                </div>
                <div className="bg-yellow-400 text-black font-black text-2xl tracking-widest px-6 py-2 rounded-xl border-2 border-black">
                  {room.id}
                </div>
                <button 
                  onClick={() => setShowQR(false)}
                  className="w-full bg-black text-white font-bold py-3 rounded-xl hover:bg-gray-800 transition uppercase"
                >
                  {t.close}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <audio ref={audioRef} loop src="https://www.dropbox.com/scl/fi/6qg1b3dye88prbuqpexia/Guess-Again.mp3?rlkey=snmgxok4w3gawmyo8nt31f9xv&st=4d1jpjiy&dl=1" />
        <audio ref={clickAudioRef} src="https://www.dropbox.com/scl/fi/w9hzmfmmdwadbseiiv615/click.mp3?rlkey=2pi0d2k15v4ti5ip0qup8wtg6&st=k45vzg6g&dl=1" />
        <audio ref={winAudioRef} src="https://www.dropbox.com/scl/fi/aprrma19gawoaxyeaxhvc/win.mp3?rlkey=211q81do5jo3vj0il3eppeeeq&st=gdtfinbv&dl=1" />
        <audio ref={lossAudioRef} src="https://www.dropbox.com/scl/fi/jh9mjaxxiwfzxet3dzze4/loss.mp3?rlkey=19ay9v9bagii47pu2bi2x8suq&st=c8n2vobh&dl=1" />

        {/* LOBBY / JOIN ROOM SCREEN */}
        {!room ? (
          <div className="max-w-4xl mx-auto w-full my-auto flex flex-col gap-8 py-8" id="lobby-screen">
            <div className="text-center flex flex-col items-center bg-white border-4 border-black p-8 rounded-[32px] shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-black">
              <span className="text-xs font-black tracking-widest text-indigo-700 uppercase bg-yellow-300 px-4 py-1.5 rounded-full mb-4 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                {t.preGameLobby}
              </span>
              <h2 className="text-5xl font-black tracking-tight italic mb-3">
                {t.whosDat}
              </h2>
              <p className="text-zinc-700 max-w-xl text-sm sm:text-base font-bold">
                {t.gameDescription}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              <motion.div className="bg-white border-4 border-black text-black rounded-[24px] p-6 flex flex-col justify-between shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <div>
                  <div className="bg-emerald-400 text-black border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] w-fit p-3 rounded-xl mb-4">
                    <Crown className="w-6 h-6 text-black" />
                  </div>
                  <h3 className="text-2xl font-black mb-2 uppercase tracking-tight italic">{t.createParty}</h3>
                  <p className="text-xs text-zinc-600 mb-6 font-semibold leading-relaxed">
                    {t.createPartyDesc}
                  </p>
                  
                  <div className="mb-4">
                    <label className="block text-xs font-black uppercase text-zinc-500 mb-2">{t.category}</label>
                    <input
                      type="text"
                      placeholder={t.categoryPlaceholder}
                      value={categoryInput}
                      onChange={(e) => setCategoryInput(e.target.value)}
                      className="w-full bg-zinc-50 border-2 border-zinc-300 rounded-xl p-3 font-bold text-zinc-800 focus:border-black focus:ring-0 outline-none placeholder:font-normal placeholder:text-zinc-400"
                    />
                  </div>
                </div>
                
                <button
                  onClick={() => { playClick(); handleCreateRoom(); }}
                  disabled={loading}
                  className="w-full bg-pink-500 text-white font-black py-3.5 px-4 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-pink-400 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50 transition flex items-center justify-center gap-2 text-sm uppercase"
                >
                  <Plus className="w-4 h-4" /> {t.createRoom}
                </button>
              </motion.div>

              <motion.div className="bg-white border-4 border-black text-black rounded-[24px] p-6 flex flex-col justify-between shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex flex-col gap-4">
                  <div className="bg-indigo-500 text-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] w-fit p-3 rounded-xl mb-2">
                    <Users className="w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-black mb-1 uppercase tracking-tight italic">{t.joinParty}</h3>
                  <p className="text-xs text-zinc-600 mb-4 font-semibold leading-relaxed">
                    {t.joinPartyDesc}
                  </p>
                  
                  <div>
                    <label className="block text-xs font-black uppercase text-zinc-500 mb-2">{t.roomCode}</label>
                    <div className="flex items-center">
                      <div className="bg-zinc-200 border-2 border-r-0 border-zinc-300 rounded-l-xl p-3 flex items-center justify-center">
                        <Target className="w-5 h-5 text-zinc-500" />
                      </div>
                      <input
                        type="text"
                        placeholder={t.roomCodePlaceholder}
                        value={customRoomCode}
                        onChange={(e) => setCustomRoomCode(e.target.value.toUpperCase())}
                        className="w-full bg-zinc-50 border-2 border-zinc-300 rounded-r-xl p-3 font-bold text-zinc-800 focus:border-black focus:ring-0 outline-none uppercase placeholder:text-zinc-400"
                        maxLength={8}
                      />
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={() => { playClick(); handleJoinRoom(); }}
                  disabled={loading || !customRoomCode.trim()}
                  className="w-full mt-6 bg-indigo-600 text-white font-black py-3.5 px-4 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-indigo-500 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50 transition flex items-center justify-center gap-2 text-sm uppercase"
                >
                  <ArrowRight className="w-4 h-4" /> {t.enterArena}
                </button>
              </motion.div>
            </div>
          </div>
        ) : room.status === "lobby" ? (
          /* PRE-GAME LOBBY */
          <div className="bg-white border-4 border-black rounded-[32px] p-6 sm:p-8 md:p-12 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-black max-w-4xl mx-auto w-full">
            <div className="flex flex-col items-center text-center mb-10">
              <span className="bg-indigo-100 text-indigo-700 font-black text-xs px-4 py-1.5 rounded-full border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] mb-4 uppercase tracking-widest">
                {t.preGameLobby}
              </span>
              <h2 className="text-4xl sm:text-5xl font-black tracking-tight italic mb-3">{t.enterCharacter}</h2>
              <p className="text-zinc-600 font-bold max-w-lg">
                The category is <span className="bg-yellow-300 px-2 py-0.5 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">{room.category}</span>.
                {t.pickTricky}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="bg-indigo-50 p-6 rounded-[24px] border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <h3 className="text-xl font-black uppercase tracking-tight mb-4 flex items-center gap-2">
                  <User className="w-5 h-5" /> {t.yourSecret}
                </h3>
                
                {currentPlayer?.secretWord ? (
                  <div className="bg-emerald-400 text-black border-2 border-black p-6 rounded-2xl text-center shadow-[inset_0px_4px_0px_rgba(255,255,255,0.3)]">
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-black" />
                    <p className="font-bold text-sm mb-1 opacity-80 uppercase tracking-widest">{t.lockedInAs}</p>
                    <p className="font-black text-2xl italic tracking-tight bg-black text-emerald-400 py-2 rounded-xl border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                      {currentPlayer.secretWord}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <input
                      type="text"
                      placeholder={`e.g. Someone from ${room.category}`}
                      value={secretWordInput}
                      onChange={(e) => setSecretWordInput(e.target.value)}
                      className="w-full bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-xl p-4 font-bold text-lg focus:ring-0 outline-none placeholder:text-zinc-400"
                    />
                    <button
                      onClick={handleSetSecretWord}
                      disabled={loading || !secretWordInput.trim()}
                      className="w-full bg-black text-white font-black py-4 rounded-xl shadow-[3px_3px_0px_0px_rgba(100,100,100,1)] hover:bg-gray-800 disabled:opacity-50 transition uppercase tracking-widest"
                    >
                      {t.submitCharacter}
                    </button>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xl font-black uppercase tracking-tight mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5" /> {t.connectedPlayers} ({players.length})
                </h3>
                <div className="flex flex-col gap-3">
                  {players.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-zinc-100 border-2 border-zinc-300 p-4 rounded-xl">
                      <span className="font-bold text-zinc-800">{p.name} {p.id === user.uid && "(You)"}</span>
                      {p.secretWord ? (
                        <span className="bg-emerald-100 text-emerald-700 font-bold text-xs px-3 py-1 rounded-md flex items-center gap-1 border border-emerald-300">
                          <CheckCircle2 className="w-3 h-3" /> Ready
                        </span>
                      ) : (
                        <span className="bg-amber-100 text-amber-700 font-bold text-xs px-3 py-1 rounded-md border border-amber-300 animate-pulse">
                          {t.thinking}
                        </span>
                      )}
                    </div>
                  ))}
                  {players.length === 0 && (
                    <p className="text-zinc-500 font-semibold italic text-sm p-4 text-center">{t.waitingPlayers}</p>
                  )}
                </div>

                {room.leaderId === user.uid && (
                  <div className="mt-8">
                    <button
                      onClick={handleStartGame}
                      disabled={loading || players.length < 2 || !players.every(p => p.secretWord)}
                      className="w-full bg-pink-500 text-white font-black py-4 rounded-xl border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-pink-400 active:translate-y-1 active:translate-x-1 active:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50 disabled:grayscale transition text-lg uppercase italic tracking-wide flex justify-center items-center gap-2"
                    >
                      <Play className="w-6 h-6 fill-white" /> Start Game
                    </button>
                    {!players.every(p => p.secretWord) && (
                      <p className="text-xs text-rose-500 font-bold mt-3 text-center bg-rose-50 p-2 rounded-lg border border-rose-200">
                        All players must submit a character before starting.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ACTIVE GAME BOARD */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full" id="game-board">
            
            <div className="lg:col-span-2 flex flex-col gap-6 h-full">
              
              {room.status === "ended" && room.winnerId ? (
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  className="bg-yellow-400 border-4 border-black rounded-[24px] p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-center text-black flex flex-col items-center relative overflow-hidden"
                >
                  <Trophy className="w-20 h-20 mb-4 text-black" />
                  <h2 className="text-5xl font-black uppercase italic tracking-tight mb-2">{t.gameOver}</h2>
                  <p className="text-xl font-bold">
                    The winner is <span className="bg-white px-3 py-1 border-2 border-black rounded-lg">{players.find(p=>p.id === room.winnerId)?.name}</span> 
                    with <span className="font-black">{players.find(p=>p.id === room.winnerId)?.score} points</span>!
                  </p>
                  
                  {room.leaderId === user.uid && (
                    <button 
                      onClick={handleResetGame}
                      className="mt-8 bg-black text-white font-black px-8 py-4 rounded-xl uppercase tracking-widest hover:bg-gray-800 transition active:scale-95 border-2 border-transparent"
                    >
                      {t.playAgain}
                    </button>
                  )}
                </motion.div>
              ) : (
                <div className="bg-white border-4 border-black rounded-[24px] shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col overflow-hidden h-[450px]">
                  <div className="bg-zinc-100 border-b-4 border-black p-4 shrink-0 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-pink-500 p-2.5 rounded-xl border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                        <MessageSquare className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-black text-black uppercase tracking-tight text-xl leading-none">{t.interrogationBoard}</h3>
                        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">{t.askYesNoQuestions}</p>
                      </div>
                    </div>
                  </div>

                  <div ref={questionsContainerRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5 custom-scrollbar bg-zinc-50">
                    {questions.length === 0 ? (
                      <div className="my-auto text-center flex flex-col items-center p-4">
                        <div className="bg-indigo-100 p-4 rounded-full mb-3 text-indigo-600 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                          <HelpCircle className="w-8 h-8" />
                        </div>
                        <p className="text-black font-black uppercase text-lg mb-1">The Board is Empty</p>
                        <p className="text-zinc-500 font-bold text-sm">Be the first to interrogate the target.</p>
                      </div>
                    ) : (
                      questions.map((q) => (
                        <div key={q.id} className="bg-white border-2 border-black p-4 rounded-xl shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] text-black">
                          <div className="flex justify-between items-start gap-4 mb-2">
                            <span className="font-bold text-sm text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200">
                              {q.askerName} asks:
                            </span>
                          </div>
                          <p className="font-black text-lg leading-tight mb-3 italic">"{q.text}"</p>
                          
                          <div className="flex items-center justify-between mt-auto pt-2 border-t-2 border-zinc-100">
                            <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Answer:</span>
                            {q.answer === "PENDING" ? (
                              isMeTarget ? (
                                <div className="flex gap-2">
                                  <button onClick={() => handleAnswerQuestion(q, "YES")} className="bg-emerald-400 hover:bg-emerald-300 text-black font-black px-3 py-1 rounded border-2 border-black text-xs transition">YES</button>
                                  <button onClick={() => handleAnswerQuestion(q, "NO")} className="bg-rose-500 hover:bg-rose-400 text-white font-black px-3 py-1 rounded border-2 border-black text-xs transition">NO</button>
                                  <button onClick={() => handleAnswerQuestion(q, "UNKNOWN")} className="bg-zinc-200 hover:bg-zinc-300 text-black font-black px-3 py-1 rounded border-2 border-black text-xs transition">?</button>
                                </div>
                              ) : (
                                <span className="text-amber-500 font-black text-sm uppercase animate-pulse">Waiting...</span>
                              )
                            ) : (
                              <span className={`font-black px-3 py-1 rounded-md text-sm border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
                                q.answer === 'YES' ? 'bg-emerald-400 text-black' : 
                                q.answer === 'NO' ? 'bg-rose-500 text-white' : 
                                'bg-zinc-200 text-black'
                              }`}>
                                {q.answer}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {!isMeTarget && room.status === "playing" && (
                    <div className="p-4 bg-white border-t-4 border-black">
                      {room.activeAskerPlayerId === currentPlayer.id ? (
                        currentPlayer.hasAskedThisRound ? (
                          <div className="p-3 bg-zinc-100 border-2 border-black rounded-xl flex items-center justify-center gap-2">
                            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                            <p className="text-sm font-bold text-zinc-700 uppercase tracking-wide">
                              Question submitted! Make your guess or pass below.
                            </p>
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <input
                              type="text"
                              placeholder="Ask a Yes/No question..."
                              value={questionInput}
                              onChange={(e) => setQuestionInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAskQuestion()}
                              className="flex-1 bg-zinc-100 border-2 border-black rounded-xl p-3 text-black font-bold focus:bg-white outline-none focus:ring-0 transition"
                            />
                            <button
                              onClick={handleAskQuestion}
                              disabled={loading || !questionInput.trim()}
                              className="bg-indigo-600 text-white p-3 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-indigo-500 active:translate-y-1 active:translate-x-1 active:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50 transition"
                            >
                              <Send className="w-5 h-5" />
                            </button>
                          </div>
                        )
                      ) : (
                        <p className="text-center font-bold text-zinc-500 uppercase tracking-widest text-sm">
                          Wait for {players.find(p => p.id === room.activeAskerPlayerId)?.name}'s turn
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex flex-col gap-6 h-full">
              {targetPlayer && room.status === "playing" && (
                <div className="bg-indigo-600 border-4 border-black rounded-[24px] p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] text-white relative overflow-hidden">
                  <div className="absolute -right-4 -top-4 opacity-10">
                    <Target className="w-32 h-32" />
                  </div>
                  <div className="relative z-10">
                    <h3 className="text-indigo-200 font-black text-xs tracking-widest uppercase mb-1">Current Target</h3>
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-12 h-12 bg-white rounded-xl border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center">
                        <UserCheck className="w-6 h-6 text-indigo-600" />
                      </div>
                      <span className="text-3xl font-black italic tracking-tight">{targetPlayer.name}</span></div>
                                     {!isMeTarget && room.activeAskerPlayerId === currentPlayer.id && (
                      <div className="bg-white/10 p-5 rounded-2xl border-2 border-white/20 backdrop-blur-sm">
                        <p className="text-sm font-bold mb-3 text-indigo-100 uppercase tracking-widest text-center">Your Turn</p>
                        
                        {isGuessing ? (
                          <div className="flex flex-col gap-3">
                            <input
                              type="text"
                              autoFocus
                              placeholder="Enter your guess..."
                              value={guessInput}
                              onChange={(e) => setGuessInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleGuess()}
                              className="w-full bg-white text-black border-2 border-black rounded-xl p-3 font-bold placeholder:text-zinc-400 focus:outline-none"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={handleGuess}
                                disabled={loading || !guessInput.trim() || currentPlayer?.hasGuessedThisRound}
                                className="flex-1 bg-yellow-400 text-black font-black py-2.5 rounded-xl border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-300 disabled:opacity-50 transition active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] text-sm uppercase"
                              >
                                Submit
                              </button>
                              <button
                                onClick={() => setIsGuessing(false)}
                                className="px-4 bg-zinc-800 text-white font-black rounded-xl border-2 border-black hover:bg-zinc-700 transition uppercase text-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => setIsGuessing(true)}
                              disabled={currentPlayer?.hasGuessedThisRound}
                              className={`w-full font-black py-3 rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition flex items-center justify-center gap-2 uppercase tracking-wide
                                ${currentPlayer?.hasGuessedThisRound 
                                  ? 'bg-zinc-500 text-zinc-300 opacity-80' 
                                  : 'bg-pink-500 text-white hover:bg-pink-400 active:translate-y-1 active:translate-x-1 active:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)]'
                                }`}
                            >
                              <Trophy className="w-5 h-5" /> 
                              {currentPlayer?.hasGuessedThisRound ? 'Locked for Round' : 'Make a Guess'}
                            </button>
                            <button
                              onClick={handlePassTurn}
                              disabled={loading || currentPlayer?.hasGuessedThisRound}
                              className="w-full font-black py-3 bg-zinc-700 text-white rounded-xl border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-zinc-600 transition active:translate-y-1 active:translate-x-1 active:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)] text-sm uppercase"
                            >
                              Pass Turn
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {!isMeTarget && room.activeAskerPlayerId !== currentPlayer.id && (
                      <div className="bg-white/10 p-5 rounded-2xl border-2 border-white/20 backdrop-blur-sm text-center">
                        <p className="text-sm font-bold text-indigo-100 uppercase tracking-widest">
                          Waiting for {players.find(p => p.id === room.activeAskerPlayerId)?.name}
                        </p>
                      </div>
                    )}

                    {isMeTarget && (
                      <div className="bg-emerald-400 text-black p-5 rounded-2xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-center">
                        <p className="text-xs font-black uppercase tracking-widest opacity-80 mb-1">YOU ARE THE TARGET</p>
                        <p className="font-bold text-sm mb-3">Answer questions accurately to keep the game fair!</p>
                        <div className="bg-black text-emerald-400 font-black text-xl py-2 px-4 rounded-xl border-2 border-black shadow-[inset_0px_2px_0px_rgba(255,255,255,0.2)]">
                          {currentPlayer.secretWord}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex bg-white border-4 border-black rounded-[24px] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] overflow-hidden shrink-0">
                <button 
                  onClick={() => setActiveTab('board')}
                  className={`flex-1 py-3 text-sm font-black uppercase tracking-widest ${activeTab === 'board' ? 'bg-yellow-400 text-black border-b-4 border-black' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'} transition`}
                >
                  Scoreboard
                </button>
                <button 
                  onClick={() => setActiveTab('history')}
                  className={`flex-1 py-3 text-sm font-black uppercase tracking-widest border-l-4 border-black ${activeTab === 'history' ? 'bg-pink-500 text-white border-b-4 border-black' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'} transition`}
                >
                  History
                </button>
              </div>

              <div className="bg-white border-4 border-black rounded-[24px] shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex-1 overflow-hidden flex flex-col min-h-[300px]">
                {activeTab === 'board' ? (
                  <div className="p-5 flex flex-col h-full">
                    <h3 className="font-black text-black uppercase tracking-tight text-xl mb-4 flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-yellow-500" /> {t.leaderboard}
                    </h3>
                    <div className="flex flex-col gap-3 flex-1 overflow-y-auto custom-scrollbar pr-1">
                      {players.sort((a,b) => b.score - a.score).map((p, idx) => (
                        <div key={p.id} className={`flex items-center justify-between p-3 rounded-xl border-2 border-black ${p.id === room?.activeTargetPlayerId ? 'bg-indigo-100' : 'bg-zinc-50'}`}>
                          <div className="flex items-center gap-3">
                            <span className="font-black text-xl text-zinc-300 w-6 text-center">{idx + 1}</span>
                            <div>
                              <p className="font-black text-black text-lg leading-tight flex items-center gap-2">
                                {p.name}
                                {p.id === room?.activeTargetPlayerId && <Target className="w-4 h-4 text-rose-500" />}
                              </p>
                              <p className="text-xs font-bold text-zinc-500 uppercase">
                                {p.state === "COMPLETED" ? (
                                  <span className="text-emerald-600">Discovered</span>
                                ) : (
                                  p.hasGuessedThisRound ? <span className="text-rose-500">Locked</span> : <span className="text-indigo-500">Active</span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="bg-black text-white font-black px-3 py-1 rounded-lg">
                            {p.score} pt
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-5 flex flex-col h-full bg-zinc-50">
                    <h3 className="font-black text-black uppercase tracking-tight text-xl mb-4 flex items-center gap-2">
                      <Info className="w-5 h-5 text-indigo-500" /> {t.recentActivity}
                    </h3>
                    <div ref={historyContainerRef} className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 custom-scrollbar">
                      {history.map((ev) => {
                        let icon = <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
                        let cardStyle = "bg-zinc-50 border-black/15 text-zinc-700";
                        if (ev.type === "guess_correct" || ev.type === "success") {
                          icon = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
                          cardStyle = "bg-emerald-50 border-emerald-300 text-emerald-900";
                        } else if (ev.type === "guess_wrong" || ev.type === "error") {
                          icon = <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
                          cardStyle = "bg-rose-50 border-rose-300 text-rose-900";
                        } else if (ev.type === "system") {
                          icon = <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />;
                          cardStyle = "bg-indigo-50 border-indigo-200 text-indigo-800";
                        }

                        return (
                          <div key={ev.id} className={`p-3 rounded-xl border-2 flex items-start gap-3 ${cardStyle} shadow-[2px_2px_0px_0px_rgba(0,0,0,0.05)]`}>
                            <div className="mt-0.5">{icon}</div>
                            <div className="flex-1">
                              <p className="font-bold text-sm leading-snug">{ev.messageKey ? t(ev.messageKey, lang, ev.messageArgs) : ev.message}</p>
                              <span className="text-[10px] font-black uppercase opacity-50 mt-1 block tracking-wider">
                                {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
