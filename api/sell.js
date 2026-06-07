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
    '이 크림(Kream) 판매완료·정산 내역 화면에서 각 판매 건을 추출해 JSON 배열만 반환:\n' +
    '[{"product_code":"","name":"","size":"","sell_price":0,"settlement_amount":0,"sell_date":""}]\n' +
    '\n' +
    '- product_code: 품번/스타일코드 (영문+숫자, 예: DV0833-100, BQ6817-100). 없으면 "".\n' +
    '- name: 상품명. 없으면 "".\n' +
    '- size: 사이즈 (예: 270, US 10, XL). 없으면 "".\n' +
    '- sell_price: 판매가 개당 정수. 없으면 0.\n' +
    '- settlement_amount: 정산금액 개당 정수. 없으면 0.\n' +
    '- sell_date: 판매일 YYYY-MM-DD. 화면에 보이면 그대로, 없으면 "".\n' +
    '⚠️ 추측·임의 입력 금지. 화면에 보이는 값만. 합계·수수료 요약줄 제외.\n' +
    '여러 장이면 모두 합쳐 중복 없이 하나의 배열로.\n' +
    '설명 없이 JSON 배열만.';

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
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
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
  const match = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
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
  const items = raw.filter(it => it && (it.name || it.product_code));
  return res.status(200).json({ items, _claudeStatus: claudeStatus });
}
