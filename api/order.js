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
    '이 온라인 쇼핑몰 주문내역(SSG/무신사/네이버/나이키공홈/29CM/롯데 등) 캡처에서\n' +
    '아래 형식의 JSON 객체만 반환:\n' +
    '{"total_paid":0,"items":[{"name":"","brand":"","size":"","product_code":"","source":"","list_price":0,"quantity":1,"buy_date":"","order_url":""}]}\n' +
    '\n' +
    '- total_paid: 할인·쿠폰·포인트 적용 후 실제 결제금액(배송비 제외). 확인 불가면 0.\n' +
    '- list_price: 각 상품의 개당 표시 가격(할인·쿠폰 적용 전 개별 정가) 정수.\n' +
    '- buy_date: YYYY-MM-DD. 없으면 ' + today + '.\n' +
    '⚠️ items에 넣지 말 것: 합계·총금액·배송비·쿠폰할인·포인트·주문번호·요약줄·헤더줄.\n' +
    '상품명(name)이 없거나 실제 상품이 아닌 줄은 반드시 제외.\n' +
    '설명 없이 JSON만.';

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

  // Match outermost JSON object or array
  const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) {
    return res.status(200).json({
      error: 'JSON 없음 — Claude 원문을 확인하세요',
      _claudeStatus: claudeStatus,
      _claudeRaw: text.slice(0, 500),
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    return res.status(200).json({
      error: 'JSON 파싱 오류: ' + e.message,
      _claudeStatus: claudeStatus,
      _claudeRaw: text.slice(0, 400),
    });
  }

  // Support both {total_paid, items:[]} and bare array (fallback)
  const rawItems = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
  const totalPaid = (!Array.isArray(parsed) && parsed.total_paid > 0) ? parsed.total_paid : 0;

  // Filter: must have a name
  const items = rawItems.filter(it => it && (it.name || '').trim());

  // Proportional distribution of total_paid into buy_price
  if (totalPaid > 0) {
    const totalListCost = items.reduce((s, it) => {
      const lp = it.list_price || it.buy_price || 0;
      return s + lp * (it.quantity || 1);
    }, 0);

    if (totalListCost > 0 && totalPaid < totalListCost) {
      // Distribute proportionally, then round; fix rounding remainder on largest item
      let distributed = 0;
      let largestIdx = 0;
      let largestCost = 0;
      items.forEach((it, i) => {
        const lp = it.list_price || it.buy_price || 0;
        const cost = lp * (it.quantity || 1);
        const share = Math.round(totalPaid * cost / totalListCost);
        const qty = it.quantity || 1;
        it.buy_price = Math.round(share / qty);
        distributed += share;
        if (cost > largestCost) { largestCost = cost; largestIdx = i; }
      });
      // Absorb rounding difference in the largest item
      const diff = totalPaid - distributed;
      if (diff !== 0) {
        const it = items[largestIdx];
        it.buy_price += Math.round(diff / (it.quantity || 1));
      }
    } else {
      // No discount or total_paid >= list total — use list_price as-is
      items.forEach(it => { it.buy_price = it.list_price || it.buy_price || 0; });
    }
  } else {
    items.forEach(it => { it.buy_price = it.list_price || it.buy_price || 0; });
  }

  return res.status(200).json({ items, _claudeStatus: claudeStatus });
}
