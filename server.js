require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Banco de Dados
const db = new sqlite3.Database(':memory:'); // Em produção, use: './database.db'

// Criar tabelas
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        discord_id TEXT UNIQUE,
        username TEXT,
        discriminator TEXT,
        avatar TEXT,
        token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session config - AGORA SALVA POR 30 DIAS
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-very-long-key-here',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 dias
    }
}));

// Passport config
app.use(passport.initialize());
app.use(passport.session());

// Configure Passport
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // Salvar/Atualizar usuário no banco
        db.run(`
            INSERT OR REPLACE INTO users (id, discord_id, username, discriminator, avatar) 
            VALUES (?, ?, ?, ?, ?)
        `, [profile.id, profile.id, profile.username, profile.discriminator, profile.avatar]);
        
        return done(null, profile);
    } catch (error) {
        return done(error, null);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        db.get("SELECT * FROM users WHERE discord_id = ?", [id], (err, row) => {
            if (err) return done(err);
            if (!row) return done(null, false);
            
            const user = {
                id: row.discord_id,
                username: row.username,
                discriminator: row.discriminator,
                avatar: row.avatar
            };
            done(null, user);
        });
    } catch (error) {
        done(error, null);
    }
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ========== ROTAS ========== //

// Rota principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login Discord
app.get('/auth/discord', passport.authenticate('discord'));

// Callback Discord
app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/dashboard');
    }
);

// Dashboard
app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/');
    }
    
    try {
        // Buscar token salvo do usuário
        db.get("SELECT token FROM users WHERE discord_id = ?", [req.user.id], (err, row) => {
            if (err) {
                console.error('Erro ao buscar token:', err);
                return res.render('dashboard', {
                    user: req.user,
                    token: null
                });
            }
            
            res.render('dashboard', {
                user: req.user,
                token: row?.token || null
            });
        });
    } catch (error) {
        console.error('Erro no dashboard:', error);
        res.render('dashboard', {
            user: req.user,
            token: null
        });
    }
});

// Salvar Token
app.post('/save-token', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Não autenticado' });
    }

    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ error: 'Token é obrigatório' });
    }

    try {
        db.run("UPDATE users SET token = ? WHERE discord_id = ?", [token, req.user.id], function(err) {
            if (err) {
                console.error('Erro ao salvar token:', err);
                return res.status(500).json({ error: 'Erro ao salvar token' });
            }
            
            res.json({ 
                success: true, 
                message: 'Token salvo com sucesso! Você não precisará digitar novamente.' 
            });
        });
    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Limpar DM
app.post('/clear-dm', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Não autenticado' });
    }

    const { channelId } = req.body;

    if (!channelId) {
        return res.status(400).json({ error: 'Channel ID é obrigatório' });
    }

    try {
        // Buscar token do banco
        db.get("SELECT token FROM users WHERE discord_id = ?", [req.user.id], async (err, row) => {
            if (err || !row || !row.token) {
                return res.status(400).json({ error: 'Token não encontrado. Configure primeiro na aba de token.' });
            }

            const userToken = row.token;

            try {
                const response = await axios.get(`https://discord.com/api/v9/channels/${channelId}/messages`, {
                    headers: {
                        'Authorization': userToken
                    }
                });

                const messages = response.data;
                let deletedCount = 0;

                for (const message of messages) {
                    if (message.author.id === req.user.id) {
                        try {
                            await axios.delete(`https://discord.com/api/v9/channels/${channelId}/messages/${message.id}`, {
                                headers: {
                                    'Authorization': userToken
                                }
                            });
                            deletedCount++;
                            
                            await new Promise(resolve => 
                                setTimeout(resolve, Math.random() * 1600 + 400)
                            );
                        } catch (error) {
                            console.error('Erro ao deletar mensagem:', error.message);
                        }
                    }
                }
                
                res.json({ 
                    success: true, 
                    message: `Limpeza concluída! ${deletedCount} mensagens deletadas.` 
                });

            } catch (error) {
                console.error('Erro ao limpar DM:', error.message);
                res.status(500).json({ 
                    error: 'Erro ao limpar DM. Token pode estar inválido.' 
                });
            }
        });
    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Servidor funcionando' });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
