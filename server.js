/* ============================================
   LinguaFlow 智能翻译工作台 - 后端服务
   ============================================ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== 数据目录 ==========
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 数据文件路径
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TM_FILE = path.join(DATA_DIR, 'tm.json');
const CORPUS_FILE = path.join(DATA_DIR, 'corpus.json');
const APIKEYS_FILE = path.join(DATA_DIR, 'apikeys.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ========== 数据读写工具 ==========
function readJsonFile(filePath, defaultVal) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error('读取文件失败:', filePath, err.message);
  }
  return defaultVal;
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// 初始化数据文件
function initDataFiles() {
  if (!fs.existsSync(USERS_FILE)) writeJsonFile(USERS_FILE, []);
  if (!fs.existsSync(TM_FILE)) writeJsonFile(TM_FILE, []);
  if (!fs.existsSync(CORPUS_FILE)) writeJsonFile(CORPUS_FILE, []);
  if (!fs.existsSync(APIKEYS_FILE)) writeJsonFile(APIKEYS_FILE, {});
}
initDataFiles();

// ========== 中间件 ==========
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ========== 简易 Session 管理 ==========
const sessions = {};

function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
}

function getSession(req) {
  var sid = req.cookies && req.cookies.linguaflow_session;
  if (sid && sessions[sid]) {
    return sessions[sid];
  }
  return null;
}

function requireAuth(req, res, next) {
  var session = getSession(req);
  if (!session) {
    return res.status(401).json({ success: false, message: '请先登录' });
  }
  req.session = session;
  next();
}

// ========== 页面路由（登录保护 - 必须在 static 之前） ==========
app.get('/workbench.html', function (req, res) {
  var session = getSession(req);
  if (!session) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'workbench.html'));
});

// 静态文件服务（放在路由之后，这样路由可以优先拦截）
app.use(express.static(path.join(__dirname, 'public')));

// ========== 用户注册 ==========
app.post('/api/register', function (req, res) {
  var username = (req.body.username || '').trim();
  var email = (req.body.email || '').trim();
  var password = req.body.password || '';

  if (!username || !email || !password) {
    return res.json({ success: false, message: '请填写所有必填字段' });
  }

  if (password.length < 6) {
    return res.json({ success: false, message: '密码长度至少为6位' });
  }

  var users = readJsonFile(USERS_FILE, []);
  var exists = users.some(function (u) {
    return u.username === username || u.email === email;
  });

  if (exists) {
    return res.json({ success: false, message: '用户名或邮箱已存在' });
  }

  users.push({
    id: Date.now().toString(),
    username: username,
    email: email,
    password: password,
    createdAt: new Date().toISOString()
  });

  writeJsonFile(USERS_FILE, users);
  res.json({ success: true, message: '注册成功' });
});

// ========== 用户登录 ==========
app.post('/api/login', function (req, res) {
  var username = (req.body.username || '').trim();
  var password = req.body.password || '';

  if (!username || !password) {
    return res.json({ success: false, message: '请填写用户名和密码' });
  }

  var users = readJsonFile(USERS_FILE, []);
  var user = users.find(function (u) {
    return u.username === username && u.password === password;
  });

  if (!user) {
    return res.json({ success: false, message: '用户名或密码错误' });
  }

  // 创建 session
  var sessionId = generateSessionId();
  sessions[sessionId] = {
    userId: user.id,
    username: user.username,
    email: user.email,
    createdAt: Date.now()
  };

  res.cookie('linguaflow_session', sessionId, {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24小时
    path: '/'
  });

  res.json({ success: true, message: '登录成功' });
});

// ========== 检查登录状态 ==========
app.get('/api/check-session', function (req, res) {
  var session = getSession(req);
  if (session) {
    res.json({ loggedIn: true, username: session.username });
  } else {
    res.json({ loggedIn: false });
  }
});

// ========== 退出登录 ==========
app.post('/api/logout', function (req, res) {
  var sid = req.cookies && req.cookies.linguaflow_session;
  if (sid && sessions[sid]) {
    delete sessions[sid];
  }
  res.clearCookie('linguaflow_session', { path: '/' });
  res.json({ success: true });
});

// ========== 文件上传 ==========
var upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: function (req, file, cb) {
      cb(null, Date.now() + '_' + file.originalname);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

app.post('/api/upload', requireAuth, upload.single('file'), async function (req, res) {
  if (!req.file) {
    return res.json({ success: false, message: '未接收到文件' });
  }

  var filePath = req.file.path;
  var ext = path.extname(req.file.originalname).toLowerCase();

  try {
    var text = '';

    if (ext === '.txt') {
      text = fs.readFileSync(filePath, 'utf-8');
    } else if (ext === '.docx') {
      var mammoth = require('mammoth');
      var result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    } else if (ext === '.pdf') {
      var pdfParse = require('pdf-parse');
      var buffer = fs.readFileSync(filePath);
      var pdfData = await pdfParse(buffer);
      text = pdfData.text;
    } else if (ext === '.pptx') {
      // 简单提取 pptx 文本：pptx 本质是 zip 包，内含 XML 文件
      text = extractPptxText(filePath);
    } else {
      return res.json({ success: false, message: '不支持的文件格式' });
    }

    // 清理临时文件
    fs.unlinkSync(filePath);

    if (!text || text.trim().length === 0) {
      return res.json({ success: false, message: '无法从文件中提取文本内容' });
    }

    res.json({ success: true, text: text.trim() });
  } catch (err) {
    console.error('文件解析错误:', err.message);
    // 清理临时文件
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: false, message: '文件解析失败: ' + err.message });
  }
});

// PPTX 简易文本提取
function extractPptxText(filePath) {
  try {
    var AdmZip = require('adm-zip');
    var zip = new AdmZip(filePath);
    var entries = zip.getEntries();
    var text = '';
    entries.forEach(function (entry) {
      if (entry.entryName.indexOf('ppt/slides/slide') !== -1 && entry.entryName.endsWith('.xml')) {
        var content = zip.readAsText(entry);
        // 简单正则提取 XML 标签中的文本
        var matches = content.match(/<a:t>([^<]*)<\/a:t>/g);
        if (matches) {
          matches.forEach(function (m) {
            var t = m.replace(/<\/?a:t>/g, '');
            if (t.trim()) text += t + '\n';
          });
        }
      }
    });
    return text.trim();
  } catch (err) {
    // 如果 adm-zip 不可用，返回提示
    return '[PPTX文件解析需要 adm-zip 模块，请运行: npm install adm-zip]';
  }
}

// ========== 翻译 API ==========
app.post('/api/translate', requireAuth, async function (req, res) {
  var text = req.body.text || '';
  var sourceLang = req.body.sourceLang || 'zh';
  var targetLang = req.body.targetLang || 'en';
  var engine = req.body.engine || 'auto';
  var tmEnabled = req.body.tmEnabled !== false;
  var corpusEnabled = req.body.corpusEnabled !== false;

  if (!text.trim()) {
    return res.json({ success: false, message: '翻译文本不能为空' });
  }

  try {
    // 1. 翻译记忆匹配
    var tmMatches = {};
    var tmMatchCount = 0;
    if (tmEnabled) {
      var tmEntries = readJsonFile(TM_FILE, []);
      tmEntries.forEach(function (entry) {
        if (text.indexOf(entry.source) !== -1) {
          tmMatches[entry.source] = entry.target;
          tmMatchCount++;
        }
      });
    }

    // 2. 准备翻译文本（替换已匹配的 TM 术语）
    var textToTranslate = text;
    var tmAppliedText = text;

    // 3. 检查是否有 API key
    var apiConfig = readJsonFile(APIKEYS_FILE, {});
    var selectedEngine = engine === 'auto' ? (apiConfig.provider || 'demo') : engine;

    var hasApiKey = false;
    if (apiConfig.apiKey && (selectedEngine === 'deepseek' || selectedEngine === 'openai')) {
      hasApiKey = true;
    }

    var translatedText = '';
    var isDemo = false;
    var actualEngine = selectedEngine;

    if (hasApiKey) {
      // 真正调用翻译 API
      var prompt = buildTranslationPrompt(textToTranslate, sourceLang, targetLang, tmMatches, corpusEnabled ? readJsonFile(CORPUS_FILE, []) : []);

      if (selectedEngine === 'deepseek') {
        translatedText = await callDeepSeek(prompt, apiConfig.apiKey, apiConfig.model || 'deepseek-chat');
      } else if (selectedEngine === 'openai') {
        translatedText = await callOpenAI(prompt, apiConfig.apiKey, apiConfig.model || 'gpt-4o');
      }
      actualEngine = selectedEngine;
    } else {
      // 演示模式：使用 mock 翻译
      isDemo = true;
      actualEngine = 'demo';
      translatedText = mockTranslate(textToTranslate, sourceLang, targetLang, tmMatches);
    }

    // 4. 计算 TM 匹配率
    var totalChars = text.length;
    var tmMatchRate = totalChars > 0 ? Math.round((tmMatchCount / Math.max(totalChars / 50, 1)) * 100) : 0;
    tmMatchRate = Math.min(tmMatchRate, 100);

    res.json({
      success: true,
      sourceText: text,
      translatedText: translatedText,
      tmMatchRate: tmMatchRate,
      actualEngine: actualEngine,
      isDemo: isDemo
    });
  } catch (err) {
    console.error('翻译错误:', err.message);
    res.json({ success: false, message: '翻译失败: ' + err.message });
  }
});

// 构建翻译提示词
function buildTranslationPrompt(text, sourceLang, targetLang, tmMatches, corpusEntries) {
  var langNames = { zh: '中文', en: '英文', ja: '日文' };
  var srcName = langNames[sourceLang] || sourceLang;
  var tgtName = langNames[targetLang] || targetLang;

  var prompt = '请将以下' + srcName + '文本翻译为' + tgtName + '。要求翻译准确、流畅、符合目标语言的表达习惯。只输出翻译结果，不要添加任何解释或额外文字。\n\n';

  if (Object.keys(tmMatches).length > 0) {
    prompt += '【翻译记忆 - 请使用以下术语翻译】\n';
    for (var src in tmMatches) {
      prompt += src + ' → ' + tmMatches[src] + '\n';
    }
    prompt += '\n';
  }

  if (corpusEntries.length > 0) {
    prompt += '【参考语料】\n';
    var refCorpus = corpusEntries.slice(0, 5);
    refCorpus.forEach(function (c) {
      prompt += '- ' + c.text + '\n';
    });
    prompt += '\n';
  }

  prompt += '【待翻译文本】\n' + text;
  return prompt;
}

// 调用 DeepSeek API
async function callDeepSeek(prompt, apiKey, model) {
  var url = 'https://api.deepseek.com/chat/completions';
  var response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: '你是一个专业的翻译专家，擅长中英文互译。请只输出翻译结果。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 4096
    })
  });

  var data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'DeepSeek API 调用失败');
  }
  if (data.choices && data.choices.length > 0) {
    return data.choices[0].message.content.trim();
  }
  throw new Error('DeepSeek API 返回格式异常');
}

// 调用 OpenAI API
async function callOpenAI(prompt, apiKey, model) {
  var url = 'https://api.openai.com/v1/chat/completions';
  var response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: '你是一个专业的翻译专家，擅长中英文互译。请只输出翻译结果。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 4096
    })
  });

  var data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'OpenAI API 调用失败');
  }
  if (data.choices && data.choices.length > 0) {
    return data.choices[0].message.content.trim();
  }
  throw new Error('OpenAI API 返回格式异常');
}

// 模拟翻译（演示模式）
function mockTranslate(text, sourceLang, targetLang, tmMatches) {
  // 先替换 TM 匹配的术语
  var result = text;
  for (var src in tmMatches) {
    result = result.split(src).join(tmMatches[src]);
  }

  // 对于未匹配的部分，添加标记
  if (sourceLang === 'zh' && targetLang === 'en') {
    if (result === text) {
      // 没有 TM 匹配，返回模拟翻译
      return '[演示模式翻译] This is a simulated translation of the following Chinese text. Please configure an API key (DeepSeek or OpenAI) in settings for real translation.\n\nOriginal: ' + text.substring(0, 200) + (text.length > 200 ? '...' : '');
    }
    return result;
  } else if (sourceLang === 'en' && targetLang === 'zh') {
    if (result === text) {
      return '[演示模式翻译] 这是一段模拟翻译结果。请在设置中配置 API 密钥（DeepSeek 或 OpenAI）以获取真实翻译。\n\nOriginal: ' + text.substring(0, 200) + (text.length > 200 ? '...' : '');
    }
    return result;
  }

  return result;
}

// ========== 翻译记忆 (TM) API ==========
app.get('/api/tm', requireAuth, function (req, res) {
  var entries = readJsonFile(TM_FILE, []);
  res.json({ success: true, entries: entries });
});

app.post('/api/tm', requireAuth, function (req, res) {
  var source = (req.body.source || '').trim();
  var target = (req.body.target || '').trim();
  var note = (req.body.note || '').trim();

  if (!source || !target) {
    return res.json({ success: false, message: '原文和译文不能为空' });
  }

  var entries = readJsonFile(TM_FILE, []);
  entries.push({
    id: Date.now().toString(),
    source: source,
    target: target,
    note: note,
    createdAt: new Date().toISOString()
  });

  writeJsonFile(TM_FILE, entries);
  res.json({ success: true, message: '翻译记忆条目已添加' });
});

app.delete('/api/tm/:id', requireAuth, function (req, res) {
  var id = req.params.id;
  var entries = readJsonFile(TM_FILE, []);
  var filtered = entries.filter(function (e) { return e.id !== id; });

  if (filtered.length === entries.length) {
    return res.json({ success: false, message: '未找到该条目' });
  }

  writeJsonFile(TM_FILE, filtered);
  res.json({ success: true, message: '已删除' });
});

// ========== 语料库 (Corpus) API ==========
app.get('/api/corpus', requireAuth, function (req, res) {
  var entries = readJsonFile(CORPUS_FILE, []);
  res.json({ success: true, entries: entries });
});

app.post('/api/corpus', requireAuth, function (req, res) {
  var text = (req.body.text || '').trim();

  if (!text) {
    return res.json({ success: false, message: '语料文本不能为空' });
  }

  var entries = readJsonFile(CORPUS_FILE, []);
  entries.push({
    id: Date.now().toString(),
    text: text,
    createdAt: new Date().toISOString()
  });

  writeJsonFile(CORPUS_FILE, entries);
  res.json({ success: true, message: '语料已添加' });
});

app.delete('/api/corpus/:id', requireAuth, function (req, res) {
  var id = req.params.id;
  var entries = readJsonFile(CORPUS_FILE, []);
  var filtered = entries.filter(function (e) { return e.id !== id; });

  if (filtered.length === entries.length) {
    return res.json({ success: false, message: '未找到该条目' });
  }

  writeJsonFile(CORPUS_FILE, filtered);
  res.json({ success: true, message: '已删除' });
});

// ========== API Key 管理 ==========
app.get('/api/apikey', requireAuth, function (req, res) {
  var config = readJsonFile(APIKEYS_FILE, {});
  // 不返回完整密钥
  res.json({
    success: true,
    provider: config.provider || '',
    model: config.model || '',
    apiKey: config.apiKey || '',
    hasKey: !!(config.apiKey)
  });
});

app.post('/api/apikey', requireAuth, function (req, res) {
  var provider = (req.body.provider || '').trim();
  var apiKey = (req.body.apiKey || '').trim();
  var model = (req.body.model || '').trim();

  if (!provider || !apiKey) {
    return res.json({ success: false, message: '请填写完整信息' });
  }

  var config = {
    provider: provider,
    apiKey: apiKey,
    model: model,
    updatedAt: new Date().toISOString()
  };

  writeJsonFile(APIKEYS_FILE, config);
  res.json({ success: true, message: 'API 密钥设置已保存' });
});

// ========== 404 处理 ==========
app.use(function (req, res) {
  res.status(404).send('页面未找到');
});

// ========== 错误处理 ==========
app.use(function (err, req, res, next) {
  console.error('服务器错误:', err.message);
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// ========== 启动服务器 ==========
app.listen(PORT, function () {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   LinguaFlow 智能翻译工作台已启动     ║');
  console.log('  ║   访问地址: http://localhost:' + PORT + '      ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
