const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Middleware
app.use(express.json());

// 推廣連結 Landing Page（需在 static 之前）
app.get('/r/:code', (req, res) => {
  const { code } = req.params;
  const data = loadData();

  const affiliate = data.affiliates.find(a => a.code === code);
  if (!affiliate) {
    return res.status(404).send('無效的推薦碼');
  }

  // 記錄點擊
  let referral = data.referrals.find(r => r.code === code);
  if (!referral) {
    referral = {
      id: uuidv4(),
      affiliateId: affiliate.id,
      code,
      name: 'Landing Page',
      views: 1,
      conversions: 0,
      createdAt: new Date().toISOString()
    };
    data.referrals.push(referral);
  } else {
    referral.views++;
  }
  saveData(data);

  // 讀取並返回 landing page HTML
  const landingHtml = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>C寶聯盟 | 浩茂AI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }
    .container {
      text-align: center;
      padding: 40px;
      max-width: 500px;
    }
    .logo { font-size: 64px; margin-bottom: 20px; }
    h1 { font-size: 32px; margin-bottom: 15px; }
    h1 span { color: #00D4FF; }
    p { color: #888; font-size: 18px; margin-bottom: 30px; line-height: 1.6; }
    .code-box {
      background: rgba(255,68,68,0.2);
      border: 2px solid #FF4444;
      padding: 20px 40px;
      border-radius: 15px;
      display: inline-block;
    }
    .code-box .label { font-size: 14px; color: #888; margin-bottom: 5px; }
    .code-box .code { font-size: 28px; font-weight: bold; color: #00D4FF; letter-spacing: 3px; }
    .cta {
      margin-top: 30px;
      background: linear-gradient(135deg, #FF4444, #CC0000);
      color: white;
      padding: 16px 40px;
      border-radius: 10px;
      text-decoration: none;
      font-size: 18px;
      font-weight: bold;
      display: inline-block;
    }
    .footer { margin-top: 40px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🦞</div>
    <h1><span>C寶</span> 聯盟夥伴推薦</h1>
    <p>你正在訪問 ${affiliate.name} 的推薦連結<br>想訓練龍蝦就找 C寶，就找浩茂AI！</p>
    <div class="code-box">
      <div class="label">推薦人代碼</div>
      <div class="code">${affiliate.code}</div>
    </div>
    <a href="/" class="cta">加入 C寶聯盟</a>
    <div class="footer">© 2026 浩茂AI | C寶聯盟計畫</div>
  </div>
</body>
</html>
  `;
  res.send(landingHtml);
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// 載入或初始化資料
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { affiliates: [], referrals: [], commissions: [] };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ============ API Routes ============

// 聯盟夥伴註冊
app.post('/api/affiliates/register', (req, res) => {
  const { name, email, phone, platform } = req.body;
  const data = loadData();

  // 檢查是否已註冊
  const existing = data.affiliates.find(a => a.email === email);
  if (existing) {
    return res.json({ success: false, message: '此 Email 已經註冊過了', affiliate: existing });
  }

  const affiliate = {
    id: uuidv4(),
    code: 'CBAO' + Math.random().toString(36).substr(2, 6).toUpperCase(),
    name,
    email,
    phone: phone || '',
    platform: platform || '',
    createdAt: new Date().toISOString(),
    totalEarnings: 0,
    totalPaid: 0,
    status: 'active'
  };

  data.affiliates.push(affiliate);
  saveData(data);

  res.json({ success: true, affiliate });
});

// 聯盟夥伴登入
app.post('/api/affiliates/login', (req, res) => {
  const { email } = req.body;
  const data = loadData();

  const affiliate = data.affiliates.find(a => a.email === email);
  if (!affiliate) {
    return res.json({ success: false, message: '查無此 Email，請先註冊' });
  }

  res.json({ success: true, affiliate });
});

// 獲取夥伴資料
app.get('/api/affiliates/:id', (req, res) => {
  const data = loadData();
  const affiliate = data.affiliates.find(a => a.id === req.params.id);
  if (!affiliate) {
    return res.json({ success: false, message: '查無此夥伴' });
  }

  // 計算推薦成績
  const referrals = data.referrals.filter(r => r.affiliateId === affiliate.id);
  const commissions = data.commissions.filter(c => c.affiliateId === affiliate.id);

  res.json({
    success: true,
    affiliate,
    stats: {
      totalViews: referrals.reduce((sum, r) => sum + r.views, 0),
      totalSignups: referrals.filter(r => r.converted).length,
      totalEarnings: commissions.reduce((sum, c) => sum + c.amount, 0),
      pendingEarnings: affiliate.totalEarnings - affiliate.totalPaid
    },
    referrals: referrals.map(r => ({
      id: r.id,
      code: r.code,
      views: r.views,
      signups: r.conversions || 0,
      conversions: r.conversions || 0,
      earnings: commissions.filter(c => c.referralId === r.id).reduce((sum, c) => sum + c.amount, 0),
      createdAt: r.createdAt
    }))
  });
});

// 更新夥伴資料
app.put('/api/affiliates/:id', (req, res) => {
  const data = loadData();
  const idx = data.affiliates.findIndex(a => a.id === req.params.id);
  if (idx === -1) {
    return res.json({ success: false, message: '查無此夥伴' });
  }

  data.affiliates[idx] = { ...data.affiliates[idx], ...req.body };
  saveData(data);

  res.json({ success: true, affiliate: data.affiliates[idx] });
});

// 記錄點擊（透過推廣連結訪問）
app.post('/api/track/click', (req, res) => {
  const { code } = req.body;
  const data = loadData();

  let referral = data.referrals.find(r => r.code === code);
  if (!referral) {
    return res.json({ success: false });
  }

  referral.views = (referral.views || 0) + 1;
  saveData(data);

  res.json({ success: true });
});

// 記錄轉化（報名/購買）
app.post('/api/track/convert', (req, res) => {
  const { code, amount, type } = req.body;
  const data = loadData();

  let referral = data.referrals.find(r => r.code === code);
  if (!referral) {
    return res.json({ success: false, message: '無效的推薦碼' });
  }

  // 更新 referral
  referral.conversions = (referral.conversions || 0) + 1;
  referral.converted = true;

  // 計算佣金額度（根據商品類型）
  let commissionRate = 0.20; // 預設20%
  if (type === 'digital') commissionRate = 0.40;
  if (type === 'course') commissionRate = 0.25;
  if (type === 'consult') commissionRate = 0.10;

  const commission = {
    id: uuidv4(),
    affiliateId: referral.affiliateId,
    referralId: referral.id,
    code,
    amount: Math.round(amount * commissionRate * 100) / 100,
    rate: commissionRate,
    productType: type,
    productAmount: amount,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };

  data.commissions.push(commission);

  // 更新夥伴總佣金額
  const affiliate = data.affiliates.find(a => a.id === referral.affiliateId);
  if (affiliate) {
    affiliate.totalEarnings += commission.amount;
  }

  saveData(data);

  res.json({ success: true, commission });
});

// 產生新的推廣連結
app.post('/api/affiliates/:id/links', (req, res) => {
  const { name } = req.body;
  const data = loadData();

  const affiliate = data.affiliates.find(a => a.id === req.params.id);
  if (!affiliate) {
    return res.json({ success: false, message: '查無此夥伴' });
  }

  const link = {
    id: uuidv4(),
    affiliateId: affiliate.id,
    code: affiliate.code,
    name: name || '預設連結',
    views: 0,
    conversions: 0,
    createdAt: new Date().toISOString()
  };

  data.referrals.push(link);
  saveData(data);

  res.json({ success: true, link });
});

// 獲取推廣連結（公眾訪問，透過code）
app.get('/api/r/:code', (req, res) => {
  const { code } = req.params;
  const data = loadData();

  const affiliate = data.affiliates.find(a => a.code === code);
  if (!affiliate) {
    return res.json({ success: false, message: '無效的推薦碼' });
  }

  // 記錄點擊
  let referral = data.referrals.find(r => r.code === code);
  if (!referral) {
    referral = {
      id: uuidv4(),
      affiliateId: affiliate.id,
      code,
      name: ' Landing Page',
      views: 1,
      conversions: 0,
      createdAt: new Date().toISOString()
    };
    data.referrals.push(referral);
  } else {
    referral.views++;
  }
  saveData(data);

  res.json({
    success: true,
    affiliate: {
      name: affiliate.name,
      code: affiliate.code
    }
  });
});

// 提領佣金
app.post('/api/affiliates/:id/withdraw', (req, res) => {
  const { amount } = req.body;
  const data = loadData();

  const affiliate = data.affiliates.find(a => a.id === req.params.id);
  if (!affiliate) {
    return res.json({ success: false, message: '查無此夥伴' });
  }

  const available = affiliate.totalEarnings - affiliate.totalPaid;
  if (amount > available) {
    return res.json({ success: false, message: '提領金額超過可提領額度' });
  }

  affiliate.totalPaid += amount;
  saveData(data);

  res.json({ success: true, affiliate });
});

// 推廣成效總覽（所有夥伴）
app.get('/api/admin/stats', (req, res) => {
  const data = loadData();

  const stats = {
    totalAffiliates: data.affiliates.length,
    totalReferrals: data.referrals.length,
    totalCommissions: data.commissions.reduce((sum, c) => sum + c.amount, 0),
    totalPaid: data.affiliates.reduce((sum, a) => sum + a.totalPaid, 0),
    pendingPayout: data.affiliates.reduce((sum, a) => sum + (a.totalEarnings - a.totalPaid), 0),
    topAffiliates: data.affiliates
      .sort((a, b) => b.totalEarnings - a.totalEarnings)
      .slice(0, 5)
      .map(a => ({ name: a.name, code: a.code, earnings: a.totalEarnings }))
  };

  res.json({ success: true, stats });
});

app.listen(PORT, () => {
  console.log(`🦞 浩茂AI聯盟網站已啟動：http://localhost:${PORT}`);
});
