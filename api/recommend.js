const MODELS = ["gemini-2.5-flash-lite", "gemini-2.0-flash"];

const RECOMMEND_SCHEMA = {
  type: "object",
  properties: {
    numbers: {
      type: "array",
      items: { type: "integer" },
      description: "본번호 6개 (1~45, 중복 없음, 오름차순)",
    },
    bonus: {
      type: "integer",
      description: "보너스 번호 (1~45, 본번호에 포함되지 않음)",
    },
    fortune: {
      type: "string",
      description: "생년월일과 오늘 날짜를 반영한 오늘의 운세 요약 (2~4문장, 한국어)",
    },
    explanation: {
      type: "string",
      description: "추천 번호와 보너스를 선택한 이유. 운세·생년월일·오늘 기운과 연결해 한국어로 설명",
    },
  },
  required: ["numbers", "bonus", "fortune", "explanation"],
};

const ZODIAC = ["원숭이", "닭", "개", "돼지", "쥐", "소", "호랑이", "토끼", "용", "뱀", "말", "양"];
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function parseGeminiError(status, data) {
  const message = data?.error?.message || "Gemini API 요청에 실패했습니다.";
  const quotaExceeded = /quota|rate.?limit|429/i.test(message);
  const retryMatch = message.match(/retry in ([\d.]+)s/i);
  const retryAfterSec = retryMatch ? Math.ceil(Number(retryMatch[1])) : null;
  const error = new Error(message);
  error.status = status;
  error.quotaExceeded = quotaExceeded;
  error.retryAfterSec = retryAfterSec;
  return error;
}

function validateLottoResult(data, excluded = []) {
  const numbers = data.numbers;
  const bonus = data.bonus;
  const excludedSet = new Set(excluded);

  if (!Array.isArray(numbers) || numbers.length !== 6) {
    throw new Error("본번호 6개가 올바르지 않습니다.");
  }

  const unique = new Set(numbers);
  if (unique.size !== 6) throw new Error("본번호에 중복이 있습니다.");

  for (const n of numbers) {
    if (!Number.isInteger(n) || n < 1 || n > 45) {
      throw new Error("본번호 범위가 올바르지 않습니다.");
    }
    if (excludedSet.has(n)) throw new Error("제외 번호가 포함되었습니다.");
  }

  if (!Number.isInteger(bonus) || bonus < 1 || bonus > 45) {
    throw new Error("보너스 번호가 올바르지 않습니다.");
  }
  if (numbers.includes(bonus)) throw new Error("보너스가 본번호와 겹칩니다.");
  if (excludedSet.has(bonus)) throw new Error("보너스가 제외 번호입니다.");

  return {
    numbers: [...numbers].sort((a, b) => a - b),
    bonus,
    fortune: String(data.fortune || "").trim(),
    explanation: String(data.explanation || "").trim(),
  };
}

async function callGemini(apiKey, model, payload) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();
  if (!response.ok) throw parseGeminiError(response.status, data);

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 응답이 비어 있습니다.");
  return text;
}

async function callGeminiWithFallback(apiKey, payload) {
  let lastQuotaError = null;

  for (const model of MODELS) {
    try {
      const text = await callGemini(apiKey, model, payload);
      return { text, model };
    } catch (error) {
      if (error.quotaExceeded) {
        lastQuotaError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastQuotaError || new Error("Gemini API를 사용할 수 없습니다.");
}

function getZodiac(year) {
  return ZODIAC[((year - 4) % 12 + 12) % 12];
}

function getStarSign(month, day) {
  const md = month * 100 + day;
  if (md >= 321 && md <= 419) return "양자리";
  if (md <= 520) return "황소자리";
  if (md <= 620) return "쌍둥이자리";
  if (md <= 722) return "게자리";
  if (md <= 822) return "사자자리";
  if (md <= 922) return "처녀자리";
  if (md <= 1022) return "천칭자리";
  if (md <= 1121) return "전갈자리";
  if (md <= 1221) return "사수자리";
  if (md <= 119) return "염소자리";
  if (md <= 218) return "물병자리";
  return "물고기자리";
}

function createSeededRng(birthDate, today, salt = 0) {
  const [y, m, d] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let seed = ((y * 372 + m * 31 + d) ^ (ty * 10000 + tm * 100 + td) ^ salt) >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function drawLocalNumbers(birthDate, today, excluded) {
  const excludedSet = new Set(excluded);
  const pool = [];
  for (let i = 1; i <= 45; i++) {
    if (!excludedSet.has(i)) pool.push(i);
  }
  if (pool.length < 7) throw new Error("제외 번호가 많아 추첨할 수 없습니다.");

  const rand = createSeededRng(birthDate, today, 77);
  const copy = [...pool];
  const picked = [];
  for (let i = 0; i < 6; i++) {
    const idx = Math.floor(rand() * copy.length);
    picked.push(copy[idx]);
    copy.splice(idx, 1);
  }
  const bonus = copy[Math.floor(rand() * copy.length)];

  return {
    numbers: picked.sort((a, b) => a - b),
    bonus,
  };
}

function buildLocalFortune(birthDate, today) {
  const [y, m, d] = birthDate.split("-").map(Number);
  const zodiac = getZodiac(y);
  const sign = getStarSign(m, d);
  const dow = DAY_NAMES[new Date(`${today}T00:00:00`).getDay()];
  const ageEnergy = (y % 9) + 1;

  return [
    `오늘은 ${dow}요일입니다. ${y}년생 ${zodiac}띠, ${sign}의 기운이 ${today}의 흐름과 맞닿아 있습니다.`,
    `생년월일에서 읽히는 에너지 숫자 ${ageEnergy}이(가) 오늘 선택에 긍정적인 영향을 줄 수 있는 날입니다.`,
    "차분하게 번호를 고르면 운의 흐름을 받아들이기 좋은 하루이니, 무리하지 않는 조합을 추천합니다.",
  ].join(" ");
}

function buildLocalExplanation(numbers, bonus, birthDate, today) {
  const [y, m, d] = birthDate.split("-").map(Number);
  const birthNums = [m, d, y % 45 || 45, (m + d) % 45 || 45].filter((n) => n >= 1 && n <= 45);
  const matched = numbers.filter((n) => birthNums.includes(n));

  return [
    `생년월일(${birthDate})과 오늘(${today})을 시드로 번호를 산출했습니다.`,
    matched.length
      ? `본번호 중 ${matched.join(", ")}은(는) 생일 숫자 에너지와 연결된 수입니다.`
      : "본번호는 오늘 날짜 흐름과 생년 에너지를 섞어 균형 있게 배치했습니다.",
    `보너스 ${bonus}번은 본번호와 겹치지 않으면서 보조 행운을 더하는 역할로 선택했습니다.`,
    "참고용 추천이며 당첨을 보장하지 않습니다.",
  ].join(" ");
}

function generateLocalRecommendation(birthDate, today, excluded) {
  const drawn = drawLocalNumbers(birthDate, today, excluded);
  return {
    numbers: drawn.numbers,
    bonus: drawn.bonus,
    fortune: buildLocalFortune(birthDate, today),
    explanation: buildLocalExplanation(drawn.numbers, drawn.bonus, birthDate, today),
  };
}

function buildContext(birthDate, today, excluded) {
  return [
    "당신은 로또 6/45 번호 추천 챗봇입니다.",
    "사용자의 생년월일과 오늘 날짜의 운세(띠, 별자리, 오늘의 기운 등)를 참고해 번호를 추천하고 이유를 설명합니다.",
    "반드시 한국어로 답변하세요.",
    "이 서비스는 참고용이며 당첨을 보장하지 않습니다.",
    "",
    `생년월일: ${birthDate}`,
    `오늘 날짜: ${today}`,
    `제외 번호: ${excluded.length ? excluded.join(", ") : "없음"}`,
    "규칙: 1~45 중 본번호 6개(중복 없음, 오름차순) + 보너스 1개(본번호 제외, 제외 번호에도 포함되면 안 됨)",
  ].join("\n");
}

function quotaUserMessage(retryAfterSec) {
  if (retryAfterSec) {
    return `Gemini 무료 사용 한도에 도달했습니다. 약 ${retryAfterSec}초 후 다시 시도해 주세요.`;
  }
  return "Gemini 무료 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.";
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel 대시보드에서 추가해 주세요.",
    });
  }

  try {
    const { birthDate, excluded = [], messages = [], mode = "recommend" } = req.body || {};

    if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      return res.status(400).json({ error: "올바른 생년월일(YYYY-MM-DD)이 필요합니다." });
    }

    const today = new Date().toISOString().slice(0, 10);
    const excludedNums = excluded
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 45);

    const context = buildContext(birthDate, today, excludedNums);

    if (mode === "recommend") {
      const prompt = [
        context,
        "",
        "오늘의 운세와 생년월일을 종합해 로또 번호를 추천하세요.",
        "운세 요약과 번호별(또는 조합) 추천 이유를 함께 작성하세요.",
      ].join("\n");

      try {
        const { text: raw } = await callGeminiWithFallback(apiKey, {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.9,
            responseMimeType: "application/json",
            responseSchema: RECOMMEND_SCHEMA,
          },
        });

        const parsed = JSON.parse(raw);
        const result = validateLottoResult(parsed, excludedNums);

        return res.status(200).json({
          type: "recommendation",
          source: "gemini",
          ...result,
        });
      } catch (error) {
        if (error.quotaExceeded) {
          const local = generateLocalRecommendation(birthDate, today, excludedNums);
          return res.status(200).json({
            type: "recommendation",
            source: "local",
            fallback: true,
            notice: `${quotaUserMessage(error.retryAfterSec)} 오프라인 운세 엔진으로 번호를 추천했습니다.`,
            ...local,
          });
        }
        throw error;
      }
    }

    const history = Array.isArray(messages) ? messages.slice(-6) : [];
    const geminiContents = [
      { role: "user", parts: [{ text: context }] },
      { role: "model", parts: [{ text: "네, 생년월일과 오늘 운세를 반영해 로또 번호를 추천하고 설명해 드리겠습니다." }] },
    ];

    for (const msg of history) {
      if (!msg?.content) continue;
      const role = msg.role === "assistant" ? "model" : "user";
      geminiContents.push({ role, parts: [{ text: String(msg.content) }] });
    }

    try {
      const { text: reply } = await callGeminiWithFallback(apiKey, {
        contents: geminiContents,
        generationConfig: { temperature: 0.8 },
      });

      return res.status(200).json({
        type: "message",
        source: "gemini",
        reply: reply.trim(),
      });
    } catch (error) {
      if (error.quotaExceeded) {
        const local = generateLocalRecommendation(birthDate, today, excludedNums);
        const reply = [
          quotaUserMessage(error.retryAfterSec),
          "",
          "【오늘의 운세】",
          local.fortune,
          "",
          `【추천 번호】 ${local.numbers.join(", ")} + 보너스 ${local.bonus}`,
          "",
          "【추천 이유】",
          local.explanation,
        ].join("\n");

        return res.status(200).json({
          type: "message",
          source: "local",
          fallback: true,
          reply,
          recommendation: local,
        });
      }
      throw error;
    }
  } catch (error) {
    const status = error.quotaExceeded ? 429 : 500;
    return res.status(status).json({
      error: error.quotaExceeded
        ? quotaUserMessage(error.retryAfterSec)
        : (error.message || "서버 오류가 발생했습니다."),
      retryAfterSec: error.retryAfterSec || null,
    });
  }
}
