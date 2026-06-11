const MODEL = "gemini-2.5-flash-lite";

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

async function callGemini(apiKey, payload) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
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
  if (!response.ok) {
    const message = data?.error?.message || "Gemini API 요청에 실패했습니다.";
    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 응답이 비어 있습니다.");
  return text;
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

      const raw = await callGemini(apiKey, {
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
        ...result,
      });
    }

    const history = Array.isArray(messages) ? messages.slice(-10) : [];
    const geminiContents = [
      { role: "user", parts: [{ text: context }] },
      { role: "model", parts: [{ text: "네, 생년월일과 오늘 운세를 반영해 로또 번호를 추천하고 설명해 드리겠습니다." }] },
    ];

    for (const msg of history) {
      if (!msg?.content) continue;
      const role = msg.role === "assistant" ? "model" : "user";
      geminiContents.push({ role, parts: [{ text: String(msg.content) }] });
    }

    const reply = await callGemini(apiKey, {
      contents: geminiContents,
      generationConfig: { temperature: 0.8 },
    });

    return res.status(200).json({
      type: "message",
      reply: reply.trim(),
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "서버 오류가 발생했습니다.",
    });
  }
}
