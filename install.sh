#!/bin/bash

echo "╔══════════════════════════════════════╗"
echo "║   تثبيت تطبيق السينما على Ubuntu    ║"
echo "╚══════════════════════════════════════╝"
echo ""

# التحقق من صلاحيات root
if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  يرجى تشغيل السكربت كـ root:"
    echo "   sudo ./install.sh"
    exit 1
fi

echo "🔍 جاري التحقق من المتطلبات..."

# 1. تثبيت Node.js إذا لم يكن مثبتاً
if ! command -v node &> /dev/null; then
    echo "📦 تثبيت Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    apt-get install -y nodejs
    echo "✅ Node.js مثبت"
else
    echo "✅ Node.js مثبت مسبقاً"
fi

# 2. تثبيت MariaDB إذا لم يكن مثبتاً
if ! command -v mariadb &> /dev/null; then
    echo "🗄️  تثبيت MariaDB..."
    apt-get update
    apt-get install -y mariadb-server
    
    # تشغيل MariaDB
    systemctl start mariadb
    systemctl enable mariadb
    
    echo "✅ MariaDB مثبت ومشغل"
else
    echo "✅ MariaDB مثبت مسبقاً"
fi

# 3. تثبيت npm إذا لم يكن مثبتاً
if ! command -v npm &> /dev/null; then
    echo "📦 تثبيت npm..."
    apt-get install -y npm
    echo "✅ npm مثبت"
else
    echo "✅ npm مثبت مسبقاً"
fi

# 4. إنشاء قاعدة البيانات
echo "💾 إنشاء قاعدة البيانات..."
mysql -u root -e "CREATE DATABASE IF NOT EXISTS video_chat;" 2>/dev/null || echo "⚠️  يمكن إنشاء قاعدة البيانات يدوياً لاحقاً"

# 5. إنشاء مجلد التطبيق إذا لم يكن موجوداً
if [ ! -d "/opt/video-chat" ]; then
    echo "📁 إنشاء مجلد التطبيق..."
    mkdir -p /opt/video-chat
fi

# 6. نسخ الملفات
echo "📄 نسخ ملفات التطبيق..."
cp server.js index.html package.json /opt/video-chat/

# 7. إنشاء مجلد uploads
echo "📁 إنشاء مجلد الفيديوهات..."
mkdir -p /opt/video-chat/uploads/videos
chmod 777 /opt/video-chat/uploads

# 8. تثبيت مكتبات Node.js
echo "📦 تثبيت مكتبات Node.js..."
cd /opt/video-chat
npm install

# 9. إنشاء service لتشغيل التطبيق تلقائياً
echo "🔄 إنشاء خدمة systemd..."
cat > /etc/systemd/system/video-chat.service << EOF
[Unit]
Description=Video Chat Application
After=network.target mariadb.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/video-chat
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 10. تشغيل الخدمة
systemctl daemon-reload
systemctl enable video-chat.service
systemctl start video-chat.service

# 11. فتح المنفذ في الجدار الناري
echo "🔥 فتح المنفذ 3000 في الجدار الناري..."
ufw allow 3000/tcp 2>/dev/null || iptables -I INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null || echo "⚠️  يمكن فتح المنفذ يدوياً"

echo ""
echo "════════════════════════════════════════"
echo "🎉 تم التثبيت بنجاح!"
echo ""
echo "📋 معلومات التطبيق:"
echo "   📍 المجلد: /opt/video-chat"
echo "   🌐 الرابط: http://$(hostname -I | awk '{print $1}'):3000"
echo "   🔗 أو: http://localhost:3000"
echo ""
echo "⚙️  أوامر التحكم:"
echo "   تشغيل: sudo systemctl start video-chat"
echo "   إيقاف: sudo systemctl stop video-chat"
echo "   حالة: sudo systemctl status video-chat"
echo "   السجلات: sudo journalctl -u video-chat -f"
echo ""
echo "🎬 افتح المتصفح وابدأ المشاهدة!"
echo "════════════════════════════════════════"
