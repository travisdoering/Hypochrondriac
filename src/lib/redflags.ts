/**
 * Instant, client-side red-flag detection. This runs on every outgoing
 * message BEFORE the model answers so a user describing a stroke, a heart
 * attack, anaphylaxis or a suicidal crisis sees emergency guidance within
 * milliseconds, not after a streamed paragraph.
 *
 * It is deliberately conservative (prefers false positives). The model's own
 * triage decision then confirms or lowers the level.
 */

import type { TriageLevel } from "./record";

export interface RedFlag {
  level: TriageLevel;
  title: string;
  advice: string;
  resources: { label: string; value: string; href?: string }[];
}

interface Rule {
  pattern: RegExp;
  flag: RedFlag;
}

const US_EMERGENCY = { label: "Emergency", value: "911", href: "tel:911" };
const CRISIS_LINE = {
  label: "Suicide & Crisis Lifeline (US)",
  value: "988",
  href: "tel:988",
};
const CRISIS_TEXT = { label: "Crisis Text Line", value: 'Text "HOME" to 741741', href: "sms:741741" };
const POISON = {
  label: "Poison Control (US)",
  value: "1-800-222-1222",
  href: "tel:18002221222",
};

const RULES: Rule[] = [
  {
    pattern:
      /\b(suicid\w*|kill (myself|me)|end (my|it all)|want to die|don'?t want to (live|be alive|be here)|hurt myself|self[- ]harm|cutting myself|overdos\w* on purpose|no reason to live)\b/i,
    flag: {
      level: "emergency",
      title: "You matter, and help is available right now",
      advice:
        "If you are in immediate danger, call 911 or go to the nearest emergency room. If you can, reach out to someone you trust and stay with them. The 988 Lifeline is free, confidential, and open 24/7.",
      resources: [CRISIS_LINE, CRISIS_TEXT, US_EMERGENCY],
    },
  },
  {
    pattern:
      /\b(chest (pain|pressure|tightness|crushing)|crushing (pain|pressure)|pain (spreading|radiating) (to|down) (my )?(left )?(arm|jaw|back)|heart attack)\b/i,
    flag: {
      level: "emergency",
      title: "Possible heart emergency",
      advice:
        "Chest pain or pressure, especially with shortness of breath, sweating, nausea, or pain spreading to the arm, jaw or back, can be a heart attack. Call 911 now. Do not drive yourself. If you are not allergic and have no reason not to, chewing a regular aspirin while waiting is commonly advised by emergency dispatchers.",
      resources: [US_EMERGENCY],
    },
  },
  {
    pattern:
      /\b(face (is )?droop\w*|facial droop|slurr\w* speech|can'?t (speak|talk|move my (arm|leg|face))|one side (of my body )?(is )?(weak|numb)|sudden (confusion|trouble seeing|severe headache|numbness|weakness)|worst headache of my life|stroke)\b/i,
    flag: {
      level: "emergency",
      title: "Possible stroke - every minute counts",
      advice:
        "Face drooping, arm weakness, or speech difficulty are stroke signs. Note the time symptoms started and call 911 immediately. Do not wait to see if it passes.",
      resources: [US_EMERGENCY],
    },
  },
  {
    pattern:
      /\b(can'?t breathe|cannot breathe|struggling to breathe|gasping|lips? (are |turning )?(blue|purple|gray)|throat (is )?(closing|swelling)|tongue (is )?swelling|anaphyla\w*)\b/i,
    flag: {
      level: "emergency",
      title: "Breathing emergency",
      advice:
        "Severe trouble breathing, throat or tongue swelling, or blue lips need emergency care now. Call 911. If this is a known severe allergy and an epinephrine auto-injector (EpiPen) is available, use it right away.",
      resources: [US_EMERGENCY],
    },
  },
  {
    pattern:
      /\b(unconscious|passed out and (won'?t|not) wak\w*|not breathing|no pulse|seizure (that )?(won'?t|hasn'?t) stop\w*|seizing for)\b/i,
    flag: {
      level: "emergency",
      title: "Life-threatening emergency",
      advice:
        "Call 911 now. If someone is not breathing or has no pulse, start CPR: push hard and fast in the center of the chest, about twice per second, and do not stop until help arrives.",
      resources: [US_EMERGENCY],
    },
  },
  {
    pattern:
      /\b(won'?t stop bleeding|bleeding (heavily|a lot|won'?t stop|through)|spurting|soaked through|coughing up blood|vomit\w* blood|throwing up blood)\b/i,
    flag: {
      level: "emergency",
      title: "Serious bleeding",
      advice:
        "Apply firm, direct pressure with a clean cloth and do not lift it to check. Call 911 for bleeding that soaks through, spurts, or will not stop, or for vomiting or coughing up blood.",
      resources: [US_EMERGENCY],
    },
  },
  {
    pattern:
      /\b((took|swallowed|drank|ate) (too many|a bottle|a whole|all (of )?(my|the)) (pills|tablets|medication)|overdos\w*|poison\w*|swallowed (bleach|cleaner|detergent|antifreeze|battery))\b/i,
    flag: {
      level: "emergency",
      title: "Possible poisoning or overdose",
      advice:
        "Call Poison Control right now at 1-800-222-1222 (free, 24/7) or 911 if the person is drowsy, having trouble breathing, or seizing. Have the container handy if you can.",
      resources: [POISON, US_EMERGENCY],
    },
  },
  {
    pattern:
      /\b(stiff neck (and|with) (fever|headache)|(fever|headache) (and|with) stiff neck|purple (spots|rash) that (don'?t|doesn'?t) fade|rash (that )?(doesn'?t|won'?t) (blanch|fade))\b/i,
    flag: {
      level: "emergency",
      title: "Possible meningitis",
      advice:
        "Fever with a stiff neck, severe headache, confusion, or a rash that does not fade when pressed can be meningitis. This needs emergency evaluation now.",
      resources: [US_EMERGENCY],
    },
  },
  {
    pattern:
      /\b(baby|infant|newborn|\d+[- ]?(week|month)[- ]old).{0,60}\b(fever|temperature|100\.4|38\b)/i,
    flag: {
      level: "urgent",
      title: "Fever in a young infant",
      advice:
        "Any fever (100.4 F / 38 C or higher) in a baby under 3 months needs same-day medical evaluation. Call the pediatrician or go to urgent care / the ER now.",
      resources: [US_EMERGENCY],
    },
  },
  {
    pattern:
      /\b(testic\w* (pain|swelling|twist)|sudden (severe )?(scrotal|testicular) pain)\b/i,
    flag: {
      level: "emergency",
      title: "Sudden testicular pain",
      advice:
        "Sudden severe testicular pain can be torsion, which must be treated within hours to save the testicle. Go to the ER now.",
      resources: [US_EMERGENCY],
    },
  },
  {
    pattern:
      /\b(sudden (vision loss|loss of vision|blind)|curtain (over|across) (my )?(vision|eye)|lost vision in)\b/i,
    flag: {
      level: "emergency",
      title: "Sudden vision loss",
      advice:
        "Sudden loss of vision in one or both eyes is an emergency. Go to the ER or call 911 now.",
      resources: [US_EMERGENCY],
    },
  },
];

export function detectRedFlags(text: string): RedFlag | null {
  const t = text.normalize("NFKC");
  for (const rule of RULES) {
    if (rule.pattern.test(t)) return rule.flag;
  }
  return null;
}

export const CRISIS_RESOURCES = [CRISIS_LINE, CRISIS_TEXT, US_EMERGENCY, POISON];
