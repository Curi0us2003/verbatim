// Fictional demo session for the review page (Phase 1). No real client data.
import type { Exchange, Insight, SessionDetail, Turn, Word } from "@/types";

/** Spread a turn's words evenly over its time span; words at `unclear` indexes get low confidence. */
function words(text: string, start: number, end: number, unclear: number[] = []): Word[] {
  const tokens = text.split(/\s+/).filter((t) => t && !/^\[pause/.test(t) && !/^\d+s\]$/.test(t));
  const step = (end - start) / Math.max(tokens.length, 1);
  return tokens.map((word, i) => ({
    word,
    start: +(start + i * step).toFixed(2),
    end: +(start + (i + 1) * step).toFixed(2),
    score: unclear.includes(i) ? 0.31 : 0.93,
  }));
}

let nextTurnId = 1;
function turn(role: Turn["role"], start: number, end: number, text: string, unclear: number[] = []): Turn {
  const id = nextTurnId++;
  return {
    id,
    session_id: 0,
    index: id - 1,
    speaker_raw: role === "counsellor" ? "SPEAKER_00" : "SPEAKER_01",
    role,
    start,
    end,
    text,
    words_json: words(text, start, end, unclear),
    edited: false,
  };
}

const turns: Turn[] = [
  turn("counsellor", 2.1, 9.4, "Thanks for coming in today. How have things been since we last met?"),
  turn(
    "client",
    10.2,
    31.8,
    "Um, honestly? It's been... it's been a lot. Work has been, uh, really heavy, and I keep, I keep thinking I'm going to mess something up. [pause 3s] I don't sleep much.",
  ),
  turn("counsellor", 32.5, 41.0, "That sounds exhausting. When you say you'll mess something up, what do you picture happening?"),
  turn(
    "client",
    42.3,
    70.6,
    "Like, my manager calls me in and it's, you know, the end. Everyone finds out I'm not actually good at this. [pause 4s] Which is silly, I know. I've never actually been told I'm doing badly.",
    [23],
  ),
  turn("counsellor", 71.4, 79.9, "You've never been told that, and still the fear is very loud. Where do you think it comes from?"),
  turn(
    "client",
    81.0,
    104.2,
    "Hmm. My dad was, uh, he was strict. Like, a ninety-five was not a hundred. So maybe that. I mean, I don't blame him, he wanted the best for us.",
  ),
  turn("counsellor", 105.0, 112.6, "What would feel different for you if that voice were a little quieter?"),
  turn(
    "client",
    113.8,
    132.5,
    "I'd... I think I'd actually enjoy my work? I used to really like it. And I'd sleep. [pause 2s] Yeah. I'd like to sleep.",
  ),
];

const insights: Insight[] = [
  {
    client_meaning:
      "The client seems to be feeling overwhelmed by work and carrying a persistent worry about making mistakes. The mention of poor sleep suggests the stress may be affecting them physically as well.",
    evidence: ["it's been a lot", "I keep thinking I'm going to mess something up", "I don't sleep much"],
    emotions: ["overwhelmed", "anxious", "tired"],
    underlying_need: "May need relief from pressure and reassurance that they are coping.",
    confidence: "high",
    suggested_follow_up: "What does a typical night look like when the work worries come up?",
    risk_flag: false,
    risk_note: "",
  },
  {
    client_meaning:
      "The client appears to fear being exposed as not good enough, even though they acknowledge there is no evidence for it. Calling the fear \"silly\" may show they are judging themselves for having it.",
    evidence: ["Everyone finds out I'm not actually good at this", "Which is silly, I know"],
    emotions: ["fearful", "self-critical"],
    underlying_need: "Seems to want to feel competent and accepted without having to prove it constantly.",
    confidence: "medium",
    suggested_follow_up: "When you notice yourself calling the fear silly, what happens to the feeling?",
    risk_flag: false,
    risk_note: "",
  },
  {
    client_meaning:
      "The client may be linking their high standards to a strict upbringing. They seem to want to protect their father's intentions while exploring this connection.",
    evidence: ["a ninety-five was not a hundred", "I don't blame him"],
    emotions: ["reflective", "conflicted"],
    underlying_need: "May need space to explore the past without feeling disloyal to family.",
    confidence: "medium",
    suggested_follow_up: "What was it like for you, growing up, when something was a ninety-five?",
    risk_flag: false,
    risk_note: "",
  },
  {
    client_meaning:
      "The client seems to remember a time when work was enjoyable and hopes to return to it. Rest stands out as something they want very simply and strongly.",
    evidence: ["I used to really like it", "I'd like to sleep"],
    emotions: ["hopeful", "weary"],
    underlying_need: "Seems to need rest and to reconnect with the parts of work they enjoy.",
    confidence: "high",
    suggested_follow_up: "What did you enjoy most about your work back when you liked it?",
    risk_flag: false,
    risk_note: "",
  },
];

const exchanges: Exchange[] = insights.map((insight, i) => ({
  id: i + 1,
  session_id: 0,
  index: i,
  counsellor_turn_ids: [turns[i * 2].id],
  client_turn_ids: [turns[i * 2 + 1].id],
  insight_json: insight,
  counsellor_feedback: i === 0 ? "agree" : null,
  counsellor_note: null,
}));

export const DEMO_SESSION: SessionDetail = {
  id: 0,
  title: "Session 3 — work stress (demo)",
  client_code: "C-014",
  language: "en",
  created_at: "2026-10-10T10:30:00+00:00",
  consent_at: "2026-10-10T10:29:00+00:00",
  duration_sec: 133,
  status: "ready",
  error: null,
  counsellor_speaker: "SPEAKER_00",
  turns,
  exchanges,
  summary: {
    session_id: 0,
    model_used: "placeholder",
    created_at: "2026-10-10T11:30:00+00:00",
    summary_json: {
      overview:
        "The client described feeling overwhelmed at work and a strong fear of being found out as not good enough, despite no negative feedback. They began to connect these high standards with a strict upbringing. Toward the end they expressed a hope to enjoy work again and to sleep better.",
      main_themes: ["Work pressure", "Fear of failure", "High personal standards", "Sleep"],
      client_goals: ["Enjoy work again", "Sleep better"],
      key_concerns: ["Persistent worry about mistakes", "Poor sleep", "Harsh self-judgement"],
      emotional_shifts: ["early: overwhelmed and anxious -> later: reflective and quietly hopeful"],
      strengths_noticed: ["Insight into where the fear may come from", "Able to name what they want"],
      topics_for_next_session: ["Sleep routine", "The 'ninety-five' standard", "What made work enjoyable before"],
      risk_flags: [],
    },
  },
};
