import type { CharacterRole } from "../types/game";

export const MIN_PLAYERS = 4;

export interface RoleInfo {
  arabicName: string;
  shortAbility: string;
  badgeBg: string;
}

export const ROLE_META: Record<CharacterRole, RoleInfo> = {
  mafia_boss: {
    arabicName: "شيخ المافيا",
    shortAbility:
      "يختار هدف الاغتيال في الليل (لا يغتال نفسه أو زميله)، وعند 7+ لاعبين يتولى التسكيت أيضاً إذا خرج زميله.",
    badgeBg: "bg-[#7A1220]/25 border-[#7A1220] text-[#F5EFE6]",
  },
  mafia_silencer: {
    arabicName: "مافيا التسكيت",
    shortAbility:
      "يختار إجبارياً لاعباً لتسكيته في الليل فيُمنع من الكلام نهاراً لكنه يصوّت، وعند 7+ لاعبين يتولى الاغتيال أيضاً إذا خرج زميله.",
    badgeBg: "bg-[#5A0E18]/30 border-[#C8A45D]/50 text-[#F5EFE6]",
  },
  hospital: {
    arabicName: "المستشفى",
    shortAbility:
      "يختار إجبارياً لاعباً لحمايته من الاغتيال في الليل (ويمكنه حماية نفسه) ما دام على قيد الحياة.",
    badgeBg: "bg-emerald-950/50 border-emerald-600/50 text-emerald-200",
  },
  good_citizen: {
    arabicName: "مواطن صالح",
    shortAbility:
      "يحلل أحداث الليل والنهار ويشارك في التصويت لكشف أفراد المافيا وإقصائهم.",
    badgeBg: "bg-[#1F1D26] border-white/15 text-[#F5EFE6]",
  },
};

export function assignRolesRandomly(playerCount: number): CharacterRole[] {
  const roles: CharacterRole[] = [];

  if (playerCount <= 6) {
    // 6 لاعبين وأقل: مافيا واحد فقط
    roles.push("mafia_boss");
  } else {
    // 7 لاعبين فأكثر: 2 مافيا
    roles.push("mafia_boss", "mafia_silencer");
  }

  if (playerCount - roles.length >= 1) {
    roles.push("hospital");
  }

  while (roles.length < playerCount) {
    roles.push("good_citizen");
  }

  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  return roles;
}