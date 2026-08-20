export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const imageList = Array.isArray(req.body.images)
    ? req.body.images
    : req.body.image
      ? [{ data: req.body.image, mediaType: req.body.mediaType || 'image/jpeg' }]
      : [];
  if (!imageList.length) return res.status(400).json({ error: 'No images provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'ANTHROPIC_API_KEY not set', _claudeStatus: 0 });

  const prompt =
    '이 크림(Kream) "발송완료 목록" 화면 캡처에서 각 행(각 상품)의 정보를 추출해 JSON만 반환:\n' +
    '{"items":[{"storage_no":"","product_no":"","name":"","size":"","tracking_no":""}]}\n' +
    '\n' +
    '각 필드 규칙:\n' +
    '- storage_no: 보관번호. "I-"로 시작하는 영문+숫자+하이픈 코드 (예: I-SW12518032-1). 화면에 보이는 그대로 정확히. 못 찾으면 "".\n' +
    '- product_no: 품번/스타일코드. 브랜드마다 형식이 다양함 (예: TN243TSWHO01HGR, 6014349-001, IH3990, KE3526). "I-"로 시작하는 보관번호는 품번이 아니므로 절대 product_no에 넣지 말 것. 정확히 읽지 못했으면 추측하지 말고 "".\n' +
    '- name: 상품명. 화면에 보이는 그대로 정확히 복사. 절대 요약·변형·추측 금지.\n' +
    '- size: 사이즈 (예: S, M, L, XL, 270, W270, 260). 못 찾으면 "".\n' +
    '- tracking_no: 송장번호(운송장번호). 숫자로 된 코드. 같은 박스로 묶음발송된 여러 행은 같은 송장번호를 공유할 수 있음 — 각 행에 보이는 그대로 넣을 것. 못 찾으면 "".\n' +
    '\n' +
    '⚠️ 화면에 보이는 모든 행을 빠짐없이 추출할 것. 헤더줄·요약줄·안내문구는 제외. 추측·임의 입력 금지 — 불확실하면 빈 문자열 "".\n' +
    '여러 장이면 모두 합쳐 중복 없이 하나의 목록으로.\n' +
    '설명 없이 JSON만.';

  const content = [
    ...imageList.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data },
    })),
    { type: 'text', text: prompt },
  ];

  let apiRes;
  try {
    apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (e) {
    return res.status(200).json({ error: 'Network error: ' + e.message, _claudeStatus: 0 });
  }

  const claudeStatus = apiRes.status;
  const rawText = await apiRes.text();

  if (!apiRes.ok) {
    return res.status(200).json({
      error: 'Claude API ' + claudeStatus,
      _claudeStatus: claudeStatus,
      _claudeRaw: rawText.slice(0, 600),
    });
  }

  let claudeData;
  try {
    claudeData = JSON.parse(rawText);
  } catch (e) {
    return res.status(200).json({ error: 'Claude 응답 파싱 오류', _claudeStatus: claudeStatus, _claudeRaw: rawText.slice(0, 300) });
  }

  const text = (claudeData.content && claudeData.content[0] && claudeData.content[0].text) || '';
  const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) {
    return res.status(200).json({ error: 'JSON 없음', _claudeStatus: claudeStatus, _claudeRaw: text.slice(0, 500) });
  }

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    return res.status(200).json({ error: 'JSON 파싱 오류: ' + e.message, _claudeStatus: claudeStatus, _claudeRaw: text.slice(0, 400) });
  }

  const raw = Array.isArray(parsed) ? parsed : (parsed.items || []);
  const items = raw.filter(it => it && (it.product_no || it.name));
  return res.status(200).json({ items, _claudeStatus: claudeStatus });
}
