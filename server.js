require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração simples em memória (substitui SQLite por enquanto)
const userStorage = new Map();
const tokenStorage = new Map();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session config - 30 DIAS
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-very-long-key-here-12345',
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
}, (accessToken, refreshToken, profile, done) => {
    console.log('🔐 Login Discord:', profile.username);
    return done(null, profile);
}));

// Serialização SIMPLIFICADA
passport.serializeUser((user, done) => {
    console.log('💾 Serializando usuário:', user.id);
    done(null, user);
});

passport.deserializeUser((user, done) => {
    console.log('🔍 Desserializando usuário:', user?.id);
    done(null, user);
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ========== MIDDLEWARE DE LOG ========== //
app.use((req, res, next) => {
    console.log('📨 Rota:', req.path, '| Usuário:', req.user?.username || 'Não logado');
    next();
});

// ========== ROTAS ========== //

// Rota principal
app.get('/', (req, res) => {
    console.log('🏠 Página principal - Usuário:', req.user?.username || 'Não logado');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login Discord
app.get('/auth/discord', passport.authenticate('discord'));

// Callback Discord
app.get('/auth/discord/callback',
    passport.authenticate('discord', { 
        failureRedirect: '/',
        failureMessage: true 
    }),
    (req, res) => {
        console.log('✅ Login bem-sucedido:', req.user.username);
        
        // Salvar usuário no storage
        userStorage.set(req.user.id, {
            ...req.user,
            isAuthenticated: true
        });
        
        res.redirect('/dashboard');
    }
);

// Middleware para verificar autenticação
const requireAuth = (req, res, next) => {
    if (req.isAuthenticated()) {
        console.log('✅ Usuário autenticado:', req.user.username);
        return next();
    }
    console.log('❌ Usuário não autenticado - Redirecionando para /');
    res.redirect('/');
};

// Dashboard
app.get('/dashboard', requireAuth, (req, res) => {
    const userToken = tokenStorage.get(req.user.id);
    
    console.log('📊 Dashboard carregado para:', req.user.username, '| Token:', !!userToken);
    
    res.render('dashboard', {
        user: req.user,
        token: userToken || null
    });
});

// Salvar Token
app.post('/save-token', requireAuth, (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({ error: 'Token é obrigatório' });
    }

    console.log('💾 Salvando token para:', req.user.username);
    
    // Salvar token no storage
    tokenStorage.set(req.user.id, token);
    
    res.json({ 
        success: true, 
        message: 'Token salvo com sucesso! Você não precisará digitar novamente.' 
    });
});

// Limpar DM
app.post('/clear-dm', requireAuth, async (req, res) => {
    const { channelId } = req.body;

    if (!channelId) {
        return res.status(400).json({ error: 'Channel ID é obrigatório' });
    }

    const userToken = tokenStorage.get(req.user.id);

    if (!userToken) {
        return res.status(400).json({ error: 'Token não encontrado. Configure primeiro na aba de token.' });
    }

    console.log('🧹 Iniciando limpeza para:', req.user.username, '| Canal:', channelId);

    try {
        // Buscar mensagens
        const response = await axios.get(`https://discord.com/api/v9/channels/${channelId}/messages`, {
            headers: {
                'Authorization': userToken
            }
        });

        const messages = response.data;
        let deletedCount = 0;

        // Deletar mensagens do usuário
        for (const message of messages) {
            if (message.author.id === req.user.id) {
                try {
                    await axios.delete(`https://discord.com/api/v9/channels/${channelId}/messages/${message.id}`, {
                        headers: {
                            'Authorization': userToken
                        }
                    });
                    deletedCount++;
                    
                    // Rate limit
                    await new Promise(resolve => 
                        setTimeout(resolve, Math.random() * 1600 + 400)
                    );
                } catch (error) {
                    console.error('❌ Erro ao deletar mensagem:', error.message);
                }
            }
        }
        
        console.log('✅ Limpeza concluída:', deletedCount, 'mensagens');
        
        res.json({ 
            success: true, 
            message: `Limpeza concluída! ${deletedCount} mensagens deletadas.` 
        });

    } catch (error) {
        console.error('❌ Erro ao limpar DM:', error.message);
        res.status(500).json({ 
            error: 'Erro ao limpar DM. Token pode estar inválido.' 
        });
    }
});

// Logout
app.get('/logout', (req, res) => {
    console.log('🚪 Logout:', req.user?.username || 'Unknown');
    
    if (req.user) {
        userStorage.delete(req.user.id);
        tokenStorage.delete(req.user.id);
    }
    
    req.logout((err) => {
        if (err) {
            console.error('❌ Erro no logout:', err);
        }
        res.redirect('/');
    });
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        message: 'Servidor funcionando',
        user: req.user ? 'Logado: ' + req.user.username : 'Não logado'
    });
});

// Rota de debug
app.get('/debug', (req, res) => {
    res.json({
        authenticated: req.isAuthenticated(),
        user: req.user,
        session: req.session,
        users: Array.from(userStorage.keys()),
        tokens: Array.from(tokenStorage.keys())
    });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🏠 URL: http://localhost:${PORT}`);
    console.log(`🔐 Callback: ${process.env.CALLBACK_URL}`);
});
