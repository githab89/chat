const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const app = express();
// ДОБАВЬТЕ ЭТИ СТРОЧКИ В НАЧАЛО ФАЙЛА (после создания переменной app)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 4000;
const db = new Database('database.sqlite');

// Тщательно проверяем, чтобы в таблице users ОДОБРИЛИСЬ ВСЕ 6 КОЛОНОК!
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY, 
        password TEXT NOT NULL, 
        email TEXT UNIQUE, 
        role TEXT DEFAULT 'user', 
        theme TEXT DEFAULT 'light', 
        passcode TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, ip TEXT, time TEXT);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, receiver_email TEXT, message TEXT, time TEXT);
`);

// Создаем админа — передаем ровно 6 значений под 6 колонок
if (!db.prepare('SELECT * FROM users WHERE username = ?').get('admin')) {
    db.prepare('INSERT INTO users (username, password, email, role, theme, passcode) VALUES (?, ?, ?, ?, ?, ?)')
      .run('admin', 'admin', 'admin@site.com', 'admin', 'light', '');
}

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.get('/style.css', (req, res) => { res.sendFile(path.join(__dirname, 'style.css')); });

let currentCaptcha = { q: "2 + 2", a: 4 };
function generateCaptcha() {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    currentCaptcha = { q: `${num1} + ${num2}`, a: num1 + num2 };
    return currentCaptcha.q;
}

app.get('/', (req, res) => {
    const username = req.cookies.username;
    const error = req.query.error || '';
    const activeEmail = req.query.chat || '';
    
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    if (!username) {
        const captchaQuestion = generateCaptcha();
        html = html.replace('<% ifNotAuth %>', '').replace('<% /ifNotAuth %>', '').replace(/<% ifAuth %>[\s\S]*<% \/ifAuth %>/, '');
        html = html.replace('<% ifPasscode %>', '').replace('<% /ifPasscode %>', '').replace(/<div class="passcode-screen"[\s\S]*?<\/div>/, '');
        html = html.replace('<% captcha %>', captchaQuestion).replace('<% theme %>', 'light');
        html = error ? html.replace('<% ifError %>', '').replace('<% /ifError %>', '').replace('<% error %>', error) : html.replace(/<% ifError %>[\s\S]*<% \/ifError %>/, '');
        return res.send(html);
    }

// 1. Ищем пользователя в базе
const user = db.prepare('SELECT email, theme, passcode FROM users WHERE username = ?').get(username);

// 2. ДОБАВЛЯЕМ ПРОВЕРКУ (Защита от падения сервера):
if (!user) {
    // Если пользователя нет в базе, отправляем ошибку на сайт, чтобы сервер НЕ падал
    return res.status(404).json({ error: "Пользователь с таким никнеймом не найден!" });
}

// 3. Если пользователь найден, то этот код сработает без ошибок:
if (user.passcode === inputPasscode) {
    // логика успешного входа...
}

    html = html.replace(/<% ifNotAuth %>[\s\S]*<% \/ifNotAuth %>/, '').replace('<% ifAuth %>', '').replace('<% /ifAuth %>', '');
    
    html = user.passcode ? html.replace('<% ifPasscode %>', '').replace('<% /ifPasscode %>', '') : html.replace(/<% ifPasscode %>[\s\S]*<% \/ifPasscode %>/, '');

    const chatPartners = db.prepare(`SELECT DISTINCT chat_user FROM (SELECT receiver_email AS chat_user FROM messages WHERE sender = ? UNION SELECT sender AS chat_user FROM messages WHERE receiver_email = ?) WHERE chat_user != ? AND chat_user != ''`).all(username, user.email, user.email);
    let channelsHtml = chatPartners.map(p => `<a href="/?chat=${encodeURIComponent(p.chat_user)}" class="channel-item ${p.chat_user === activeEmail ? 'active-chan' : ''}">💬 ${p.chat_user}</a>`).join('');

    let chatMessagesHtml = '<div class="no-chat">Выберите чат слева или введите Email</div>';
    if (activeEmail) {
        const messages = db.prepare(`SELECT * FROM messages WHERE (sender = ? AND receiver_email = ?) OR (sender = (SELECT username FROM users WHERE email = ?) AND receiver_email = ?) ORDER BY id ASC`).all(username, activeEmail, activeEmail, user.email);
        chatMessagesHtml = messages.map(m => `<div class="msg-bubble ${m.sender === username ? 'me' : 'them'}"><div class="msg-author">${m.sender}</div><div>${m.message}</div><div class="msg-time">${m.time}</div></div>`).join('');
        html = html.replace('<% ifActiveChat %>', '').replace('<% /ifActiveChat %>', '');
    } else {
        html = html.replace(/<% ifActiveChat %>[\s\S]*<% \/ifActiveChat %>/, '');
    }

    html = html.replace('<% username %>', username)
               .replace('<% channels %>', channelsHtml || '<p style="text-align:center;color:#999;font-size:13px;margin-top:20px;">Чатов нет</p>')
               .replace('<% chatHeader %>', activeEmail ? `💬 Диалог: ${activeEmail}` : 'Начните общение')
               .replace('<% messages %>', chatMessagesHtml)
               .replace('<% activeEmail %>', activeEmail)
               .replace('<% theme %>', user.theme || 'light')
               .replace('<% passcodeValue %>', user.passcode || '')
               .replace('<% selLight %>', user.theme === 'light' ? 'selected' : '')
               .replace('<% selDark %>', user.theme === 'dark' ? 'selected' : '')
               .replace('<% selBlue %>', user.theme === 'blue' ? 'selected' : '');

    res.send(html);
});

app.post('/save-settings', (req, res) => {
    const username = req.cookies.username;
    if (username) db.prepare('UPDATE users SET theme = ?, passcode = ? WHERE username = ?').run(req.body.theme, req.body.passcode, username);
    res.redirect('/');
});

app.post('/new-chat', (req, res) => { res.redirect('/?chat=' + encodeURIComponent(req.body.email)); });

app.post('/login', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(req.body.username, req.body.password);
    if (!user) return res.redirect('/?error=' + encodeURIComponent('Неверный логин или пароль!'));
    res.cookie('username', req.body.username, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
    db.prepare('INSERT INTO visits (username, ip, time) VALUES (?, ?, ?)').run(req.body.username, req.headers['x-forwarded-for'] || req.socket.remoteAddress, new Date().toLocaleTimeString('ru-RU'));
    res.redirect('/');
});

app.post('/register', (req, res) => {
    if (parseInt(req.body.captcha) !== currentCaptcha.a) return res.redirect('/?error=' + encodeURIComponent('Капча введена неверно!'));
    try {
        db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(req.body.username, req.body.email, req.body.password);
        res.cookie('username', req.body.username, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
        res.redirect('/');
    } catch (err) { res.redirect('/?error=' + encodeURIComponent('Логин или E-mail заняты!')); }
});

app.post('/send-message', (req, res) => {
    const sender = req.cookies.username;
    if (sender) db.prepare('INSERT INTO messages (sender, receiver_email, message, time) VALUES (?, ?, ?, ?)').run(sender, req.body.receiver_email, req.body.message, new Date().toLocaleTimeString('ru-RU'));
    res.redirect('/?chat=' + encodeURIComponent(req.body.receiver_email));
});

app.get('/logout', (req, res) => { res.clearCookie('username'); res.redirect('/'); });

app.listen(PORT, () => { console.log(`Сервер запущен на http://localhost:${PORT}`); });
