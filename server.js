require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session config
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
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
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Storage (em produção use Redis)
const userSessions = new Map();

// Rotas
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        userSessions.set(req.user.id, {
            discordUser: req.user,
            token: null,
            isAuthenticated: true
        });
        res.redirect('/dashboard');
    }
);

app.get('/dashboard', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect('/');
    }
    
    const userSession = userSessions.get(req.user.id);
    res.render('dashboard', {
        user: req.user,
        token: userSession?.token || null
    });
});

app.post('/save-token', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Não autenticado' });
    }

    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ error: 'Token é obrigatório' });
    }

    const userSession = userSessions.get(req.user.id);
    if (userSession) {
        userSession.token = token;
        userSessions.set(req.user.id, userSession);
    }

    res.json({ success: true, message: 'Token salvo com sucesso' });
});

app.post('/clear-dm', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Não autenticado' });
    }

    const { channelId } = req.body;
    const userSession = userSessions.get(req.user.id);

    if (!userSession || !userSession.token) {
        return res.status(400).json({ error: 'Token não configurado' });
    }

    if (!channelId) {
        return res.status(400).json({ error: 'Channel ID é obrigatório' });
    }

    try {
        const response = await axios.get(`https://discord.com/api/v9/channels/${channelId}/messages`, {
            headers: {
                'Authorization': userSession.token
            }
        });

        const messages = response.data;
        let deletedCount = 0;

        for (const message of messages) {
            if (message.author.id === req.user.id) {
                try {
                    await axios.delete(`https://discord.com/api/v9/channels/${channelId}/messages/${message.id}`, {
                        headers: {
                            'Authorization': userSession.token
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
            error: 'Erro ao limpar DM. Verifique o token e o channel ID.' 
        });
    }
});

app.get('/logout', (req, res) => {
    if (req.user) {
        userSessions.delete(req.user.id);
    }
    req.logout(() => {
        res.redirect('/');
    });
});

// Rota de health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Servidor funcionando' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📧 URL: ${process.env.CALLBACK_URL}`);
});
