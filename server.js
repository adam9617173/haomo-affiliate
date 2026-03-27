const express = require('express');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection - no extra options needed
let pool;
try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });
} catch (err) {
  console.error('Failed to create pool:', err);
}

app.use(express.json());

// Initialize database tables
async function initDB() {
  if (!pool) {
    console.error('Pool not initialized');
    return;
  }
  let client;
  try {
    client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS affiliates (
        id UUID PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(50),
        platform VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        total_earnings DECIMAL(10,2) DEFAULT 0,
        total_paid DECIMAL(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active'
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id UUID PRIMARY KEY,
        affiliate_id UUID REFERENCES affiliates(id),
        code VARCHAR(20) NOT NULL,
        name VARCHAR(255),
        views INTEGER DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS commissions (
        id UUID PRIMARY KEY,
        affiliate_id UUID REFERENCES affiliates(id),
        referral_id UUID REFERENCES referrals(id),
        code VARCHAR(20) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        rate DECIMAL(5,2) NOT NULL,
        product_type VARCHAR(50),
        product_amount DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'pending'
      );
    `);
    console.log('✅ Database tables initialized');
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
  } finally {
    if (client) client.release();
  }
}
// ============ API Routes ============

// Register
app.post('/api/affiliates/register', async (req, res) => {
  if (!pool) return res.status(500).json({ success: false, message: 'Database not connected' });
  const { name, email, phone, platform } = req.body;
  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT * FROM affiliates WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.json({ success: true, affiliate: formatAffiliate(existing.rows[0]) });
    }
    const id = uuidv4();
    const code = 'CBAO' + Math.random().toString(36).substr(2, 6).toUpperCase();
    await client.query(
      `INSERT INTO affiliates (id, code, name, email, phone, platform) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, code, name, email, phone || '', platform || '']
    );
    const result = await client.query('SELECT * FROM affiliates WHERE id = $1', [id]);
    res.json({ success: true, affiliate: formatAffiliate(result.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
});

// Login
app.post('/api/affiliates/login', async (req, res) => {
  if (!pool) return res.status(500).json({ success: false, message: 'Database not connected' });
  const { email } = req.body;
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM affiliates WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.json({ success: false, message: '查無此 Email，請先註冊' });
    }
    res.json({ success: true, affiliate: formatAffiliate(result.rows[0]) });
  } finally {
    client.release();
  }
});

// Get affiliate dashboard
app.get('/api/affiliates/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ success: false, message: 'Database not connected' });
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM affiliates WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.json({ success: false, message: '查無此夥伴' });
    }
    const affiliate = formatAffiliate(result.rows[0]);
    const referralsResult = await client.query('SELECT * FROM referrals WHERE affiliate_id = $1 ORDER BY created_at DESC', [req.params.id]);
    const commissionsResult = await client.query('SELECT * FROM commissions WHERE affiliate_id = $1', [req.params.id]);
    const referrals = referralsResult.rows;
    const stats = {
      totalViews: referrals.reduce((sum, r) => sum + (r.views || 0), 0),
      totalSignups: referrals.filter(r => r.conversions > 0).length,
      totalEarnings: parseFloat(affiliate.totalEarnings || 0),
      pendingEarnings: parseFloat(affiliate.totalEarnings || 0) - parseFloat(affiliate.totalPaid || 0)
    };
    res.json({
      success: true,
      affiliate,
      stats,
      referrals: referrals.map(r => ({
        id: r.id,
        name: r.name,
        code: r.code,
        views: r.views,
        conversions: r.conversions,
        earnings: commissionsResult.rows.filter(c => c.referral_id === r.id).reduce((sum, c) => sum + parseFloat(c.amount), 0),
        createdAt: r.created_at
      }))
    });
  } finally {
    client.release();
  }
});

// Update affiliate
app.put('/api/affiliates/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ success: false, message: 'Database not connected' });
  const client = await pool.connect();
  try {
    const { name, phone, platform } = req.body;
    await client.query('UPDATE affiliates SET name=$1, phone=$2, platform=$3 WHERE id=$4', [name, phone, platform, req.params.id]);
    const result = await client.query('SELECT * FROM affiliates WHERE id=$1', [req.params.id]);
    res.json({ success: true, affiliate: formatAffiliate(result.rows[0]) });
  } finally {
    client.release();
  }
});

// Track click
app.post('/api/track/click', async (req, res) => {
  if (!pool) return res.status(500).json({ success: false, message: 'Database not connected' });
  const { code } = req.body;
  const client = await pool.connect();
  try {
    if ((await client.query('SELECT * FROM referrals WHERE code=$1', [code])).rows.length > 0) {
      await client.query('UPDATE referrals SET views=views+1 WHERE code=$1', [code]);
    }
    res.json({ success: true });
  } finally {
    client.release();
  }
});

// Track conversion
app.post('/api/track/convert', async (req, res) => {
  if (!pool) return res.status(500).json({ success: false, message: 'Database not connected' });
  const { code, amount, type } = req.body;
  const client = await pool.connect();
  try {
    const refResult = await client.query('SELECT * FROM referrals WHERE code=$1', [code]);
    if (refResult.rows.length === 0) {
      return res.json({ success: false, message: '無效的推薦碼' });
    }
    const referral = refResult.rows[0];
    await client.query('UPDATE referrals SET conversions=conversions+1 WHERE id=$1', [referral.id]);
    let commissionRate = 0.20;
    if (type === 'digital') commissionRate = 0.40;
    if (type === 'course') commissionRate = 0.25;
    if (type === 'consult') commissionRate = 0.10;
    const commissionAmount = Math.round(amount * commissionRate * 100) / 100;
    await client.query(
      `INSERT INTO commissions (id, affiliate_id, referral_id, code, amount, rate, product_type, product_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuidv4(), referral.affiliate_id, referral.id, code, commissionAmount, commissionRate, type || 'other', amount]
    );
    await client.query('UPDATE affiliates SET total_earnings=total_earnings+$1 WHERE id=$2', [commissionAmount, referral.affiliate_id]);
    res.json({ success: true, commission: { amount: commissionAmount } });
  } finally {
    client.release();
  }
});

// Create referral link
app.post('/api/affiliates/:id/links', async (req, res) => {
  if (!pool) return res.status(500).json({ success: false, message: 'Database not connected' });
  const { name } = req.body;
  const client = await pool.connect();
  try {
    const affResult = await client.query('SELECT * FROM affiliates WHERE id=$1', [req.params.id]);
    if (affResult.rows.length === 0) {
      return res.json({ success: false, message: '查無此夥伴' });
    }
    const affiliate = affResult.rows[0];
    const id = uuidv4();
    await client.query('INSERT INTO referrals (id, affiliate_id, code, name) VALUES ($1,$2,$3,$4)', [id, req.params.id, affiliate.code, name || '預設連結']);
    const result = await client.query('SELECT * FROM referrals WHERE id=$1', [id]);
    const r = result.rows[0];
    res.json({
      success: true,
      link: { id: r.id, code: r.code, name: r.name, views: r.views, conversions: r.conversions, createdAt: r.created_at }
    });
  } finally {
    client.release();
  }
});

// Landing page
app.get('/r/:code', async (req, res) => {
  if (!pool) return res.status(500).send('Database not connected');
  const { code } = req.params;
  const client = await pool.connect();
  try {
    const affResult = await client.query('SELECT * FROM affiliates WHERE code=$1', [code]);
    if (affResult.rows.length === 0) {
      return res.status(404).send('無效的推薦碼');
    }
    const affiliate = affResult.rows[0];
    const refResult = await client.query('SELECT * FROM referrals WHERE code=$1', [code]);
    if (refResult.rows.length > 0) {
      await client.query('UPDATE referrals SET views=views+1 WHERE code=$1', [code]);
    }
    const landingHtml = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>C寶聯盟 | 浩茂AI</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:linear-gradient(135deg,#1a1a2e,#16213e);min-height:100vh;display:flex;align-items:center;justify-content:center;color:white}.container{text-align:center;padding:40px;max-width:500px}.logo{font-size:64px;margin-bottom:20px}h1{font-size:32px;margin-bottom:15px}h1 span{color:#00D4FF}p{color:#888;font-size:18px;margin-bottom:30px;line-height:1.6}.code-box{background:rgba(255,68,68,0.2);border:2px solid #FF4444;padding:20px 40px;border-radius:15px;display:inline-block}.code-box .label{font-size:14px;color:#888;margin-bottom:5px}.code-box .code{font-size:28px;font-weight:bold;color:#00D4FF;letter-spacing:3px}.cta{margin-top:30px;background:linear-gradient(135deg,#FF4444,#CC0000);color:white;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:18px;font-weight:bold;display:inline-block}.footer{margin-top:40px;color:#666;font-size:14px}</style></head><body><div class="container"><div class="logo">🦞</div><h1><span>C寶</span> 聯盟夥伴推薦</h1><p>你正在訪問 ${affiliate.name} 的推薦連結<br>想訓練龍蝦就找 C寶，就找浩茂AI！</p><div class="code-box"><div class="label">推薦人代碼</div><div class="code">${affiliate.code}</div></div><a href="/" class="cta">加入 C寶聯盟</a><div class="footer">© 2026 浩茂AI | C寶聯盟計畫</div></div></body></html>`;
    res.send(landingHtml);
  } finally {
    client.release();
  }
});

// Withdraw
app.post('/api/affiliates/:id/withdraw', async (req, res) => {
  if (!pool) return res.status(500).json({ success: false, message: 'Database not connected' });
  const { amount } = req.body;
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM affiliates WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.json({ success: false, message: '查無此夥伴' });
    }
    const affiliate = result.rows[0];
    const available = parseFloat(affiliate.total_earnings) - parseFloat(affiliate.total_paid);
    if (amount > available) {
      return res.json({ success: false, message: '提領金額超過可提領額度' });
    }
    await client.query('UPDATE affiliates SET total_paid=total_paid+$1 WHERE id=$2', [amount, req.params.id]);
    const updated = await client.query('SELECT * FROM affiliates WHERE id=$1', [req.params.id]);
    res.json({ success: true, affiliate: formatAffiliate(updated.rows[0]) });
  } finally {
    client.release();
  }
});

// Admin stats
app.get('/api/admin/stats', async (req, res) => {
  if (!pool) return res.status(500).json({ success: false, message: 'Database not connected' });
  const client = await pool.connect();
  try {
    const affResult = await client.query('SELECT * FROM affiliates ORDER BY total_earnings DESC LIMIT 5');
    const totalCommissions = await client.query('SELECT SUM(amount) as total FROM commissions');
    res.json({
      success: true,
      stats: {
        totalAffiliates: (await client.query('SELECT COUNT(*) as count FROM affiliates')).rows[0].count,
        totalCommissions: parseFloat(totalCommissions.rows[0].total || 0),
        topAffiliates: affResult.rows.map(a => ({ name: a.name, code: a.code, earnings: parseFloat(a.total_earnings) }))
      }
    });
  } finally {
    client.release();
  }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Helper
function formatAffiliate(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    email: row.email,
    phone: row.phone,
    platform: row.platform,
    createdAt: row.created_at,
    totalEarnings: row.total_earnings,
    totalPaid: row.total_paid,
    status: row.status
  };
}

// Start server
app.listen(PORT, async () => {
  console.log(`🦞 浩茂AI聯盟網站已啟動：http://localhost:${PORT}`);
  initDB().catch(err => console.error('DB init error:', err));
});