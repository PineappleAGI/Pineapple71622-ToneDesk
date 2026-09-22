/**
 * Rewrite a message for a tone and audience.
 * Transforms the user's own words. Notes describe what changed.
 */

import { transformFreeText } from "./templates.js";
import { diffWords } from "./diff.js";

export const TONES = [
  { id: "formal", label: "Formal", hint: "Polished and professional", keys: "formal professional proper business polished" },
  { id: "warm", label: "Warm", hint: "Friendly without filler", keys: "warm warmer friendly kind human approachable" },
  { id: "direct", label: "Direct", hint: "The point, then the context", keys: "direct clear straightforward blunt ask" },
  { id: "concise", label: "Concise", hint: "Shorter and easier to scan", keys: "concise short shorter brief tight summary" },
  { id: "confident", label: "Confident", hint: "Clear, without hedging", keys: "confident assertive sure strong" },
  { id: "diplomatic", label: "Diplomatic", hint: "Firm, and still considerate", keys: "diplomatic soft softer polite gentle tactful" }
];

export const AUDIENCES = [
  { id: "recruiter", label: "Recruiter/Hiring Manager" },
  { id: "manager", label: "Manager/Boss" },
  { id: "professor", label: "Professor" },
  { id: "client", label: "Client/External" },
  { id: "peer", label: "Peer/Colleague" }
];

const HEDGES = [
  "i think maybe",
  "i was wondering if",
  "sorry to bother",
  "if it's not too much trouble",
  "i think",
  "i feel like",
  "sort of",
  "kind of",
  "maybe",
  "just"
];

export function rewriteMessage(text, { tone = "formal", audience = "peer", platform = "" } = {}) {
  const source = String(text || "").trim();
  if (!source) return { text: "", notes: [] };

  const toneId = TONES.some((item) => item.id === tone) ? tone : "formal";
  const audienceId = AUDIENCES.some((item) => item.id === audience) ? audience : "peer";

  let next = transformFreeText(source, toneId, null);
  next = applyAudienceFrame(next, audienceId);
  if ((platform === "slack" || platform === "teams") && toneId === "concise") {
    const lines = next.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 2) next = lines.slice(0, 2).join("\n");
  }
  next = tidy(next) || source;

  return {
    text: next,
    notes: explainEdit(source, next, { tone: toneId, audience: audienceId, platform })
  };
}

function applyAudienceFrame(text, audience) {
  let out = String(text || "");
  if (audience === "professor") {
    out = out.replace(/^(hey|hi|hello|yo)\b[,!]?\s*/i, "Dear Professor, ");
  } else if (audience === "client" || audience === "recruiter") {
    out = out.replace(/^(hey|yo)\b/i, "Hello");
  } else if (audience === "manager") {
    out = out.replace(/^(hey|yo)\b/i, "Hello");
  } else if (audience === "peer") {
    out = out.replace(/^(yo|hey guys)\b/i, "Hi");
  }
  return tidy(out);
}

export function explainEdit(before, after, { tone, audience, platform }) {
  const notes = [];
  const hedge = findRemovedHedge(before, after);
  if (hedge) notes.push(`Removed hedging language ('${hedge}')`);

  const beforeLen = before.replace(/\s+/g, " ").trim().length;
  const afterLen = after.replace(/\s+/g, " ").trim().length;
  if (beforeLen > 40 && afterLen < beforeLen * 0.85) {
    notes.push(
      platform === "slack" || platform === "teams"
        ? "Shortened for a chat-sized message"
        : "Shortened so the point is easier to scan"
    );
  }

  if (tone === "direct" && askMovedUp(before, after)) {
    notes.push("Added a clear ask up front");
  }
  if (tone === "formal" && /^(hello|dear)\b/i.test(after) && /^(hey|hi|yo)\b/i.test(before)) {
    notes.push("Raised the greeting for a more formal audience");
  }
  if (tone === "warm" && before !== after) notes.push("Warmed the wording without adding filler");
  if (tone === "confident" && before !== after) notes.push("Replaced tentative phrasing with a clear statement");
  if (tone === "diplomatic" && before !== after) notes.push("Softened blunt wording while keeping the point");
  if (tone === "concise" && before !== after && !notes.some((note) => note.startsWith("Shortened"))) {
    notes.push("Cut warmup lines so the message is easier to scan");
  }

  if (audience === "recruiter" && before !== after) {
    notes.push("Shaped for a recruiter: specific, brief, and easy to act on");
  } else if (audience === "professor" && /dear professor/i.test(after)) {
    notes.push("Adjusted the greeting for a professor");
  } else if (audience === "client" && before !== after) {
    notes.push("Matched the formality of a note to a client");
  } else if (audience === "manager" && before !== after) {
    notes.push("Kept the note direct for a manager");
  }

  if (!notes.length) {
    notes.push(before === after ? "Wording already fits this tone and audience" : "Adjusted wording to match the selected tone and audience");
  }
  return notes.slice(0, 4);
}

function findRemovedHedge(before, after) {
  const source = before.toLowerCase();
  const result = after.toLowerCase();
  for (const hedge of HEDGES) {
    if (source.includes(hedge) && !result.includes(hedge)) {
      const match = before.match(new RegExp(hedge.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
      return match ? match[0] : hedge;
    }
  }
  return "";
}

function askMovedUp(before, after) {
  const firstBefore = firstSentence(before);
  const firstAfter = firstSentence(after);
  const beforeAsk = /\?/.test(firstBefore) || /\b(please|could you|can you|would you)\b/i.test(firstBefore);
  const afterAsk = /\?/.test(firstAfter) || /\b(please|could you|can you|would you)\b/i.test(firstAfter);
  return afterAsk && !beforeAsk;
}

function firstSentence(text) {
  return String(text || "").trim().split(/(?<=[.!?])\s+/)[0] || "";
}

function tidy(s) {
  return String(s || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s+!/g, "!")
    .replace(/\s+\?/g, "?")
    .replace(/ ([,.;!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function changedWords(before, after) {
  return diffWords(before, after).some((part) => part.type !== "same");
}
