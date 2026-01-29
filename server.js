const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// إنشاء مجلد للفيديوهات
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// إعداد رفع الملفات
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));
app.use('/uploads', express.static(uploadsDir));

// API Routes
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'لم يتم رفع ملف' });
  }
  
  const videoData = {
    filename: req.file.filename,
    originalname: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    uploader: req.body.username || 'مجهول'
  };
  
  // إرسال للجميع
  io.emit('video-uploaded', videoData);
  
  res.json({
    success: true,
    video: videoData
  });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('👤 مستخدم متصل');
  
  socket.on('send-message', (data) => {
    io.emit('new-message', data);
  });
  
  socket.on('video-control', (data) => {
    socket.broadcast.emit('video-control', data);
  });
  
  socket.on('disconnect', () => {
    console.log('❌ مستخدم انقطع');
  });
});

// تشغيل السيرفر
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 السيرفر يعمل: http://localhost:${PORT}`);
});
