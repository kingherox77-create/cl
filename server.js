require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage em memória (simples e funciona)
const userTokens = new Map();

// Middlewares ESSENCIAIS
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session config - SIMPLES
app.use(session({
    secret: process.env.SESSION_SECRET || 'chave-muito-secreta-aqui-123456',
    resave: true,  // ALTERADO: true para melhor compatibilidade
    saveUninitialized: true,  // ALTERADO: true
    cookie: { 
        secure: false,  // ALTERADO: false para desenvolvimento
        maxAge: 30 * 24 * 60 * 60 * 1000
    }
}));

// Passport config
app.use(passport.initialize());
app.use(passport.session());

// Configure Passport - VERSÃO SIMPLIFICADA
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    console.log('🔐 Login recebido do Discord:', profile.username);
    return done(null, profile);
}));

// Serialização MUITO SIMPLES
passport.serializeUser((user, done) => {
    console.log('💾 Salvando sessão do usuário:', user.id);
    done(null, user);
});

passport.deserializeUser((user, done) => {
    console.log('🔍 Carregando usuário da sessão:', user?.id);
    done(null, user);
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ========== ROTAS ========== //

// Rota principal
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login Discord
app.get('/auth/discord', passport.authenticate('discord'));

// Callback Discord - VERSÃO CORRIGIDA
app.get('/auth/discord/callback',
    passport.authenticate('discord', { 
        failureRedirect: '/?error=auth_failed'
    }),
    (req, res) => {
        console.log('✅ Login BEM-SUCEDIDO, redirecionando...');
        // Redirecionamento DIRETO sem lógica complexa
        res.redirect('/dashboard');
    }
);

// Dashboard - VERIFICAÇÃO SIMPLES
app.get('/dashboard', (req, res) => {
    console.log('📊 Tentando acessar dashboard...');
    console.log('Usuário autenticado?', req.isAuthenticated());
    console.log('Dados do usuário:', req.user);
    
    if (!req.isAuthenticated()) {
        console.log('❌ Não autenticado, redirecionando...');
        return res.redirect('/');
    }
    
    const userToken = userTokens.get(req.user.id);
    
    console.log('✅ Renderizando dashboard para:', req.user.username);
    res.render('dashboard', {
        user: req.user,
        token: userToken || null
    });
});

// Salvar Token
app.post('/save-token', (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Não autenticado' });
    }

    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ error: 'Token é obrigatório' });
    }

    console.log('💾 Salvando token para:', req.user.username);
    userTokens.set(req.user.id, token);
    
    res.json({ 
        success: true, 
        message: 'Token salvo com sucesso!' 
    });
});

// Limpar DM
app.post('/clear-dm', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Não autenticado' });
    }

    const { channelId } = req.body;
    const userToken = userTokens.get(req.user.id);

    if (!channelId) {
        return res.status(400).json({ error: 'Channel ID é obrigatório' });
    }

    if (!userToken) {
        return res.status(400).json({ error: 'Token não configurado' });
    }

    try {
        console.log('🧹 Iniciando limpeza para canal:', channelId);
        
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
            error: 'Erro ao limpar DM. Verifique o token e o channel ID.' 
        });
    }
});

// Logout
app.get('/logout', (req, res) => {
    console.log('🚪 Logout:', req.user?.username);
    
    if (req.user) {
        userTokens.delete(req.user.id);
    }
    
    req.logout(() => {
        res.redirect('/');
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        authenticated: req.isAuthenticated(),
        user: req.user ? req.user.username : 'Não logado'
    });
});

// Debug route
app.get('/debug-session', (req, res) => {
    res.json({
        isAuthenticated: req.isAuthenticated(),
        user: req.user,
        sessionID: req.sessionID,
        session: req.session
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🏠 Local: http://localhost:${PORT}`);
    console.log(`🌐 Produção: ${process.env.CALLBACK_URL?.replace('/auth/discord/callback', '')}`);
});
