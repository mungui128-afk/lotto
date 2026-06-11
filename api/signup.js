export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수를 Vercel에 설정해 주세요.",
    });
  }

  try {
    const { name, phone, email } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "이름을 입력해 주세요." });
    }

    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "전화번호를 입력해 주세요." });
    }

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "올바른 이메일을 입력해 주세요." });
    }

    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
    };

    const response = await fetch(`${supabaseUrl}/rest/v1/lotto_members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      if (data?.code === "23505") {
        return res.status(409).json({ error: "이미 가입된 이메일입니다." });
      }
      const message = data?.message || data?.hint || "Supabase 저장에 실패했습니다.";
      return res.status(response.status).json({ error: message });
    }

    const member = Array.isArray(data) ? data[0] : data;

    return res.status(201).json({
      ok: true,
      member: {
        id: member?.id,
        name: member?.name,
        phone: member?.phone,
        email: member?.email,
        created_at: member?.created_at,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "서버 오류가 발생했습니다.",
    });
  }
}
