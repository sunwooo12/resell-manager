export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, mediaType } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'ANTHROPIC_API_KEY not set', _claudeStatus: 0 });

  const prompt =
    '이 상품 박스/라벨 사진에서 품번(스타일/모델 코드)을 찾아 JSON만 반환:\n' +
    '{"productCode":"","productName":"","candidates":[]}.\n' +
    '품번은 영문+숫자 또는 숫자-하이픈 형태(예: 206750-001, JR4025, DV0833-100).\n' +
    'UPC 바코드 긴 숫자·사이즈표·전화번호·날짜는 품번 아님. 설명 없이 JSON만.';

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
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType || 'image/jpeg',
                  data: image,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
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
    return res.status(200).json({
      error: 'Claude 응답 파싱 오류',
      _claudeStatus: claudeStatus,
      _claudeRaw: rawText.slice(0, 300),
    });
  }

  const text = (claudeData.content && claudeData.content[0] && claudeData.content[0].text) || '';

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return res.status(200).json({
      error: 'JSON 없음 — Claude 원문을 확인하세요',
      _claudeStatus: claudeStatus,
      _claudeRaw: text.slice(0, 400),
    });
  }

  try {
    const result = JSON.parse(match[0]);
    result._claudeStatus = claudeStatus;
    result._claudeRaw = text.slice(0, 400);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({
      error: 'JSON 파싱 오류: ' + e.message,
      _claudeStatus: claudeStatus,
      _claudeRaw: text.slice(0, 400),
    });
  }
}
