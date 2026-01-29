const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mariadb = require('mariadb');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// إعدادات
const PORT = 3000;
const UPLOADS_DIR = 'uploads/videos';

// إنشاء المجلدات
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// قاعدة البيانات MariaDB
const pool = mariadb.createPool({
  host: 'localhost',
  user: 'root',
  password: '', // ضع كلمة المرور إذا كانت موجودة
  database: 'video_chat',
  connectionLimit: 5
});

// تكوين رفع الملفات
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));
app.use('/uploads', express.static('uploads'));

// الاتصال بقاعدة البيانات
async function connectDB() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ تم الاتصال بـ MariaDB');
    
    // إنشاء الجداول إذا لم تكن موجودة
    await conn.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await conn.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        uploader VARCHAR(50) NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    conn.release();
    return true;
  } catch (err) {
    console.error('❌ خطأ في MariaDB:', err.message);
    console.log('🔧 تأكد أن MariaDB يعمل: sudo systemctl start mariadb');
    return false;
  }
}

// ========== Routes API ==========

// رفع فيديو
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم رفع ملف' });
    }

    const { username } = req.body;
    const conn = await pool.getConnection();
    
    await conn.query(
      'INSERT INTO videos (filename, original_name, uploader) VALUES (?, ?, ?)',
      [req.file.filename, req.file.originalname, username || 'مجهول']
    );
    
    conn.release();

    const videoData = {
      filename: req.file.filename,
      original_name: req.file.originalname,
      url: `/uploads/videos/${req.file.filename}`,
      uploader: username || 'مجهول'
    };

    // إرسال للجميع عبر Socket.io
    io.emit('video-uploaded', videoData);

    res.json({
      success: true,
      message: 'تم رفع الفيديو بنجاح',
      video: videoData
    });

  } catch (error) {
    console.error('خطأ في الرفع:', error);
    res.status(500).json({ error: 'خطأ في رفع الملف' });
  }
});

// جلب الرسائل
app.get('/api/messages', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const messages = await conn.query(
      'SELECT * FROM messages ORDER BY sent_at DESC LIMIT 100'
    );
    conn.release();
    
    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: 'خطأ في جلب الرسائل' });
  }
});

// إرسال رسالة
app.post('/api/messages', async (req, res) => {
  try {
    const { username, message } = req.body;
    
    const conn = await pool.getConnection();
    const result = await conn.query(
      'INSERT INTO messages (username, message) VALUES (?, ?)',
      [username, message]
    );
    conn.release();

    const newMessage = {
      id: result.insertId,
      username,
      message,
      sent_at: new Date()
    };

    // إرسال للجميع عبر Socket.io
    io.emit('new-message', newMessage);

    res.json({ success: true, message: newMessage });

  } catch (error) {
    res.status(500).json({ error: 'خطأ في حفظ الرسالة' });
  }
});

// جلب الفيديوهات
app.get('/api/videos', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const videos = await conn.query(
      'SELECT * FROM videos ORDER BY uploaded_at DESC'
    );
    conn.release();

    const videosWithUrl = videos.map(video => ({
      ...video,
      url: `/uploads/videos/${video.filename}`
    }));

    res.json(videosWithUrl);
  } catch (error) {
    res.status(500).json({ error: 'خطأ في جلب الفيديوهات' });
  }
});

// ========== Socket.io ==========
io.on('connection', (socket) => {
  console.log('👤 مستخدم جديد متصل:', socket.id);

  // إرسال عدد المستخدمين
  io.emit('users-count', io.engine.clientsCount);

  // استقبال رسالة
  socket.on('send-message', async (data) => {
    try {
      const { username, message } = data;
      
      const conn = await pool.getConnection();
      const result = await conn.query(
        'INSERT INTO messages (username, message) VALUES (?, ?)',
        [username, message]
      );
      conn.release();

      const newMessage = {
        id: result.insertId,
        username,
        message,
        sent_at: new Date()
      };

      io.emit('new-message', newMessage);
    } catch (error) {
      console.error('خطأ في حفظ الرسالة:', error);
    }
  });

  // تحكم بالفيديو
  socket.on('video-control', (data) => {
    socket.broadcast.emit('video-control', data);
  });

  // عند الانفصال
  socket.on('disconnect', () => {
    console.log('❌ مستخدم انقطع:', socket.id);
    io.emit('users-count', io.engine.clientsCount);
  });
});

// تشغيل الخادم
async function startServer() {
  const dbConnected = await connectDB();
  
  if (!dbConnected) {
    console.log('⚠️  قاعدة البيانات غير متصلة، لكن السيرفر يعمل');
  }

  server.listen(PORT, () => {
    console.log(`\n🚀 السيرفر يعمل على: http://localhost:${PORT}`);
    console.log(`📁 ملفات الفيديو: ${UPLOADS_DIR}`);
    console.log(`💾 قاعدة البيانات: MariaDB`);
    console.log(`\n✅ جاهز للاستخدام!`);
  });
}

startServer();
