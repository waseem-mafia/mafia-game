import { useEffect, useMemo, useState } from "react";
import { get, onValue, ref, set, update } from "firebase/database";
import { MIN_PLAYERS, ROLE_META, assignRolesRandomly } from "./config/gameRules";
import { db } from "./firebase";
import type {
  GamePhase,
  NightActions,
  NightOutcome,
  Player,
  RoomState,
  VictoryState,
  VoteOutcome,
} from "./types/game";

type ExtendedGamePhase = GamePhase | "night_pending_reveal";

type ExtendedRoomState = Omit<RoomState, "phase"> & {
  phase: ExtendedGamePhase;
  pendingVictoryState?: VictoryState | null;
};

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function isMafiaRole(role: Player["role"]): boolean {
  return role === "mafia_boss" || role === "mafia_silencer";
}

function evaluateVictory(list: Player[]): VictoryState | null {
  const alive = list.filter((p) => p.status === "alive");
  const aliveMafia = alive.filter((p) => isMafiaRole(p.role));
  const aliveOthers = alive.filter((p) => !isMafiaRole(p.role));

  if (aliveMafia.length === 0) {
    return {
      winner: "citizens",
      reason: "تم القضاء على جميع أفراد المافيا واستعادت المدينة أمانها.",
    };
  }

  if (aliveMafia.length >= aliveOthers.length) {
    return {
      winner: "mafia",
      reason:
        "سيطرت المافيا على الأغلبية العددية بين الأحياء وحسمت اللعبة لصالحها.",
    };
  }

  return null;
}

const EMPTY_NIGHT_ACTIONS: NightActions = {
  killTargetId: null,
  silenceTargetId: null,
  protectTargetId: null,
};

export default function App() {
  const [screen, setScreen] = useState<"home" | "game" | "rules">("home");
  const [playerName, setPlayerName] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [activeRoomCode, setActiveRoomCode] = useState("");
  const [myPlayerId, setMyPlayerId] = useState("");
  const [roomData, setRoomData] = useState<ExtendedRoomState | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [isRoleVisible, setIsRoleVisible] = useState<boolean>(false);

  // استماع لحظي لحالة الغرفة في Firebase
  useEffect(() => {
    if (!activeRoomCode) return;

    const roomRef = ref(db, `rooms/${activeRoomCode}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const val = snapshot.val() as ExtendedRoomState;
        setRoomData(val);
      } else {
        setRoomData(null);
      }
    });

    return () => unsubscribe();
  }, [activeRoomCode]);

  const players = useMemo(() => {
    if (!roomData?.players) return [];
    return Object.values(roomData.players);
  }, [roomData]);

  const me = useMemo(
    () => players.find((p) => p.id === myPlayerId) ?? null,
    [players, myPlayerId]
  );

  const isAliveMe = me?.status === "alive";
  const isHost = me?.permission === "host";
  const phase: ExtendedGamePhase = roomData?.phase ?? "lobby";
  const dayNumber: number = roomData?.dayNumber ?? 1;
  const nightActions: NightActions =
    roomData?.nightActions ?? EMPTY_NIGHT_ACTIONS;
  const nightOutcome: NightOutcome | null = roomData?.nightOutcome ?? null;
  const voteTargetId: string = roomData?.voteTargetId ?? "";
  const voteOutcome: VoteOutcome | null = roomData?.voteOutcome ?? null;
  const victoryState: VictoryState | null = roomData?.victoryState ?? null;
  const pendingVictoryState: VictoryState | null =
    roomData?.pendingVictoryState ?? null;

  const alivePlayers = useMemo(
    () => players.filter((p) => p.status === "alive"),
    [players]
  );

  const aliveMafiaPlayers = useMemo(
    () => alivePlayers.filter((p) => isMafiaRole(p.role)),
    [alivePlayers]
  );

  const hasAliveBoss = useMemo(
    () => alivePlayers.some((p) => p.role === "mafia_boss"),
    [alivePlayers]
  );

  const hasAliveSilencer = useMemo(
    () => alivePlayers.some((p) => p.role === "mafia_silencer"),
    [alivePlayers]
  );

  // إذا أُقصي المستشفى ينتهي دوره في اللعبة وتختفي قائمته تماماً
  const hasAliveHospital = useMemo(
    () => alivePlayers.some((p) => p.role === "hospital"),
    [alivePlayers]
  );

  // إذا أُقصي أحد فردي المافيا وبقي فرد واحد حي من المافيا، يجمع القائمتين معاً
  const combinedSingleMafiaId = useMemo(() => {
    if (aliveMafiaPlayers.length === 1) {
      return aliveMafiaPlayers[0].id;
    }
    return null;
  }, [aliveMafiaPlayers]);

  // المقصّى لا يمتلك أي قائمة أو صلاحية أبداً
  const canActAsKillBoss = useMemo(() => {
    if (!me || !isAliveMe) return false;
    if (me.role === "mafia_boss") return true;
    if (!hasAliveBoss && combinedSingleMafiaId === me.id) return true;
    return false;
  }, [me, isAliveMe, hasAliveBoss, combinedSingleMafiaId]);

  const canActAsSilencer = useMemo(() => {
    if (!me || !isAliveMe) return false;
    if (me.role === "mafia_silencer") return true;
    if (!hasAliveSilencer && combinedSingleMafiaId === me.id) return true;
    return false;
  }, [me, isAliveMe, hasAliveSilencer, combinedSingleMafiaId]);

  const canActAsHospital = useMemo(() => {
    return Boolean(me && isAliveMe && me.role === "hospital");
  }, [me, isAliveMe]);

  const killableTargets = useMemo(
    () => alivePlayers.filter((p) => !isMafiaRole(p.role)),
    [alivePlayers]
  );

  const canSilenceTonight = useMemo(() => {
    if (aliveMafiaPlayers.length === 0) return false;
    if (players.length <= 6) return true;
    return aliveMafiaPlayers.length > 0;
  }, [aliveMafiaPlayers.length, players.length]);

  const handleGoHome = () => {
    setScreen("home");
    setActiveRoomCode("");
    setMyPlayerId("");
    setRoomData(null);
    setErrorMsg("");
    setIsRoleVisible(false);
  };

  const patchRoom = async (partial: Partial<ExtendedRoomState>) => {
    if (!activeRoomCode) return;
    await update(ref(db, `rooms/${activeRoomCode}`), partial);
  };

  const resolveNightWithActions = async (
    currentPlayers: Player[],
    actions: NightActions,
    holdForAdminReveal = false
  ) => {
    const currentAlive = currentPlayers.filter((p) => p.status === "alive");
    const currentKillable = currentAlive.filter((p) => !isMafiaRole(p.role));
    const hospitalAlive = currentAlive.some((p) => p.role === "hospital");
    const mafiaAliveCount = currentAlive.filter((p) =>
      isMafiaRole(p.role)
    ).length;
    const silenceActive =
      mafiaAliveCount > 0 &&
      (currentPlayers.length <= 6 ? true : mafiaAliveCount > 0);

    const killTarget = currentKillable.find(
      (p) => p.id === actions.killTargetId
    );
    const silenceTarget = silenceActive
      ? currentAlive.find((p) => p.id === actions.silenceTargetId)
      : null;
    const protectTarget = hospitalAlive
      ? currentAlive.find((p) => p.id === actions.protectTargetId)
      : null;

    const wasProtected =
      Boolean(killTarget) &&
      Boolean(protectTarget) &&
      killTarget?.id === protectTarget?.id;

    const summaryLines: string[] = [];
    let eliminatedId: string | null = null;
    let eliminatedName: string | null = null;
    let eliminatedRole: Player["role"] | null = null;

    if (killTarget) {
      if (wasProtected) {
        summaryLines.push("فشلت عملية الاغتيال.");
      } else {
        eliminatedId = killTarget.id;
        eliminatedName = killTarget.name;
        eliminatedRole = killTarget.role;
        summaryLines.push(
          `تم اغتيال ${killTarget.name} خلال الليل — كرته: ${
            ROLE_META[killTarget.role].arabicName
          }.`
        );
      }
    }

    let silencedId: string | null = null;
    let silencedName: string | null = null;

    if (silenceTarget) {
      silencedId = silenceTarget.id;
      silencedName = silenceTarget.name;
      summaryLines.push(
        `تم تسكيت ${silenceTarget.name} لليوم الحالي (لا يمكنه الكلام في النقاش لكن يحق له التصويت).`
      );
    }

    const updatedPlayers = currentPlayers.map((p) => ({
      ...p,
      status: p.id === eliminatedId ? ("eliminated" as const) : p.status,
      isSilencedToday: p.id === silencedId,
    }));

    const playersMap: Record<string, Player> = {};
    for (const p of updatedPlayers) {
      playersMap[p.id] = p;
    }

    const outcome: NightOutcome = {
      eliminatedPlayerId: eliminatedId,
      eliminatedPlayerName: eliminatedName,
      eliminatedPlayerRole: eliminatedRole,
      wasProtected,
      silencedPlayerId: silencedId,
      silencedPlayerName: silencedName,
      summaryLines,
    };

    const winAfterNight = evaluateVictory(updatedPlayers);

    if (holdForAdminReveal) {
      await patchRoom({
        players: playersMap,
        nightOutcome: outcome,
        pendingVictoryState: winAfterNight,
        phase: "night_pending_reveal",
      });
      return;
    }

    if (winAfterNight) {
      await patchRoom({
        players: playersMap,
        nightOutcome: outcome,
        victoryState: winAfterNight,
        pendingVictoryState: null,
        phase: "victory",
      });
      return;
    }

    await patchRoom({
      players: playersMap,
      nightOutcome: outcome,
      pendingVictoryState: null,
      phase: "night_results",
    });
  };

  const handleRevealNightResultsByAdmin = async () => {
    if (!isHost) return;
    setErrorMsg("");

    if (pendingVictoryState) {
      await patchRoom({
        victoryState: pendingVictoryState,
        pendingVictoryState: null,
        phase: "victory",
      });
      return;
    }

    await patchRoom({
      pendingVictoryState: null,
      phase: "night_results",
    });
  };

  const handleCreateRoom = async () => {
    const trimmed = playerName.trim();
    if (!trimmed) {
      setErrorMsg("يرجى إدخال اسمك أولاً قبل إنشاء الغرفة.");
      return;
    }
    setErrorMsg("");

    const code = generateRoomCode();
    const hostId = crypto.randomUUID();
    const hostPlayer: Player = {
      id: hostId,
      name: trimmed,
      permission: "host",
      role: "good_citizen",
      status: "alive",
      isSilencedToday: false,
      hasConfirmedRole: false,
    };

    const initialState: ExtendedRoomState = {
      roomCode: code,
      phase: "lobby",
      dayNumber: 1,
      players: { [hostId]: hostPlayer },
      nightActions: EMPTY_NIGHT_ACTIONS,
      nightOutcome: null,
      voteTargetId: null,
      voteOutcome: null,
      victoryState: null,
      pendingVictoryState: null,
    };

    try {
      await set(ref(db, `rooms/${code}`), initialState);
      setActiveRoomCode(code);
      setMyPlayerId(hostId);
      setIsRoleVisible(false);
      setScreen("game");
    } catch {
      setErrorMsg(
        "تعذر إنشاء الغرفة، تحقق من اتصالك بالإنترنت وإعدادات قاعدة البيانات."
      );
    }
  };

  const handleJoinRoom = async () => {
    const trimmedName = playerName.trim();
    const trimmedCode = joinCodeInput.trim().toUpperCase();
    if (!trimmedName) {
      setErrorMsg("يرجى إدخال اسمك أولاً.");
      return;
    }
    if (trimmedCode.length < 4) {
      setErrorMsg("يرجى إدخال رمز الغرفة الصحيح.");
      return;
    }
    setErrorMsg("");

    try {
      const snap = await get(ref(db, `rooms/${trimmedCode}`));
      if (!snap.exists()) {
        setErrorMsg("الغرفة غير موجودة، تأكد من رمز الغرفة.");
        return;
      }

      const existing = snap.val() as ExtendedRoomState;
      if (existing.phase !== "lobby") {
        setErrorMsg("اللعبة بدأت بالفعل في هذه الغرفة.");
        return;
      }

      const alreadySameName = Object.values(existing.players ?? {}).some(
        (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
      );
      if (alreadySameName) {
        setErrorMsg("هذا الاسم مستخدم بالفعل في الغرفة، اختر اسماً آخر.");
        return;
      }

      const newId = crypto.randomUUID();
      const newPlayer: Player = {
        id: newId,
        name: trimmedName,
        permission: "player",
        role: "good_citizen",
        status: "alive",
        isSilencedToday: false,
        hasConfirmedRole: false,
      };

      await set(ref(db, `rooms/${trimmedCode}/players/${newId}`), newPlayer);
      setActiveRoomCode(trimmedCode);
      setMyPlayerId(newId);
      setIsRoleVisible(false);
      setScreen("game");
    } catch {
      setErrorMsg("تعذر الانضمام للغرفة، تحقق من الاتصال بالإنترنت.");
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(activeRoomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartGame = async () => {
    if (!isHost) return;
    if (players.length < MIN_PLAYERS) {
      setErrorMsg(`الحد الأدنى لبدء اللعبة هو ${MIN_PLAYERS} لاعبين.`);
      return;
    }
    setErrorMsg("");

    const assigned = assignRolesRandomly(players.length);
    const playersMap: Record<string, Player> = {};
    players.forEach((p, idx) => {
      playersMap[p.id] = {
        ...p,
        role: assigned[idx],
        status: "alive",
        isSilencedToday: false,
        hasConfirmedRole: false,
      };
    });

    setIsRoleVisible(false);
    await patchRoom({
      players: playersMap,
      phase: "role_reveal",
      dayNumber: 1,
      nightActions: EMPTY_NIGHT_ACTIONS,
      nightOutcome: null,
      voteTargetId: null,
      voteOutcome: null,
      victoryState: null,
      pendingVictoryState: null,
    });
  };

  const handleConfirmMyRole = async () => {
    if (!myPlayerId || !activeRoomCode) return;
    await update(ref(db, `rooms/${activeRoomCode}/players/${myPlayerId}`), {
      hasConfirmedRole: true,
    });
    setIsRoleVisible(false);
  };

  const allConfirmedRoles =
    players.length > 0 && players.every((p) => p.hasConfirmedRole);

  const handleEnterNight = async () => {
    if (!isHost) return;
    setErrorMsg("");

    const playersMap: Record<string, Player> = {};
    for (const p of players) {
      playersMap[p.id] = {
        ...p,
        isSilencedToday: false,
      };
    }

    await patchRoom({
      players: playersMap,
      nightActions: EMPTY_NIGHT_ACTIONS,
      nightOutcome: null,
      voteOutcome: null,
      pendingVictoryState: null,
      phase: "night_boss",
    });
  };

  const handleConfirmBossAction = async () => {
    if (!canActAsKillBoss) return;
    if (!nightActions.killTargetId) {
      setErrorMsg("يرجى اختيار هدف الاغتيال قبل الانتقال.");
      return;
    }
    setErrorMsg("");
    if (canSilenceTonight) {
      await patchRoom({ phase: "night_silencer" });
    } else if (hasAliveHospital) {
      await patchRoom({ phase: "night_hospital" });
    } else {
      await resolveNightWithActions(
        players,
        {
          ...nightActions,
          silenceTargetId: null,
          protectTargetId: null,
        },
        true
      );
    }
  };

  const handleConfirmSilencerAction = async () => {
    if (!canActAsSilencer) return;
    if (canSilenceTonight && !nightActions.silenceTargetId) {
      setErrorMsg("التسكيت إجباري — يرجى اختيار لاعب لتسكيته.");
      return;
    }
    setErrorMsg("");
    if (hasAliveHospital) {
      await patchRoom({ phase: "night_hospital" });
    } else {
      await resolveNightWithActions(
        players,
        {
          ...nightActions,
          protectTargetId: null,
        },
        true
      );
    }
  };

  const handleConfirmHospitalAndResolveNight = async () => {
    if (!canActAsHospital) return;
    if (!nightActions.protectTargetId) {
      setErrorMsg("حماية المستشفى إجبارية — يرجى اختيار لاعب لحمايته.");
      return;
    }
    setErrorMsg("");
    await resolveNightWithActions(players, nightActions, true);
  };

  const handleStartDayDiscussion = async () => {
    if (!isHost) return;
    setErrorMsg("");
    await patchRoom({
      voteTargetId: null,
      voteOutcome: null,
      phase: "day_discussion",
    });
  };

  const handleConfirmVote = async () => {
    if (!isHost) return;
    setErrorMsg("");

    if (!voteTargetId) {
      await patchRoom({
        voteOutcome: {
          eliminatedPlayerId: null,
          eliminatedPlayerName: null,
          eliminatedPlayerRole: null,
          message: "لم يتم إقصاء أي لاعب اليوم (امتناع أو تعادل في التصويت).",
        },
        phase: "vote_result",
      });
      return;
    }

    const target = players.find((p) => p.id === voteTargetId);
    const updatedPlayers = players.map((p) =>
      p.id === voteTargetId ? { ...p, status: "eliminated" as const } : p
    );

    const playersMap: Record<string, Player> = {};
    for (const p of updatedPlayers) {
      playersMap[p.id] = p;
    }

    await patchRoom({
      players: playersMap,
      voteOutcome: {
        eliminatedPlayerId: target ? target.id : null,
        eliminatedPlayerName: target ? target.name : null,
        eliminatedPlayerRole: target ? target.role : null,
        message: target
          ? `تم إقصاء ${target.name} بتصويت المدينة في اليوم ${dayNumber}.`
          : "تم إنهاء التصويت.",
      },
      phase: "vote_result",
    });
  };

  const handleProceedAfterVoteResult = async () => {
    if (!isHost) return;
    const winAfterVote = evaluateVictory(players);
    if (winAfterVote) {
      await patchRoom({
        victoryState: winAfterVote,
        pendingVictoryState: null,
        phase: "victory",
      });
      return;
    }

    const playersMap: Record<string, Player> = {};
    for (const p of players) {
      playersMap[p.id] = {
        ...p,
        isSilencedToday: false,
      };
    }

    await patchRoom({
      players: playersMap,
      dayNumber: dayNumber + 1,
      nightActions: EMPTY_NIGHT_ACTIONS,
      nightOutcome: null,
      voteOutcome: null,
      pendingVictoryState: null,
      phase: "night_boss",
    });
  };

  const silencedAliveNames = alivePlayers
    .filter((p) => p.isSilencedToday)
    .map((p) => p.name);

  return (
    <div className="min-h-screen bg-[#0B0B0E] text-[#F5EFE6] flex flex-col items-center justify-center p-4 relative">
      {/* زر جانبي ثابت للعودة للصفحة الرئيسية */}
      {screen !== "home" && (
        <aside className="w-full max-w-md md:w-auto md:max-w-none md:fixed md:top-6 md:start-6 z-20 mb-3 md:mb-0">
          <button
            type="button"
            onClick={handleGoHome}
            className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#141318]/95 hover:bg-[#1F1D26] border border-[#C8A45D]/40 text-xs font-bold text-[#C8A45D] shadow-xl transition cursor-pointer"
          >
            <span>العودة للصفحة الرئيسية</span>
          </button>
        </aside>
      )}

      <div className="w-full max-w-md space-y-5">
        <header className="text-center space-y-1.5">
          <div className="inline-block px-3 py-1 rounded-full border border-[#C8A45D]/40 bg-[#141318] text-xs text-[#C8A45D] tracking-wider">
            لعبة الاستنتاج الاجتماعي • أونلاين
          </div>
          <h1 className="text-4xl font-extrabold tracking-widest text-[#F5EFE6]">
            MAFIA
          </h1>
          <p className="text-xs text-[#F5EFE6]/70">
            غموض الليل، ذكاء التحالف، وقرارات تحسم المصير
          </p>
        </header>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-[#7A1220]/30 border border-[#7A1220] text-sm text-[#F5EFE6] text-center">
            {errorMsg}
          </div>
        )}

        {/* الشاشة الرئيسية */}
        {screen === "home" && (
          <main className="bg-[#141318] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-[#F5EFE6]/85">
                اسمك في اللعبة
              </label>
              <input
                type="text"
                maxLength={20}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="اكتب اسمك هنا..."
                className="w-full px-4 py-3 rounded-xl bg-[#0B0B0E] border border-white/15 text-[#F5EFE6] placeholder:text-white/30 focus:outline-none focus:border-[#C8A45D]"
              />
            </div>

            <button
              onClick={handleCreateRoom}
              className="w-full py-3.5 rounded-xl bg-[#7A1220] hover:bg-[#8E1626] active:scale-[0.99] transition font-bold text-[#F5EFE6] shadow-lg shadow-[#7A1220]/30 cursor-pointer"
            >
              إنشاء غرفة جديدة (مضيف)
            </button>

            <div className="relative flex items-center py-1">
              <div className="grow border-t border-white/10" />
              <span className="px-3 text-xs text-white/40">أو انضم لغرفة</span>
              <div className="grow border-t border-white/10" />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                maxLength={6}
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                placeholder="رمز الغرفة"
                className="flex-1 px-4 py-3 rounded-xl bg-[#0B0B0E] border border-white/15 text-center tracking-widest font-bold uppercase text-[#C8A45D] placeholder:text-white/30 placeholder:tracking-normal placeholder:font-normal focus:outline-none focus:border-[#C8A45D]"
              />
              <button
                onClick={handleJoinRoom}
                className="px-5 py-3 rounded-xl bg-[#1F1D26] hover:bg-[#2A2733] border border-[#C8A45D]/40 font-semibold text-[#C8A45D] transition cursor-pointer"
              >
                انضمام
              </button>
            </div>

            <button
              onClick={() => setScreen("rules")}
              className="w-full py-2.5 rounded-xl border border-white/10 text-sm text-white/75 hover:bg-white/5 transition cursor-pointer"
            >
              قواعد اللعبة والشخصيات
            </button>
          </main>
        )}

        {/* شاشة القواعد */}
        {screen === "rules" && (
          <section className="bg-[#141318] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4">
            <h2 className="text-xl font-bold text-[#C8A45D]">
              الشخصيات وقواعد اللعب
            </h2>
            <div className="space-y-3">
              {Object.entries(ROLE_META).map(([key, info]) => (
                <div
                  key={key}
                  className={`p-3.5 rounded-xl border ${info.badgeBg}`}
                >
                  <h3 className="font-bold text-base mb-1">{info.arabicName}</h3>
                  <p className="text-xs text-white/80 leading-relaxed">
                    {info.shortAbility}
                  </p>
                </div>
              ))}
            </div>
            <div className="text-xs text-white/70 bg-[#0B0B0E] p-3.5 rounded-xl border border-white/10 space-y-1.5 leading-relaxed">
              <p>• 6 لاعبين وأقل: مافيا واحد. 7 لاعبين فأكثر: 2 مافيا.</p>
              <p>
                • إذا تم إقصاء أحد المافيا (شيخ المافيا أو مافيا التسكيت)،
                يستلم الفرد المتبقي من المافيا القائمتين معاً (الاغتيال
                والتسكيت).
              </p>
              <p>
                • أي لاعب يتم إقصاؤه ينتهي دوره بالكامل ولا تظهر له أي قائمة
                أبداً — وحتى المستشفى إذا أُقصي ينتهي دوره في الجيم وتختفي
                قائمته.
              </p>
            </div>
            <button
              onClick={handleGoHome}
              className="w-full py-3 rounded-xl bg-[#1F1D26] border border-white/15 font-semibold hover:bg-white/10 transition cursor-pointer"
            >
              العودة للصفحة الرئيسية
            </button>
          </section>
        )}

        {/* غرفة الانتظار */}
        {screen === "game" && phase === "lobby" && (
          <section className="bg-[#141318] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between bg-[#0B0B0E] p-4 rounded-xl border border-[#C8A45D]/30">
              <div>
                <p className="text-xs text-white/50">رمز الغرفة</p>
                <p className="text-2xl font-extrabold tracking-widest text-[#C8A45D]">
                  {activeRoomCode}
                </p>
              </div>
              <button
                onClick={handleCopyCode}
                className="px-3.5 py-2 rounded-lg bg-[#C8A45D]/15 border border-[#C8A45D]/40 text-xs font-semibold text-[#C8A45D] hover:bg-[#C8A45D]/25 transition cursor-pointer"
              >
                {copied ? "تم النسخ ✓" : "نسخ الرمز"}
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs text-white/60">
                <span>اللاعبون المنضمون ({players.length})</span>
                <span>الحد الأدنى: {MIN_PLAYERS}</span>
              </div>
              <ul className="space-y-2 max-h-56 overflow-y-auto">
                {players.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[#0B0B0E] border border-white/10"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.name}</span>
                      {p.id === myPlayerId && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-white/80">
                          أنت
                        </span>
                      )}
                      {p.permission === "host" && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#C8A45D]/20 text-[#C8A45D] border border-[#C8A45D]/40">
                          المضيف
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2 pt-2">
              {isHost ? (
                <button
                  onClick={handleStartGame}
                  disabled={players.length < MIN_PLAYERS}
                  className="w-full py-3.5 rounded-xl bg-[#7A1220] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#8E1626] transition font-bold text-[#F5EFE6] cursor-pointer"
                >
                  {players.length < MIN_PLAYERS
                    ? `بانتظار ${MIN_PLAYERS - players.length} لاعبين إضافيين`
                    : "بدء اللعبة"}
                </button>
              ) : (
                <div className="p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-center text-xs text-white/70">
                  بانتظار المضيف لبدء اللعبة...
                </div>
              )}

              <button
                onClick={handleGoHome}
                className="w-full py-2.5 rounded-xl border border-white/10 text-xs text-white/60 hover:bg-white/5 transition cursor-pointer"
              >
                مغادرة الغرفة
              </button>
            </div>
          </section>
        )}

        {/* كشف الأدوار السرّي على هاتف كل لاعب */}
        {screen === "game" && phase === "role_reveal" && me && (
          <section className="bg-[#141318] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="space-y-1">
              <p className="text-xs text-[#C8A45D] font-semibold">
                دورك السرّي • {me.name}
              </p>
              <h2 className="text-xl font-bold">اعرف دورك قبل بدء الليل</h2>
              <p className="text-xs text-white/65">
                هذا الدور خاص بك على هاتفك فقط.
              </p>
            </div>

            <div className="bg-[#0B0B0E] border border-white/15 rounded-2xl p-5 text-center space-y-4">
              {!isRoleVisible ? (
                <button
                  onClick={() => setIsRoleVisible(true)}
                  className="w-full py-3.5 rounded-xl bg-[#7A1220] hover:bg-[#8E1626] font-bold transition cursor-pointer"
                >
                  كشف دوري السرّي
                </button>
              ) : (
                <div className="space-y-3">
                  <div
                    className={`p-4 rounded-xl border ${
                      ROLE_META[me.role].badgeBg
                    }`}
                  >
                    <p className="text-xs text-white/60 mb-1">شخصيتك هي</p>
                    <p className="text-2xl font-extrabold text-[#F5EFE6]">
                      {ROLE_META[me.role].arabicName}
                    </p>
                    <p className="text-xs text-white/80 mt-2 leading-relaxed">
                      {ROLE_META[me.role].shortAbility}
                    </p>
                  </div>

                  <button
                    onClick={handleConfirmMyRole}
                    className="w-full py-3 rounded-xl bg-[#1F1D26] hover:bg-white/10 border border-[#C8A45D]/40 text-sm font-bold text-[#C8A45D] transition cursor-pointer"
                  >
                    إخفاء وتأكيد استلام الدور ✓
                  </button>
                </div>
              )}
            </div>

            <div className="text-xs text-white/60 flex justify-between">
              <span>تأكيد اللاعبين:</span>
              <span>
                {players.filter((p) => p.hasConfirmedRole).length}/{players.length}
              </span>
            </div>

            {isHost ? (
              <button
                onClick={() => patchRoom({ phase: "first_day_intro" })}
                disabled={!allConfirmedRoles}
                className="w-full py-3.5 rounded-xl bg-[#C8A45D] text-[#0B0B0E] disabled:opacity-40 disabled:cursor-not-allowed font-extrabold transition cursor-pointer"
              >
                {allConfirmedRoles
                  ? "الانتقال إلى اليوم الأول للتعارف"
                  : "بانتظار تأكيد جميع اللاعبين"}
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-center text-xs text-white/70">
                {me.hasConfirmedRole
                  ? "تم تأكيد دورك — بانتظار المضيف..."
                  : "اكشف دورك وأكّد استلامه."}
              </div>
            )}
          </section>
        )}

        {/* اليوم الأول للتعارف */}
        {screen === "game" && phase === "first_day_intro" && (
          <section className="bg-[#141318] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="space-y-1.5">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-[#C8A45D]/15 text-[#C8A45D] border border-[#C8A45D]/40">
                اليوم الأول • تعارف فقط
              </span>
              <h2 className="text-2xl font-bold">بداية التعارف في المدينة</h2>
              <p className="text-xs text-white/75 leading-relaxed">
                اليوم الأول مخصص للتعارف والنقاش العام فقط — لا يوجد تصويت أو
                إقصاء اليوم.
              </p>
            </div>

            <div className="bg-[#0B0B0E] border border-white/10 rounded-xl p-4 space-y-2">
              <p className="text-xs text-white/55">
                اللاعبون الأحياء ({alivePlayers.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {alivePlayers.map((p) => (
                  <span
                    key={p.id}
                    className="px-3 py-1 rounded-lg bg-[#141318] border border-white/10 text-xs font-semibold"
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            </div>

            {isHost ? (
              <button
                onClick={handleEnterNight}
                className="w-full py-3.5 rounded-xl bg-[#7A1220] hover:bg-[#8E1626] font-bold transition cursor-pointer"
              >
                حلول الليل — بدء الليلة {dayNumber}
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-center text-xs text-white/70">
                بانتظار المضيف لبدء الليل...
              </div>
            )}
          </section>
        )}

        {/* الليل - قائمة الاغتيال (لشيخ المافيا الحي أو المافيا المتبقي الحي عند إقصاء الآخر؛ والمقصّى لا تظهر له أي قائمة) */}
        {screen === "game" && phase === "night_boss" && (
          <section className="bg-[#141318] border border-[#7A1220]/60 rounded-2xl p-6 shadow-2xl space-y-5">
            {canActAsKillBoss ? (
              <>
                <div className="space-y-1">
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-[#7A1220]/30 text-[#F5EFE6] border border-[#7A1220]">
                    الليلة {dayNumber} • خطوة الاغتيال
                  </span>
                  <h2 className="text-2xl font-bold text-[#F5EFE6]">
                    {combinedSingleMafiaId === me?.id
                      ? "قائمة المافيا المتبقي (الاغتيال والتسكيت)"
                      : "قائمة شيخ المافيا"}
                  </h2>
                  <p className="text-xs text-white/65">
                    {combinedSingleMafiaId === me?.id
                      ? "أنت الفرد المتبقي من المافيا — اختر هدف الاغتيال أولاً ثم ستنتقل لقائمة التسكيت."
                      : "اختر هدف الاغتيال (خارج المافيا)."}
                  </p>
                </div>

                <div className="space-y-2">
                  {killableTargets.map((p) => {
                    const selected = nightActions.killTargetId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          patchRoom({
                            nightActions: {
                              ...nightActions,
                              killTargetId: p.id,
                            },
                          })
                        }
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-semibold transition cursor-pointer ${
                          selected
                            ? "bg-[#7A1220]/40 border-[#C8A45D] text-[#F5EFE6]"
                            : "bg-[#0B0B0E] border-white/10 text-white/80 hover:bg-white/5"
                        }`}
                      >
                        <span>{p.name}</span>
                        <span className="text-xs text-[#C8A45D]">
                          {selected ? "هدف الاغتيال ✓" : "اختيار"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={handleConfirmBossAction}
                  className="w-full py-3.5 rounded-xl bg-[#7A1220] hover:bg-[#8E1626] font-bold transition cursor-pointer"
                >
                  {canSilenceTonight
                    ? "تأكيد الاغتيال والانتقال للتسكيت"
                    : "تأكيد قرار الاغتيال وحفظ قرار الليل"}
                </button>
              </>
            ) : (
              <div className="space-y-4 text-center py-2">
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-[#1F1D26] text-[#C8A45D] border border-[#C8A45D]/30">
                  الليلة {dayNumber} • حلول الظلام
                </span>
                <h2 className="text-xl font-bold text-[#F5EFE6]">
                  {isAliveMe ? "المدينة تغط في نوم عميق" : "انتهى دورك في اللعبة"}
                </h2>
                <p className="text-xs text-white/70 leading-relaxed">
                  {isAliveMe
                    ? "المافيا تتخذ قرار الاغتيال الآن في الخفاء. التزم الهدوء ولا تكشف شيئاً عن دورك."
                    : "تم إقصاؤك من اللعبة ولا توجد لك أي قوائم أو أدوار بعد الإقصاء."}
                </p>

                <div className="bg-[#0B0B0E] border border-white/10 rounded-xl p-3.5 text-right space-y-2 text-xs">
                  <div className="flex justify-between text-white/65">
                    <span>حالتك الحالية:</span>
                    <span className="font-semibold text-[#F5EFE6]">
                      {isAliveMe ? "على قيد الحياة" : "مستبعد (منتهي الدور)"}
                    </span>
                  </div>
                  <div className="flex justify-between text-white/65">
                    <span>الأحياء في المدينة:</span>
                    <span className="font-semibold text-[#C8A45D]">
                      {alivePlayers.length} لاعبين
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-white/45">
                  بانتظار انتهاء خطوة الاغتيال للانتقال للخطوة التالية...
                </p>
              </div>
            )}
          </section>
        )}

        {/* الليل - قائمة التسكيت (لمافيا التسكيت الحية أو المافيا المتبقي الحي عند إقصاء الآخر؛ والمقصّى لا تظهر له أي قائمة) */}
        {screen === "game" && phase === "night_silencer" && (
          <section className="bg-[#141318] border border-[#C8A45D]/50 rounded-2xl p-6 shadow-2xl space-y-5">
            {canActAsSilencer ? (
              <>
                <div className="space-y-1">
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-[#C8A45D]/15 text-[#C8A45D] border border-[#C8A45D]/40">
                    الليلة {dayNumber} • خطوة التسكيت
                  </span>
                  <h2 className="text-2xl font-bold text-[#C8A45D]">
                    {combinedSingleMafiaId === me?.id
                      ? "قائمة المافيا المتبقي (التسكيت)"
                      : "قائمة مافيا التسكيت"}
                  </h2>
                  <p className="text-xs text-white/65">
                    التسكيت إجباري — اختر اللاعب الذي سيُمنع من الكلام في نقاش
                    النهار اليوم.
                  </p>
                </div>

                <div className="space-y-2">
                  {alivePlayers.map((p) => {
                    const selected = nightActions.silenceTargetId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          patchRoom({
                            nightActions: {
                              ...nightActions,
                              silenceTargetId: p.id,
                            },
                          })
                        }
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-semibold transition cursor-pointer ${
                          selected
                            ? "bg-[#C8A45D]/20 border-[#C8A45D] text-[#F5EFE6]"
                            : "bg-[#0B0B0E] border-white/10 text-white/80 hover:bg-white/5"
                        }`}
                      >
                        <span>{p.name}</span>
                        <span className="text-xs text-[#C8A45D]">
                          {selected ? "هدف التسكيت ✓" : "اختيار"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={handleConfirmSilencerAction}
                  className="w-full py-3.5 rounded-xl bg-[#C8A45D] text-[#0B0B0E] font-extrabold transition cursor-pointer"
                >
                  تأكيد قرار التسكيت وحفظ قرار الليل
                </button>
              </>
            ) : (
              <div className="space-y-4 text-center py-2">
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-[#1F1D26] text-[#C8A45D] border border-[#C8A45D]/30">
                  الليلة {dayNumber} • همسات الظلام
                </span>
                <h2 className="text-xl font-bold text-[#F5EFE6]">
                  {isAliveMe ? "الليل مستمر في المدينة" : "انتهى دورك في اللعبة"}
                </h2>
                <p className="text-xs text-white/70 leading-relaxed">
                  {isAliveMe
                    ? "يتم الآن تحديد من سيُمنع من الكلام في نقاش النهار. التزم الهدوء ولا تكشف شيئاً."
                    : "تم إقصاؤك من اللعبة ولا توجد لك أي قوائم أو أدوار بعد الإقصاء."}
                </p>

                <div className="bg-[#0B0B0E] border border-white/10 rounded-xl p-3.5 text-right space-y-2 text-xs">
                  <div className="flex justify-between text-white/65">
                    <span>حالتك الحالية:</span>
                    <span className="font-semibold text-[#F5EFE6]">
                      {isAliveMe ? "على قيد الحياة" : "مستبعد (منتهي الدور)"}
                    </span>
                  </div>
                  <div className="flex justify-between text-white/65">
                    <span>الأحياء في المدينة:</span>
                    <span className="font-semibold text-[#C8A45D]">
                      {alivePlayers.length} لاعبين
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-white/45">
                  بانتظار انتهاء خطوة التسكيت...
                </p>
              </div>
            )}
          </section>
        )}

        {/* الليل - قائمة المستشفى (للمستشفى الحي فقط؛ إذا تم إقصاء المستشفى ينتهي دوره وتختفي قائمته) */}
        {screen === "game" && phase === "night_hospital" && hasAliveHospital && (
          <section className="bg-[#141318] border border-emerald-500/40 rounded-2xl p-6 shadow-2xl space-y-5">
            {canActAsHospital ? (
              <>
                <div className="space-y-1">
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-emerald-950 text-emerald-300 border border-emerald-700/50">
                    الليلة {dayNumber} • خطوة المستشفى
                  </span>
                  <h2 className="text-2xl font-bold text-emerald-300">
                    قائمة المستشفى
                  </h2>
                  <p className="text-xs text-white/65">
                    حماية المستشفى إجبارية — اختر لاعباً لحمايته الليلة (يمكنك
                    حماية نفسك).
                  </p>
                </div>

                <div className="space-y-2">
                  {alivePlayers.map((p) => {
                    const selected = nightActions.protectTargetId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          patchRoom({
                            nightActions: {
                              ...nightActions,
                              protectTargetId: p.id,
                            },
                          })
                        }
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-semibold transition cursor-pointer ${
                          selected
                            ? "bg-emerald-950/80 border-emerald-400 text-[#F5EFE6]"
                            : "bg-[#0B0B0E] border-white/10 text-white/80 hover:bg-white/5"
                        }`}
                      >
                        <span>{p.name}</span>
                        <span className="text-xs text-emerald-300">
                          {selected ? "تحت الحماية ✓" : "اختيار"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={handleConfirmHospitalAndResolveNight}
                  className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-[#0B0B0E] font-extrabold transition cursor-pointer"
                >
                  تأكيد الحماية وحفظ قرار الليل
                </button>
              </>
            ) : (
              <div className="space-y-4 text-center py-2">
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-emerald-950/70 text-emerald-300 border border-emerald-700/40">
                  الليلة {dayNumber} • داخل المستشفى
                </span>
                <h2 className="text-xl font-bold text-[#F5EFE6]">
                  {isAliveMe
                    ? "الطاقم الطبي في حالة استنفار"
                    : "انتهى دورك في اللعبة"}
                </h2>
                <p className="text-xs text-white/70 leading-relaxed">
                  {isAliveMe
                    ? "المستشفى يختار الآن من سيحصل على الحماية الليلة. ابقَ هادئاً وانتظر إشراقة الصباح."
                    : "تم إقصاؤك من اللعبة ولا توجد لك أي قوائم أو أدوار بعد الإقصاء."}
                </p>

                <div className="bg-[#0B0B0E] border border-white/10 rounded-xl p-3.5 text-right space-y-2 text-xs">
                  <div className="flex justify-between text-white/65">
                    <span>حالتك الحالية:</span>
                    <span className="font-semibold text-[#F5EFE6]">
                      {isAliveMe ? "على قيد الحياة" : "مستبعد (منتهي الدور)"}
                    </span>
                  </div>
                  <div className="flex justify-between text-white/65">
                    <span>الأحياء في المدينة:</span>
                    <span className="font-semibold text-emerald-300">
                      {alivePlayers.length} لاعبين
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-white/45">
                  بانتظار تأكيد الحماية...
                </p>
              </div>
            )}
          </section>
        )}

        {/* انتظار إظهار نتائج الليل من الأدمن */}
        {screen === "game" && phase === "night_pending_reveal" && (
          <section className="bg-[#141318] border border-[#C8A45D]/40 rounded-2xl p-6 shadow-2xl space-y-5 text-center">
            <div className="space-y-2">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-[#C8A45D]/15 text-[#C8A45D] border border-[#C8A45D]/40">
                الليلة {dayNumber} • اكتمال قرارات الليل
              </span>
              <h2 className="text-xl font-bold text-[#F5EFE6]">
                {isHost
                  ? "نتائج الليل جاهزة للإظهار"
                  : "الليل شارف على الانتهاء"}
              </h2>
              <p className="text-xs text-white/70 leading-relaxed">
                {isHost
                  ? "تم تسجيل قرارات الليل بنجاح. اضغط الزر بالأسفل لإظهار نتائج الليل للجميع."
                  : "تم تسجيل قرارات الليل، وبانتظار الأدمن لإظهار نتائج الليل للجميع."}
              </p>
            </div>

            {isHost ? (
              <button
                type="button"
                onClick={handleRevealNightResultsByAdmin}
                className="w-full py-3.5 rounded-xl bg-[#C8A45D] text-[#0B0B0E] font-extrabold transition cursor-pointer"
              >
                إظهار نتائج الليل للجميع
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-center text-xs text-white/70">
                بانتظار الأدمن لإظهار كل شيء للكل...
              </div>
            )}
          </section>
        )}

        {/* نتائج الليل */}
        {screen === "game" && phase === "night_results" && nightOutcome && (
          <section className="bg-[#141318] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="space-y-1">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-[#C8A45D]/15 text-[#C8A45D] border border-[#C8A45D]/40">
                إشراقة الصباح • نتائج الليلة {dayNumber}
              </span>
              <h2 className="text-xl font-bold">ما الذي حدث في الليل؟</h2>
            </div>

            <div className="bg-[#0B0B0E] border border-white/10 rounded-xl p-4 space-y-2.5 text-sm leading-relaxed">
              {nightOutcome.summaryLines.map((line, i) => (
                <p key={i} className="text-[#F5EFE6]/90">
                  • {line}
                </p>
              ))}
            </div>

            {nightOutcome.eliminatedPlayerName &&
              nightOutcome.eliminatedPlayerRole && (
                <div
                  className={`p-4 rounded-xl border text-center space-y-1 ${
                    ROLE_META[nightOutcome.eliminatedPlayerRole].badgeBg
                  }`}
                >
                  <p className="text-xs text-white/60">كرت المغتال</p>
                  <p className="text-lg font-extrabold">
                    {nightOutcome.eliminatedPlayerName}
                  </p>
                  <p className="text-sm font-bold text-[#C8A45D]">
                    {ROLE_META[nightOutcome.eliminatedPlayerRole].arabicName}
                  </p>
                </div>
              )}

            {isHost ? (
              <button
                onClick={handleStartDayDiscussion}
                className="w-full py-3.5 rounded-xl bg-[#C8A45D] text-[#0B0B0E] font-extrabold transition cursor-pointer"
              >
                بدء نقاش النهار (اليوم {dayNumber})
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-center text-xs text-white/70">
                بانتظار المضيف لبدء نقاش النهار...
              </div>
            )}
          </section>
        )}

        {/* النقاش النهاري */}
        {screen === "game" && phase === "day_discussion" && (
          <section className="bg-[#141318] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="space-y-1">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-[#C8A45D]/15 text-[#C8A45D] border border-[#C8A45D]/40">
                اليوم {dayNumber} • مرحلة النقاش والتحليل
              </span>
              <h2 className="text-xl font-bold">نقاش النهار</h2>
              <p className="text-xs text-white/70 leading-relaxed">
                تبادلوا الأدلة والشكوك حول ما حدث في الليل قبل الانتقال إلى
                التصويت.
              </p>
            </div>

            {silencedAliveNames.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200 leading-relaxed">
                <strong>تنبيه التسكيت:</strong> {silencedAliveNames.join("، ")}{" "}
                مسكّت اليوم — لا يمكنه الكلام في النقاش لكن يحق له التصويت.
              </div>
            )}

            <div className="bg-[#0B0B0E] border border-white/10 rounded-xl p-4 space-y-2">
              <p className="text-xs text-white/60">
                اللاعبون الأحياء ({alivePlayers.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {alivePlayers.map((p) => (
                  <span
                    key={p.id}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                      p.isSilencedToday
                        ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                        : "bg-[#141318] border-white/10 text-[#F5EFE6]"
                    }`}
                  >
                    {p.name} {p.isSilencedToday ? "(مسكّت)" : ""}
                  </span>
                ))}
              </div>
            </div>

            {isHost ? (
              <button
                onClick={() => patchRoom({ voteTargetId: null, phase: "voting" })}
                className="w-full py-3.5 rounded-xl bg-[#7A1220] hover:bg-[#8E1626] font-bold transition cursor-pointer"
              >
                الانتقال إلى التصويت
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-center text-xs text-white/70">
                بانتظار المضيف لبدء التصويت...
              </div>
            )}
          </section>
        )}

        {/* التصويت والإقصاء */}
        {screen === "game" && phase === "voting" && (
          <section className="bg-[#141318] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="space-y-1">
              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs bg-[#7A1220]/30 text-[#F5EFE6] border border-[#7A1220]">
                اليوم {dayNumber} • قرار الأغلبية
              </span>
              <h2 className="text-xl font-bold">التصويت على الإقصاء</h2>
              <p className="text-xs text-white/65">
                {isHost
                  ? "اختر اللاعب الذي قررت المدينة إقصاءه، أو اتركه بدون إقصاء في حال التعادل أو الامتناع."
                  : "عرض حالة التصويت الحالية — اختيار اللاعب وتأكيد الإقصاء متاح للأدمن فقط."}
              </p>
            </div>

            <div className="space-y-2">
              {alivePlayers.map((p) => {
                const selected = voteTargetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!isHost}
                    onClick={() => {
                      if (!isHost) return;
                      patchRoom({ voteTargetId: selected ? null : p.id });
                    }}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-semibold transition ${
                      selected
                        ? "bg-[#7A1220]/35 border-[#C8A45D] text-[#F5EFE6]"
                        : "bg-[#0B0B0E] border-white/10 text-white/80"
                    } ${
                      isHost
                        ? "hover:bg-white/5 cursor-pointer"
                        : "opacity-85 cursor-default"
                    }`}
                  >
                    <span>{p.name}</span>
                    <span className="text-xs text-[#C8A45D]">
                      {selected
                        ? "مختار للإقصاء ✓"
                        : isHost
                        ? "اختيار"
                        : "بانتظار الأدمن"}
                    </span>
                  </button>
                );
              })}
            </div>

            {isHost ? (
              <button
                onClick={handleConfirmVote}
                className="w-full py-3.5 rounded-xl bg-[#C8A45D] text-[#0B0B0E] font-extrabold transition cursor-pointer"
              >
                {voteTargetId
                  ? "تأكيد إقصاء اللاعب المختار"
                  : "إنهاء التصويت بدون إقصاء"}
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-center text-xs text-white/70">
                بانتظار الأدمن لاعتماد نتيجة التصويت...
              </div>
            )}
          </section>
        )}

        {/* شاشة نتيجة التصويت وكرت المقصّى */}
        {screen === "game" && phase === "vote_result" && voteOutcome && (
          <section className="bg-[#141318] border border-white/10 rounded-2xl p-6 shadow-2xl text-center space-y-5">
            <div className="space-y-1.5">
              <span className="inline-block px-3 py-1 rounded-full text-xs bg-[#7A1220]/30 text-[#F5EFE6] border border-[#7A1220]">
                نتيجة التصويت • اليوم {dayNumber}
              </span>
              <h2 className="text-2xl font-bold">{voteOutcome.message}</h2>
            </div>

            {voteOutcome.eliminatedPlayerName &&
              voteOutcome.eliminatedPlayerRole && (
                <div
                  className={`p-5 rounded-2xl border space-y-2 ${
                    ROLE_META[voteOutcome.eliminatedPlayerRole].badgeBg
                  }`}
                >
                  <p className="text-xs text-white/60">كرت اللاعب المقصّى</p>
                  <p className="text-2xl font-extrabold text-[#F5EFE6]">
                    {voteOutcome.eliminatedPlayerName}
                  </p>
                  <p className="text-lg font-extrabold text-[#C8A45D]">
                    {ROLE_META[voteOutcome.eliminatedPlayerRole].arabicName}
                  </p>
                  <p className="text-xs text-white/75 leading-relaxed">
                    {ROLE_META[voteOutcome.eliminatedPlayerRole].shortAbility}
                  </p>
                </div>
              )}

            {isHost ? (
              <button
                onClick={handleProceedAfterVoteResult}
                className="w-full py-3.5 rounded-xl bg-[#C8A45D] text-[#0B0B0E] font-extrabold transition cursor-pointer"
              >
                تغميض ومتابعة الجولة
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-center text-xs text-white/70">
                بانتظار المضيف لمتابعة الجولة...
              </div>
            )}
          </section>
        )}

        {/* شاشة النصر */}
        {screen === "game" && phase === "victory" && victoryState && (
          <section className="bg-[#141318] border border-[#C8A45D]/50 rounded-2xl p-6 shadow-2xl text-center space-y-5">
            <div className="space-y-2">
              <span className="inline-block px-3 py-1 rounded-full text-xs bg-[#C8A45D]/20 text-[#C8A45D] border border-[#C8A45D]/40 font-bold">
                نهاية الجولة
              </span>
              <h2 className="text-3xl font-extrabold text-[#C8A45D]">
                {victoryState.winner === "mafia"
                  ? "فوز المافيا!"
                  : "فوز المواطنين!"}
              </h2>
              <p className="text-xs text-white/80 leading-relaxed">
                {victoryState.reason}
              </p>
            </div>

            <div className="bg-[#0B0B0E] border border-white/10 rounded-xl p-4 text-right space-y-2">
              <p className="text-xs text-white/60">كشف الأدوار النهائي:</p>
              <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                {players.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#141318] border border-white/10 text-xs"
                  >
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-[#C8A45D] font-bold">
                      {ROLE_META[p.role].arabicName}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              {isHost && (
                <button
                  onClick={handleStartGame}
                  className="w-full py-3.5 rounded-xl bg-[#7A1220] hover:bg-[#8E1626] font-bold transition cursor-pointer"
                >
                  لعب جولة جديدة بنفس اللاعبين
                </button>
              )}
              <button
                onClick={handleGoHome}
                className="w-full py-2.5 rounded-xl border border-white/10 text-xs text-white/70 hover:bg-white/5 transition cursor-pointer"
              >
                العودة إلى الشاشة الرئيسية
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}