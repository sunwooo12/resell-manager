export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, mediaType } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

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
        model: 'claude-haiku-4-5',
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
    return res.status(500).json({ error: 'Network error: ' + e.message });
  }

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    return res.status(500).json({ error: 'AI API error ' + apiRes.status + ': ' + errText });
  }

  const data = await apiRes.json();
  const text = (data.content && data.content[0] && data.content[0].text) || '';

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return res.status(200).json({ error: 'No JSON in AI response', raw: text });

  try {
    const result = JSON.parse(match[0]);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({ error: 'JSON parse error', raw: text });
  }
}
