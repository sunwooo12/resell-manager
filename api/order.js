export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, mediaType } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'ANTHROPIC_API_KEY not set', _claudeStatus: 0 });

  const today = new Date().toISOString().split('T')[0];
  const prompt =
    '이 온라인 쇼핑몰 주문내역(SSG/무신사/네이버/나이키공홈/29CM/롯데 등) 캡처에서 ' +
    '개별 상품 라인만 추출해 JSON 배열로만 반환. 각 항목 키:\n' +
    '{"name":"","brand":"","size":"","product_code":"","source":"","buy_price":0,"quantity":1,"buy_date":"","order_url":""}.\n' +
    'buy_price: 개당 가격 정수(콤마·원 제거). 합계만 있으면 수량으로 나눠 개당으로.\n' +
    'buy_date: YYYY-MM-DD. 없으면 ' + today + '.\n' +
    '⚠️ 다음은 항목으로 만들지 말 것: 합계·총금액·총수량·배송비·쿠폰할인·주문번호·요약줄·헤더줄.\n' +
    '상품명(name)이 없거나 실제 상품이 아닌 줄은 반드시 제외.\n' +
    '설명 없이 JSON 배열만.';

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
        max_tokens: 1500,
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

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    return res.status(200).json({
      error: 'JSON 배열 없음 — Claude 원문을 확인하세요',
      _claudeStatus: claudeStatus,
      _claudeRaw: text.slice(0, 500),
    });
  }

  try {
    const items = JSON.parse(match[0]);
    return res.status(200).json({ items, _claudeStatus: claudeStatus });
  } catch (e) {
    return res.status(200).json({
      error: 'JSON 파싱 오류: ' + e.message,
      _claudeStatus: claudeStatus,
      _claudeRaw: text.slice(0, 400),
    });
  }
}
